# TPS Finances

## 0.5.10

- Dashboard model construction now builds account cards and transaction labels during one supported account-note scan instead of traversing the Markdown collection and reading every account note's metadata a second time.
- Account sorting, balance and holding ownership, transaction display labels, account-search text, classification, and `.md`/`.MD` path handling are unchanged. Notes without `financeAccountId` remain available as transaction labels while correctly staying out of the account-card collection.
- Exact public `0.5.9` passed all 66 release checks, then failed the new before-source optimization gate after producing the expected model: one dashboard read made three Markdown-list calls and four account metadata reads. Version `0.5.10` passes that gate with two list calls—the required snapshot selection and one account scan—and two metadata reads.
- Across 2,001 deterministic actual-plugin scenarios, released and candidate dashboard models were identical. Markdown-list calls fell from 6,003 to 4,002 and metadata-cache reads from 18,833 to 11,621.
- In a controlled 20,000-account, 20,000-unrelated-file, 4,000-transaction benchmark over 25 alternating rounds, the median model-build time fell from 58.064 ms to 53.437 ms (7.97%) and p95 from 62.220 ms to 59.846 ms (3.82%). The output digest was identical, account metadata reads fell from 40,000 to 20,000, and the production bundle shrank by 156 bytes.
- Account metadata is now internally coherent within a dashboard model. If an account changes while transaction notes are being read, the existing account-change listener and coalescing renderer request a fresh model rather than mixing an old account card with a newer transaction label.
- The test harness no longer replaces a private label method. This patch adds no cache, timer, listener, retry, fallback route, persisted state, migration, monkeypatch, or unsupported Obsidian API use. Commands, settings, Plaid behavior, note formats, and minimum Obsidian `1.12.0` are unchanged.
- The final versioned suite passed 67/67 checks, followed by a separate production-mode build that deployed only byte-changed `main.js` and `manifest.json` to the isolated test runtime. Obsidian 1.12.7 reloaded and rendered the disconnected dashboard with all five Finances commands registered; Plaid was not connected, Sync and mutations were not invoked, runtime `data.json` remained absent, and production was not accessed.

## 0.5.9

- Ordinary and investment transaction batches now build the Markdown transaction index lazily once on the normal path instead of rebuilding it after every successful removal or upsert.
- Each successful atomic `Vault.process()` write returns the exact committed note text; TPS Finances reparses only that touched file, refreshes known source files before consuming local metadata, preserves vault/line ordering, and discards the complete invocation index on both success and failure. An unexpectedly missing, moved, renamed-during-read, or replaced known source invalidates the snapshot and performs one supported fresh index before continuing.
- Exact released `0.5.8` and `0.5.9` produce byte-identical files, mutation order, return values, and errors across removals, modifications, additions, duplicate IDs and sources, routing changes, investment records, target templates, touched-note concurrent edits, missing sources, renames between writes or during an awaited read, every resolver/write failure position, and failed-call retries. Normal routed resolver inputs remain exact; metadata added atomically to a future target is reconciled at write time. A candidate-only replacement probe intentionally proves that `0.5.9` uses the current same-path replacement metadata instead of `0.5.8`'s stale pre-replacement content.
- In the deterministic 20,000-file/500-change fixture, released `0.5.8` performed 500 complete Markdown traversals and 10,000,000 cached reads; `0.5.9` performs one traversal and 20,000 reads with the same 500 atomic writes. The latest isolated run fell from 12.557 seconds to 0.253 seconds at this synthetic storage seam; structural counts, not wall time, are the acceptance gate.
- TPS Finances remains intentionally single-writer during Sync. A finance marker independently inserted into a different, untouched note after the batch snapshot becomes visible to the next batch or fresh read; all edits to notes TPS actually processes remain atomically preserved.
- Commands, settings, Plaid requests/cursors, transaction and investment formats, routing, counts, failure propagation, device state, and minimum Obsidian `1.12.0` are unchanged. This patch adds no persistent cache, listener, timer, retry, alternate write route, monkeypatch, unsupported API, or migration.

