# TPS Finances

## Install with BRAT

This plugin is distributed from the private GitHub repository `ZachTish/tps-finances`. To let BRAT read its releases:

1. Create a fine-grained GitHub personal access token scoped only to `ZachTish/tps-finances`, with **Repository permissions → Contents: Read-only**.
2. In BRAT, add `ZachTish/tps-finances` as a beta plugin, provide that token for private-repository access, and select **Latest** so BRAT tracks the newest published release.
3. Store the token only in BRAT's device-local configuration. Never put it in this repository, a vault note, plugin settings, or any committed file.

## Development and deployment

Canonical source, tests, Git metadata, and dependencies live in `/Users/zachtisherman/TishOS Plugin Development/TPS-Finances (Dev)`, outside both vaults. `npm run build` deploys byte-changed runtime artifacts by default only to `/Users/zachtisherman/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian Plugin Test Vault/.obsidian/plugins/tps-finances`; `npm test` is therefore isolated even though it ends with a production-mode build. Promotion to `/Users/zachtisherman/TishOS v0.1/.obsidian/plugins/tps-finances` is an explicit guarded post-validation action. Neither target overwrites `data.json` or other runtime-owned state.

- 2026-07-16 isolation validation: the contract test was made source-owned instead of reading the production TPS contract, all 15 tests passed, and the required final `npm run build` reported `[runtime-deploy] target=test ... unchanged`. Obsidian 1.12.7 loaded Finances in the registered test vault and created only empty local QA storage. No live promotion occurred, and production runtime checksums remained unchanged.

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
- Rule, budget, and classification saves are single-flight: the action disables while saving and re-enables with a visible error if persistence fails.

## Plaid products and limitations

- Regular bank and credit activity uses cursor-based `/transactions/sync`, including added, modified, and removed records.
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

- `npm test` runs contract/storage regressions, atomic transaction-content/move tests, modal single-flight and local-month checks, mocked Plaid credential trimming/migration/transport/pagination/optional-product tests, success-only investment watermark tests, scoped last-known-holdings preservation tests, and a production TypeScript/esbuild build. The Plaid tests do not call the live API.
- Validate Sandbox first, then separately configure the production SecretStorage entry before switching environments.
- After every source change, rebuild and reload Obsidian before testing the dashboard or Plaid Link.
- Populated dashboard validation covered mixed checking, credit, and brokerage accounts; transfers and investment buys were excluded from spending; income, net worth, source-line navigation, TPS Home summary, and responsive layouts were checked before the temporary data was removed.
- Daily-note migration validation moved one identified legacy-ledger transaction into `2026-07-10.md`, confirmed exactly one copy, removed the empty generated ledger, rendered the selected-day row through the Home Transactions Base, and then removed the QA line.
- Transaction-route validation changed a test account from inherited daily-note storage to an explicit account-note owner, confirmed the line was removed from the daily note and appended once to the account note, confirmed the Home Base still found it by date, then removed the test account and line.

## Version notes

- 0.4.2: Made transaction and snapshot mutations concurrency-safe, changed transaction updates to write the destination before removing old copies, guarded modal saves against duplicate submissions and silent failures, and aligned dashboard month totals with the local calendar.
- 0.4.1: Rejected missing, whitespace-only, and conflicting Plaid credentials with explicit setup status; froze and migrated per-Item credential references; surfaced connect/sync failures to users; hardened the localhost Link completion race; pinned the Plaid API version; and isolated optional Investments state so pending history cannot advance its watermark or erase last-known holdings while core sync succeeds.
- 0.4.0: Added global and per-account daily-note/account-note transaction routing with automatic canonical re-homing and Home date filtering across both storage locations.
- 0.3.0: Moved transaction ownership to dated daily notes, added safe monthly-ledger migration, and embedded the selected-day Transactions Base on TPS Home.
- 0.2.0: Added sync-safe manual category/tag metadata, ordered account/name/vendor/amount categorization rules, recurring monthly category budgets, budget progress, and Rules/Budgets Bases.
- 0.1.0: Initial contract-native implementation with Mac-local Plaid Link, device-local SecretStorage, account entities, monthly transaction ledgers, daily balance/holding snapshots, paginated investment synchronization, reusable Bases, GCM/Home integration, source-line navigation, connection removal, and a responsive dashboard.