## 0.5.8

- Account synchronization now indexes existing account notes once per provider batch instead of traversing the complete Markdown collection separately for every account.
- The invocation-local index preserves the first matching note in vault order, every frontmatter refresh, every returned account path, and the existing derived/unique path behavior for new accounts.
- A genuine index miss still performs one live supported-vault scan before creation. This preserves accounts whose metadata becomes available late; a newly found or created note is then reused within the batch so duplicate provider input cannot create duplicate account notes while metadata cache catches up.
- On an identical fixture containing 20,000 unrelated notes and 120 existing accounts, 30 batch upserts fell from 3,600 Markdown-list traversals and 217,800 account metadata reads to 30 traversals and 7,170 reads. Median isolated store time fell from 12.120 ms to 0.144 ms, a 98.8% reduction at this seam.
- Exact released `0.5.7` passed all 45 declared checks but failed the two new optimization probes: it repeated the vault scan for every existing account and created a second note for duplicate new input while the first note's metadata cache was still empty. Version `0.5.8` passes the focused 4/4 gate and all 49 declared checks, including duplicate-note order, empty/all-new scan parity, late metadata recovery after awaited work, new-note reuse, stale ID/path revalidation, and exact refreshed frontmatter.
- Commands, settings, Plaid requests, account/transaction/investment formats, transaction routing, GCM/Daily Notes compatibility, device state, and minimum Obsidian `1.12.0` remain unchanged. This patch adds no persistent cache, timer, migration, retry loop, monkeypatch, or unsupported API use.

## 0.5.7

- Dashboard model construction and Sync's last-known-holdings pre-read now select, read, and split the latest finance snapshot once, then pass that immutable invocation-local document to both balance and holding parsers.
- This removes one complete latest-snapshot vault traversal, one `cachedRead`, and one line split from each operation. A dashboard model now performs two relevant Markdown-file traversals and one snapshot read instead of three traversals and two reads.
- Balances and holdings can no longer be assembled from two different snapshot moments, and a successful first read cannot be invalidated by a redundant second read failure. A selected-file read failure still propagates once without retrying or falling back to another snapshot.
- Snapshot selection, duplicate-balance last-wins behavior, account sorting and path matching, balance/account/holding currency precedence, explicit and derived `asOf` dates, stale holdings, commands, settings, Plaid behavior, persisted finance data, and every 0.5.6 dashboard action guarantee remain unchanged.
- This backward-compatible performance/reliability patch adds no cache, timer, persisted state, migration, fallback route, monkeypatch, or unsupported API use and retains minimum Obsidian 1.12.0.

## 0.5.6

- Dashboard Connect, Sync, and per-account transaction-route actions now keep refresh ownership in the mutation that already updates the dashboard. The shared error wrapper no longer performs a guaranteed second full model read and DOM rebuild after that refresh settles.
- Successful self-refreshing actions therefore perform one dashboard read/commit instead of two. No-op Sync paths perform none instead of one, and an action-owned render error remains visible instead of being silently retried as fallback behavior.
- Every current wrapper call is contract-checked against an explicitly refreshing mutation. Connect normally refreshes through its completed Sync; if Sync was already running when the new Item was persisted, Connect performs one immediate refresh instead of relying on that unrelated run to finish. Sync still refreshes after its provider/storage work, account-route changes still refresh after rerouting, and rejected actions still surface one Obsidian Notice.
- Commands, buttons, settings, Plaid requests, account/transaction routing, persisted finance data, output, and the 0.5.5 pagination safeguards are unchanged. This backward-compatible performance/reliability patch adds no cache, timer, persisted state, migration, or unsupported API use and retains minimum Obsidian 1.12.0.

## 0.5.5

- Transactions Sync pagination now validates Plaid's required `has_more`, `next_cursor`, change-array, ID, account, amount, date, and pending-state fields before accepting a page. Continuing cursors must advance; cyclic/rewound checkpoints and changes attached to a stationary terminal cursor fail closed instead of being coerced into a plausible patch.
- Plaid's documented mutation-during-pagination condition restarts from the original durable cursor only when its structured error code follows an accepted partial attempt. Recovery is limited to two automatic restarts and 100 pages per attempt; other errors are never text-matched, retried, or routed through a fallback.
- Each attempt normalizes into compact attempt-local arrays and a staged new-identity overlay. Durable identity history is read in place instead of copied; discarded, malformed, over-limit, and normalization-failed attempts cannot leak provider identities or partial transaction patches into device state.
- Empty terminal cursors with no observed changes remain supported for not-yet-ready Items. An existing durable cursor is preserved rather than overwritten with an empty checkpoint.
- Account/transaction fields, cursor persistence after terminal success, settings, Plaid connection flows, Markdown records, dashboard behavior, and optional Investments behavior are unchanged. This backward-compatible reliability patch keeps minimum Obsidian 1.12.0 and requires no migration.

## 0.5.4

- Dashboard refreshes that arrive during an active model read are now coalesced into one serialized follow-up instead of being discarded.
- Superseded models and errors no longer rebuild the dashboard; every overlapping caller waits for the newest requested model to settle, and closing the view prevents an in-flight read from committing into a detached surface.
- Reopening requests a fresh model, while final model failures retain the existing visible error state. Commands, settings, finance records, classification, Plaid behavior, and supported fallback precedence remain unchanged.
- The scheduler is transient view state only: it adds no cache, timer, persistent schema, retry fallback, monkeypatch, or unsupported Obsidian API.
- This backward-compatible reliability and rendering-efficiency patch keeps the minimum supported Obsidian version at 1.12.0.

## 0.5.3

- Dashboard classification now filters and orders enabled categorization rules once per model build instead of repeating that preparation for every historical transaction.
- Rule order, stable tie behavior, manual overrides, rule/provider/uncategorized precedence, additive tags, account matching, amount boundaries, settings, and stored finance records remain unchanged.
- The prepared classifier is invocation-local and discarded with the dashboard model; this patch adds no persistent cache, invalidation state, migration, or fallback route.
- This backward-compatible performance patch keeps the minimum supported Obsidian version at 1.12.0.
- Validation passed all 25 declared tests and 100,000 seeded legacy-equivalence cases. A 20,000-transaction/120-rule classification benchmark improved from about 200.87 ms to 6.11 ms; Obsidian 1.12.7 reloaded and rendered the disconnected dashboard in the isolated test vault without creating runtime state.

## 0.5.2

- Holding snapshot parsing now reuses the already parsed account path/ID model instead of rescanning every Markdown file and rereading account metadata.
- Latest-snapshot selection now keeps the best date/path candidate in one pass instead of filtering and sorting the complete snapshot collection.
- Snapshot selection, holding ownership/currency, settings, persisted finance records, and Plaid behavior remain unchanged.
- This backward-compatible performance patch keeps the minimum supported Obsidian version at 1.12.0 and requires no migration.

## 0.5.1

- Monthly budget progress now aggregates eligible spending in one transaction pass instead of filtering the complete transaction collection once per budget.
- Budget order, duplicate-category totals, category normalization, date boundaries, eligible transaction kinds, and numeric behavior remain unchanged.
- This backward-compatible patch changes no settings, persisted finance records, Plaid behavior, or minimum Obsidian version and requires no migration.

## Install with BRAT

This GitHub repository is public. BRAT 2.2.0 or newer can install `ZachTish/tps-finances` without a private-repository token:

1. Add `ZachTish/tps-finances` as a beta plugin.
2. Select **Latest** to follow numbered releases, or freeze a numeric version for controlled rollout.

## Development and deployment

Canonical source, tests, Git metadata, and dependencies live in `/Users/zachtisherman/TishOS Plugin Development/TPS-Finances (Dev)`, outside both vaults. `npm run build` deploys byte-changed runtime artifacts by default only to `/Users/zachtisherman/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian Plugin Test Vault/.obsidian/plugins/tps-finances`; `npm test` is therefore isolated even though it ends with a production-mode build. Promotion to `/Users/zachtisherman/TishOS v0.1/.obsidian/plugins/tps-finances` is an explicit guarded post-validation action. Neither target overwrites `data.json` or other runtime-owned state.

- 2026-07-16 isolation validation: the contract test was made source-owned instead of reading the production TPS contract, all 15 tests passed, and the required final `npm run build` reported `[runtime-deploy] target=test ... unchanged`. Obsidian 1.12.7 loaded Finances in the registered test vault and created only empty local QA storage. No live promotion occurred, and production runtime checksums remained unchanged.
- 2026-07-24 settings-release validation: all 21 declared tests passed, including the routed-settings, post-connect/post-sync refresh, persistence, and finance-contract regressions. The required final standalone build deployed only to `[runtime-deploy] target=test`. Obsidian 1.12.7 was reloaded with `Reload app without saving`; all four settings destinations and the shared nine-plugin `Choose what to configure` pattern were inspected in the registered test vault without connecting Plaid, syncing, changing settings, or invoking a mutating shortcut. Runtime-owned state remained absent and production was not accessed or promoted.
- 2026-07-28 efficiency-release validation: all 23 declared tests passed, including exact legacy-result and single-traversal budget regressions. An independent 20,000-case randomized oracle found no difference within the production data contract; a synthetic 120-budget/30,000-transaction run measured about 359 ms for the prior algorithm and 2.5 ms for the one-pass implementation. The required standalone build deployed only to `[runtime-deploy] target=test`. Obsidian 1.12.7 was reloaded with `Reload app without saving`; Finances commands registered and the empty, disconnected dashboard rendered without changing settings, connecting Plaid, syncing, or creating runtime state. Production was not accessed or promoted.
- 2026-07-28 snapshot-efficiency validation: all 24 declared tests passed, including source-backed account-reuse and latest-snapshot selection equivalence coverage; 100,000 randomized dense selectors matched the former ordering, and a synthetic 10,000-snapshot selector benchmark improved from about 113.72 ms to 19.61 ms over 30 iterations. The required standalone build deployed only to `[runtime-deploy] target=test`. After **Reload app without saving**, Obsidian 1.12.7 registered the Finances commands and rendered the disconnected dashboard without connecting Plaid, syncing, changing settings, or creating runtime state. Production was not accessed or promoted.
- 2026-07-30 refresh-reliability validation: the released 0.5.3 implementation passed its 25 tests but an executable real-view harness proved that a refresh during an active read was dropped after one model load. Version 0.5.4 passed all 28 declared tests; 150 overlapping requests across two active reads produced exactly two serialized follow-ups, one final DOM commit, and no parallel model reads. Superseded success/error, synchronous failure recovery, close-before-start, close-during-read, and reopen behavior passed. The required standalone build deployed only to `[runtime-deploy] target=test`; after **Reload app without saving**, Obsidian 1.12.7 opened and rendered the disconnected Finances dashboard without connecting Plaid, syncing, changing settings, or creating runtime state. Production was not accessed or promoted.
- 2026-07-30 transaction-pagination validation: the exact 0.5.4 release passed 28/28 declared checks, then failed five of eight safe pagination probes plus a bounded-recovery probe that reached a synthetic runaway guard after eight completed provider calls. Version 0.5.5 passes all 37 declared checks: structured mutation recovery stops after six calls in the repeated-error fixture, seventeen malformed/non-progressing response cases fail without fallback, three valid terminal no-op cursor shapes remain accepted, a terminal 100th page succeeds, and failed attempts commit no partial identities. A deterministic 20,000-entry fixture proves sync reads durable identities without enumerating or copying their history; a local 100,000-entry benchmark measured about 41.07 ms median for the rejected full-map copy versus about 0.0001 ms for an empty overlay commit. TypeScript, the suite build, mandatory separate final build, and the disconnected test-vault dashboard smoke check passed without invoking Plaid or creating runtime state. Production was not accessed or promoted.
- 2026-07-30 action-refresh validation: exact released 0.5.5 passed all 37 declared checks but failed 0/4 new real-view action probes: successful self-refreshing actions read and committed twice, no-op actions read once, and a failed action-owned render was silently retried. An adversarial review then exposed Connect's persisted-Item path while Sync was already active; the bundled real-main regression now executes both the normal and actual busy branches and proves exactly one refresh while preserving both existing Notices. Version 0.5.6 passes the focused 5/5 gate and all 42 declared checks: successful action work falls from two model reads/DOM commits to one, no-op work from one to zero, visible errors are not hidden by fallback retry, all six wrapper call sites remain contract-checked, and overlapping external refreshes retain the serialized scheduler. TypeScript, the suite build, mandatory separate final build, and **Reload app without saving** passed; Obsidian 1.12.7 rendered the disconnected Finances dashboard without connecting Plaid, syncing, changing settings, or creating runtime state. Production was not accessed or promoted.
- 2026-07-30 coherent-snapshot validation: exact released 0.5.6 passed all 42 declared checks but a new real-main dashboard probe observed three relevant Markdown-file traversals, two snapshot reads, and a torn result containing balance `100` with holding value `200`. Version 0.5.7 passes the focused 4/4 gate and all 45 declared checks: stable snapshot output remains exact across no-snapshot, duplicate-balance, currency, link, numeric, stale, and date cases; one operation now performs two traversals, one read, and one line split; and selected-file failures propagate after exactly one attempt without fallback. Two independent adversarial reviews found no behavior or concurrency blocker. TypeScript, the suite build, mandatory separate final build, and **Reload app without saving** passed; Obsidian 1.12.7 rendered the disconnected Finances dashboard without connecting Plaid, syncing, changing settings, or creating runtime state. Production was not accessed or promoted.
- 2026-07-30 transaction-index batching validation: exact released 0.5.8 passed all 49 release checks and failed only the new one-index batch gate at 80 traversals/160,000 reads for 80 writes. Version 0.5.9 passes the focused 17/17 exact-source comparison and reliability suite, including normal, concurrent, missing/replaced/renamed-during-read source, duplicate-precedence, template, investment, initial-read, resolver, mutation, and retry cases; the complete suite passes 66/66. The deterministic 20,000-file/500-change fixture falls from 500 traversals/10,000,000 reads to one traversal/20,000 reads with byte-identical output and write calls. TypeScript, the mandatory separate final build, test-vault reload, disconnected-dashboard smoke check, and runtime-state preservation are recorded for the exact release commit. Plaid Sync and production were not invoked.

## Mobile modal contract

Finance rule, budget, transaction-classification, and disconnect modals use `tps-keyboard-aware-modal`, reusing TPS GCM's shared visible-viewport behavior on mobile.

TPS Finances turns the vault into a readable, contract-native account, transaction, and investment manager. It is currently desktop-only and connects to Plaid from the local Mac.

## Contract and storage

- Financial accounts are durable entity notes in `Finances/Accounts` with `kind: account`.
- Bank and investment transactions are plain `log` bullets in the configured daily note for the transaction date.
- `Default transaction location` can instead route transaction logs into their durable account notes. Each account card can inherit that default or explicitly choose daily notes/account note.
- Changing either route moves existing identified transactions to the resolved owner; it does not keep mirrored copies.
- Transaction inserts, updates, reroutes, removals, and generated snapshot refreshes use Obsidian's atomic vault processing so a concurrent user/plugin edit is preserved. A reroute writes or confirms the destination before removing the source line.
- Investment activity uses the same line contract with `type: investmentTransaction`.
- Each synchronized line carries a stable opaque `financeId`, date, account link, normalized signed amount, currency, pending state, and optional category/merchant fields.
- Transaction `subtype` preserves the operational meaning used by the UI and Bases: ordinary purchases, income, transfers, payments, fees, cash advances, and refunds; investment records retain Plaid's buy/sell/dividend/transfer subtype.
- Plaid positive outflows are normalized to negative TPS cash flow; Plaid negative inflows become positive TPS cash flow.
- Current balances and holdings are derived provider state written as dated snapshot log lines in `Finances/Snapshots/YYYY-MM-DD.md` so the dashboard remains readable after reload and on devices without an active Plaid connection. A holding retained across an optional Investments outage keeps its original `asOf` date, is marked `stale`, and is labeled as last-known in Home and the dashboard.
- TPS Finances does not create a security note merely because a security appears in a holding.
- Transaction sync writes directly into the daily-note body without adding a finance heading. Daily-note creation uses the configured GCM/Core Daily Notes workflow and selected template.
- Stable `financeId` fields allow Plaid additions, modifications, and removals to reconcile across daily notes without duplicate records.
- Legacy monthly transaction ledgers are migrated line-by-line into their dated daily notes; an empty generated ledger is removed only when it has no remaining body content.
- Plaid categories are retained as `providerCategory`; a manual `categoryOverride` or the first matching enabled rule supplies the effective dashboard category. Manual tags and rule tags are combined.
- Categorization rules are durable `financeRule` notes in `Finances/Rules`. Rules can match account, transaction name, merchant/vendor, and absolute amount range; lower priority numbers run first.
- Monthly category budgets are durable `financeBudget` notes in `Finances/Budgets` and measure eligible spending against the effective category without modifying source transactions.

## Device-local Plaid connection

- The Plaid client ID, Plaid environment secret, access tokens, cursor state, raw provider identifiers, and identity map are stored in Obsidian SecretStorage on the current device.
- The client ID and environment secret must be two separate populated SecretStorage entries. Values are trimmed when read and whitespace-only entries remain missing. Settings show whether credentials are missing, conflicting, ready to connect, or paired with a connected institution; TPS Finances never changes a current settings selection automatically.
- Each connected Item freezes the client-ID and environment-secret references used to create it. On first load after upgrading, a legacy Item without a client-ID reference captures the currently configured reference and persists that migration in device-local SecretStorage before later settings changes can retarget it.
- Plugin `data.json` stores only non-secret preferences such as folder, environment, selected SecretStorage names, history range, and logging state.
- Settings writes use immutable snapshots in one serialized, coalescing drain. Rapid text edits cannot finish out of order, and every overlapping settings handler waits until the newest complete snapshot is durable.
- Plaid Link opens in the system browser from a temporary `127.0.0.1` server. The server exists only for the Link result and shuts down after success, exit, or timeout.
- OAuth institutions can use desktop popup OAuth without a redirect URI in many cases. An optional HTTPS redirect URI can be configured for institutions that require it; it must also be registered in the Plaid Dashboard.
- Each device must be connected independently. Separate connections can create separate Plaid Items and may incur separate subscription charges. The current implementation is intended to have one Mac act as the synchronized writer while other devices consume the daily-note logs and snapshots.

## Commands and UI

- `TPS Finances: Open finances`
- `TPS Finances: Connect an institution with Plaid`
- `TPS Finances: Sync accounts and transactions`
- `TPS Finances: Add categorization rule`
- `TPS Finances: Add monthly budget`
- Dashboard summaries: net worth, cash, investment value, current-month spending, and current-month income.
- Account cards show latest synchronized balances without copying balances into account frontmatter.
- Investment holdings and recent transactions are rendered from durable snapshot and daily-note log lines.
- Dashboard transaction rows open and focus the exact daily-note source line through GCM's shared opener when available.
- TPS Home includes a compact finance summary and an embedded Transactions Base scoped to the selected Home date.
- The Home Base filters by each line's date, so selected-day transactions remain visible whether their canonical owner is a daily note or an account note.
- Finance account and finance configuration notes receive an `Open finances` GCM action.
- `Finances/Accounts.base`, `Finances/Transactions.base`, and `Finances/Holdings.base` are created as reusable native/TPS Base surfaces.
- `Finances/Rules.base` and `Finances/Budgets.base` provide editable rule and budget management surfaces.
- Every transaction row has a compact tag action for a sync-safe category override and manual tags. Clearing the override returns the transaction to rule/provider classification.
- Settings list local connections and provide a confirmation-gated disconnect action. Disconnect calls Plaid `/item/remove` so subscription-backed Items do not remain active unintentionally; Markdown history is retained.
- Connect and sync actions surface credential, provider, and callback failures in an Obsidian notice instead of leaving a rejected background promise in the console.
- Dashboard Connect, Sync, and account-route actions explicitly own their successful refresh, including Connect while Sync is already active. The view-level error wrapper never adds a second model read, fallback retry, or no-op refresh.
- Rule, budget, and classification saves are single-flight: the action disables while saving and re-enables with a visible error if persistence fails.

## Settings layout

Settings open on a four-destination `Choose what to configure` hub:

- **Plaid setup** (default): environment, device-local client ID and environment secrets, setup status, and optional OAuth redirect.
- **Data & routing**: finance folder, initial transaction history, and the default daily-note/account-note owner.
- **Connections**: connect, sync, connected institutions, confirmation-gated disconnect, and debug logging.
- **Rules & budgets**: direct shortcuts to open Finances, add a categorization rule, or add a monthly budget.

Only the selected destination is rendered. The selection is transient and never becomes a persisted preference, so this redesign does not migrate or replace any finance setting. Secret edits retain the active destination and scroll position; connect, sync, and disconnect refresh the connection page and return focus to its heading. The hub uses native `aria-pressed` buttons and visible focus rings; narrow settings windows switch to a horizontal destination strip and stacked, full-width controls. There are no nested settings disclosures.

## Plaid products and limitations

- Regular bank and credit activity uses cursor-based `/transactions/sync`, including added, modified, and removed records.
- Transactions pagination requires explicit boolean `has_more`, string `next_cursor`, contract-shaped change arrays, nonempty IDs/accounts, finite amounts, ISO-shaped dates, and boolean pending state. Empty terminal cursors are accepted only when the page observed no changes; a saved durable cursor is retained in that not-yet-ready response.
- Plaid's documented mutation-during-pagination error restarts from the original durable cursor only after an accepted partial attempt. Recovery is limited to two restarts, each attempt is limited to 100 pages at Plaid's maximum 500-record page size, and every other provider error fails without fallback or automatic retry. Attempt-local transaction arrays and new-identity overlays become shared state only after a valid terminal page; durable identity history is never copied just to start an attempt.
- Holdings use `/investments/holdings/get`. A failed or pending optional response is a non-observation, not an authoritative empty response; the newest snapshot retains only last-known holdings belonging to that Item's currently returned accounts. A successful empty response clears those holdings.
- Investment activity uses paginated `/investments/transactions/get` with the initial history range and a rolling 14-day overlap after a successful history sync. Its separate device-local watermark advances only after the complete response has been written, so `PRODUCT_NOT_READY` and transport/provider outages retry the full initial range.
- Institutions without the Investments product continue syncing ordinary accounts and transactions.
- Temporary or unavailable optional Investments responses do not block account and Transactions sync; a later sync retries Investments and a safe Notice identifies the affected operation and provider code.
- TPS Finances is read-only with respect to financial institutions. It does not move money, place trades, or provide financial advice.
- Production Transactions and Investments may create Plaid subscription charges. Exact pricing and institution access are controlled by the user's Plaid account.

## Logging and privacy

- Debug logging is off by default.
- Logs record the trigger, environment, institution label, aggregate counts, selected route, duration, and failures.
- Provider failures retain the safe Plaid error code and request ID so a failed connection can be diagnosed without recording credentials or payloads.
- Logs never include Plaid secrets, access tokens, raw payloads, account numbers, balances, transaction names, or transaction amounts.
- Errors and safe optional-Investments operational warnings remain visible even when debug logging is disabled.

## Validation

- `npm test` runs contract/storage regressions, real-view dashboard refresh coalescing/error/lifecycle/action-ownership and coherent-snapshot tests, exact budget-aggregation equivalence and traversal checks, atomic transaction-content/move tests, modal single-flight and local-month checks, mocked Plaid credential trimming/migration/strict cursor-progress/bounded-restart/optional-product tests, success-only investment watermark tests, scoped last-known-holdings preservation tests, and a production TypeScript/esbuild build. The Plaid tests do not call the live API.
- Validate Sandbox first, then separately configure the production SecretStorage entry before switching environments.
- After every source change, rebuild and reload Obsidian before testing the dashboard or Plaid Link.
- Populated dashboard validation covered mixed checking, credit, and brokerage accounts; transfers and investment buys were excluded from spending; income, net worth, source-line navigation, TPS Home summary, and responsive layouts were checked before the temporary data was removed.
- Daily-note migration validation moved one identified legacy-ledger transaction into `2026-07-10.md`, confirmed exactly one copy, removed the empty generated ledger, rendered the selected-day row through the Home Transactions Base, and then removed the QA line.
- Transaction-route validation changed a test account from inherited daily-note storage to an explicit account-note owner, confirmed the line was removed from the daily note and appended once to the account note, confirmed the Home Base still found it by date, then removed the test account and line.

## Version notes

- 0.5.8: Indexed account notes once per Sync batch, retained a miss-only live recovery scan, and reused found/created files within the invocation to remove repeated vault traversals and metadata-lag duplicate creation.
- 0.5.7: Reused one immutable latest-snapshot document across account balances and holdings, removing a duplicate vault traversal/read/split and preventing cross-snapshot model tearing without adding cache state.
- 0.5.6: Removed the dashboard action wrapper's redundant successful/no-op refresh and silent error retry while preserving mutation-owned refreshes and user-facing failure Notices.
- 0.5.5: Made Transactions Sync pagination fail closed on malformed or non-progressing pages, bounded structured mutation restarts, preserved not-yet-ready durable cursors, and staged all attempt-local identities until terminal success.
- 0.5.4: Coalesced dashboard refresh bursts, prevented stale model/error commits, made overlapping callers await the newest requested render, and cancelled queued DOM work when the view closes.
- 0.5.3: Prepared enabled categorization-rule order once per dashboard model and reused it across transaction classification without adding persistent state or changing classification results.
- 0.5.2: Removed a redundant account-vault scan from holding parsing and replaced full snapshot sorting with an equivalent one-pass selection.
- 0.5.1: Replaced per-budget transaction filtering with one shared monthly category aggregation pass, preserving the existing budget results while reducing dashboard work from budgets × transactions to budgets + transactions.
- 0.5.0: Reorganized settings into a shallow accessible destination hub, added direct connection/sync/dashboard/rule/budget actions, and added narrow-window layout plus focus restoration without changing finance data or settings schemas.
- 0.4.3: Serialized settings writes, merged only locally changed fields into the newest persisted snapshot, preserved synchronized and future-version fields, retained quick reverts, and allowed queued snapshots to supersede failed writes.
- 0.4.2: Made transaction and snapshot mutations concurrency-safe, changed transaction updates to write the destination before removing old copies, guarded modal saves against duplicate submissions and silent failures, and aligned dashboard month totals with the local calendar.
- 0.4.1: Rejected missing, whitespace-only, and conflicting Plaid credentials with explicit setup status; froze and migrated per-Item credential references; surfaced connect/sync failures to users; hardened the localhost Link completion race; pinned the Plaid API version; and isolated optional Investments state so pending history cannot advance its watermark or erase last-known holdings while core sync succeeds.
- 0.4.0: Added global and per-account daily-note/account-note transaction routing with automatic canonical re-homing and Home date filtering across both storage locations.
- 0.3.0: Moved transaction ownership to dated daily notes, added safe monthly-ledger migration, and embedded the selected-day Transactions Base on TPS Home.
- 0.2.0: Added sync-safe manual category/tag metadata, ordered account/name/vendor/amount categorization rules, recurring monthly category budgets, budget progress, and Rules/Budgets Bases.
- 0.1.0: Initial contract-native implementation with Mac-local Plaid Link, device-local SecretStorage, account entities, monthly transaction ledgers, daily balance/holding snapshots, paginated investment synchronization, reusable Bases, GCM/Home integration, source-line navigation, connection removal, and a responsive dashboard.
