# TPS Finances

Accounts, transactions, investments, manual cash, budgets, and manually valued resale assets in Obsidian.

Current release: [1.4.1](https://github.com/ZachTish/tps-finances/releases/tag/1.4.1) · Obsidian 1.12.0+ · Desktop and mobile.

## Install with BRAT

Add `ZachTish/tps-finances` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Connect and use

1. Install/update **TPS Controller 1.4.0 and Finances 1.4.1** on your desktop and mobile devices. Shared Plaid operation requires Obsidian 1.12.3+; manual finance records retain the 1.12.0 minimum.
2. On your always-running Controller desktop, open **Plaid setup → Open Controller settings**. Configure the environment and separate client-ID/secret references under **Advanced → Plaid**, then choose **Finance server → Use this Controller**. Use the desktop that already owns your bank connections.
3. Export its pairing code and enter it in Controller's Finance server settings on the phone/iPad. Pairing, credentials, connection tokens, and request journals are device-local. Do not connect the same banks independently on each device.
4. Return to **Connections** to Connect, Sync, Reconnect, Disconnect, or reopen a pending request. Bank sign-in opens [Plaid Hosted Link](https://plaid.com/docs/link/hosted-link/) in your browser. Return to Obsidian afterward; the Controller imports the records and normal vault sync delivers the notes.
5. Use **Open finances** for balances, holdings, transactions, categorization, rules, and budgets. **Add cash account**, **Log cash transaction**, and **Add resale asset** work without Plaid.

## Faster atomic-note imports — 1.4.1

Bank and investment imports write up to 16 independent transaction notes concurrently. Revisions sharing a finance ID retain their original order; deletions complete before replacements start. Input validation and duplicate-identity checks finish before transaction mutations. An error stops queued work and waits for already-started writes before reporting failure, so a retry cannot race the previous batch. The bank cursor still advances only after the whole transaction batch succeeds.

Content inspections use Obsidian's invalidated-on-write `cachedRead` API; property updates continue to use `processFrontMatter` against current content and preserve user tags, categories, other properties, and note bodies. Deletion and legacy-migration guards force fresh reads. Empty patches avoid indexing, dashboard reads reuse the fields gathered during their index pass, and legacy line discovery uses bounded parallel reads while preserving vault/line precedence. No persistent cache or schema migration is introduced. Fast retries at the vault root can reuse a verified ID-named transaction before metadata indexing catches up, while unrelated name collisions still fail safely. See [Obsidian's content-cache and atomic-write contract](https://docs.obsidian.md/Plugins/Vault).

The existing **Data & routing → Enable logging** switch now reports phase durations for provider requests, account/transaction/investment/holding note writes, legacy migration, and dashboard refresh, plus index/write totals for atomic transactions. It records counts and timings rather than note contents or credentials. Settings, actions, routing, filenames, Controller pairing, and the minimum Obsidian version are unchanged; this is a backward-compatible patch release.

Regression coverage includes a 250-note batch, bounded writes and cold index reads, same-ID ordering, failed writes/verification/reads, drained retries, cursor commit ordering, duplicate precedence, empty patches, root metadata lag, and preserved manual content. The previously separate transaction-index suite is now part of `npm test`. Synthetic test-vault benchmarking isolates note creation from Plaid and cross-device vault transport; real bank response time, device storage, and other plugins can add latency. Physical iPhone/iPad throughput remains a device-testing limitation.

**Release validation (2026-09-18):** all 160 tests passed, including the mobile bundle without Node dependencies. In the reloaded desktop test vault, the released 1.4.0 importer took 157.76 seconds to create 250 synthetic transaction notes; the final 1.4.1 build took 35.90 seconds (about 4.4× faster), replayed the same batch in 1.27 seconds without duplicate notes, and read its dashboard records in 2.59 seconds. These are measured runs in a busy iCloud-backed test vault, not a throughput guarantee. A separate synthetic provider run exercised the actual sync orchestration, account creation, migration, cursor persistence, and dashboard model: 250 records in 55.05 seconds, then a correction and deletion in 11.26 seconds, leaving exactly 249 records with the corrected amount and preserved manual category, tags, custom property, and receipt body. Provider calls and device-state writes in that run were confined to in-memory fixtures; no bank connection or credential was changed. The separate final production-mode build deployed only shipped files to the test vault, followed by a plugin reload and artifact/state verification. Runtime `data.json` stayed byte-identical. QA notes were moved from `Inbox` to `_archive`. Production installation remains the user's BRAT pull; physical mobile performance and live bank latency were not tested in this release.

## Shared Controller connection — 1.4.0

One pinned desktop imports bank data for all paired devices. The Controller checks for requests every four seconds and defaults to refreshing bank data every 15 minutes; its interval can be changed or set to manual-only. It must remain awake with Obsidian and vault sync running. A sleeping/offline Controller leaves requests waiting. This is a personal server inside Obsidian, not an OS background daemon. Request/response latency follows your vault synchronization.

Keep `_assets/TPS Finance Relay` included in vault sync. Those Markdown files carry encrypted requests, institution summaries, and short-lived sign-in URLs. Controller's AES-256-GCM transport does not put API secrets, bank access tokens, Link tokens, or the operation journal into plaintext notes or shared plugin settings. Your imported finance notes continue to use your normal vault synchronization. Treat pairing codes as private credentials.

Closing the connection modal or restarting Obsidian preserves a request. Reopen it from **Connections**. Reconnect uses the existing Item and preserves account IDs, transaction cursors, credential references, and the original environment even after defaults change. An interrupted one-time token exchange is recovered from a persisted receipt when possible; otherwise it is reported as uncertain rather than blindly creating another connection. Missing or corrupt Controller bank state pauses provider operations. Partial bank import failures are reported to the requesting device. A paired client never falls back to importing locally when Controller is paused or unavailable.

The always-running host refreshes shared Finances settings before linking or importing, using the existing merge-aware settings writer. Changes such as a blank vault-root destination take effect at the next operation without restarting the host. Files already identified by finance ID continue to be updated in place. This adds no automatic folder migration or new note schema.

Unpaired desktop installations retain the earlier local-browser connection flow. Unpaired mobile devices must pair a Controller before Connect/Reconnect becomes available. Manual records work independently on every device. Existing bank tokens are neither copied to mobile nor merged across desktops. Production institutions and OAuth eligibility remain subject to the user's own Plaid account; scheduled reads do not force a bank refresh or call the paid Transactions Refresh endpoint. No fund transfers or trading operations are added.

**Settings/API:** the existing four destinations remain **Plaid setup** (default, direct Controller handoff), **Data & routing**, **Connections**, and **Rules & budgets**. Connections now shows shared banks, Controller status, and recent resumable requests when paired; local bank actions remain for unpaired desktop installations. Native buttons, stable status text, keyboard focus, and wrapping mobile controls avoid rerendering an active sign-in button every poll. `api.controllerFinanceBackend` version 1 supplies host-only provider operations; `api.openConnectionSettings()` opens the Connections destination. The only new Item field, `linkRequestId`, is a local SecretStorage completion receipt. No existing setting defaults or commands are removed.

**Validation:** hosted-provider tests cover modern and legacy result shapes, OAuth update completion, duplicate-item rejection, persisted exchange receipts, environment/cursor preservation, lost host state, refreshed shared settings, and client-only routing. Full mobile-bundle tests cover paired bank requests without Node/Electron as well as existing manual workflows and unpaired guards. Controller tests independently simulate delayed device synchronization and recovery failures. A real Plaid Sandbox browser session completed the synthetic First Platypus Bank OAuth flow and produced four account notes and 241 transaction notes in an isolated Inbox fixture. The full suite, separate final build/deployment, test-vault reload, desktop settings, and mobile-emulated connection controls are required for the release. Physical iPhone/iPad sign-in and production-bank acceptance still require device testing after the BRAT pull.

### Earlier mobile compatibility — 1.3.2

Version 1.3.2 removed the desktop-only manifest restriction and deferred Node's HTTP module until desktop Link is invoked. Manual records and dashboards already worked on mobile; 1.4.0 adds paired mobile bank authentication through the Controller without loading that callback server.

## Vault-root storage

In **Data & routing → Finance folder**, leave the field blank (or enter `/`) to write new finance notes and Bases directly in the vault root, without category subfolders. The empty value survives closing settings and reloading. A missing setting on a new installation still defaults to `Finances`; named folders keep their existing layout.

Existing identified finance records stay where they are and remain discoverable in root mode; this is not a bulk move. Accounts, transactions, and holdings are updated by identity instead of duplicated after changing the destination. Root views filter by finance properties, and ordinary notes are not treated as rules, budgets, or snapshots. Name collisions preserve existing content. Atomic line transactions retain their configured Daily Note/account-note routing.

Patch **1.3.1** fixes the empty-value fallback in both the settings field and persistence normalization, and removes folder assumptions from writers, readers, and generated Bases. Regression coverage includes persistence, flat manual/provider records, folder-to-root identity reuse, unrelated-note exclusion, and collisions. All 114 tests and the separate production build passed; the build deployed only to the test vault. After a plugin reload, UI QA cleared Finance folder, verified its blank persisted value, reloaded again, and created a synthetic cash-account note directly at the root. Original settings were restored and QA outputs archived. No provider call was made.

Root mode discovers finance records across the vault. Duplicate identities or broken account links in old records must be repaired; they are not silently ignored. The test vault contains an older cash fixture with a missing account link, so its combined root dashboard correctly reports that error. Isolated root dashboard/read/write cases pass the regression suite.

## Records and valuation

Atomic note mode stores each account and transaction as its own note with stable identity. Existing records are preserved when transport moves to Controller; no bank reconnection or note migration is required for 1.3.0. Cursors commit after successful ledger writes. Imported transactions preserve manual classifications.

Manual cash balances combine the opening balance with signed cash transactions. A transfer is one record with two account effects, not two duplicate expenses. A house, car, or computer uses a manually entered resale value and optional purchase/loan links; updating that estimate does not create cash income.

Holdings use the most recently synchronized provider price/value and dated snapshots, not a guaranteed real-time market feed. Retained data after a provider outage is last-known. Plaid categories are retained as `providerCategory`; a manual override or matching rule supplies the effective category. Monthly category budgets are durable `financeBudget` notes. Currency totals are not silently converted; existing category budgets are USD-only.

## Settings and compatibility

The four settings destinations are **Plaid setup** (Controller handoff), **Data & routing**, **Connections**, and **Rules & budgets**. Selection is transient; account actions remain in Finances.

Atomic line compatibility: Bank and investment transactions are plain `log` bullets in the configured daily note. Each account card can inherit that default or explicitly choose daily notes/account note. Changing either route moves existing identified transactions to the resolved owner; it does not keep mirrored copies. See [the reference](REFERENCE.md) for the legacy line format and conversion history.

Paired devices share the Controller’s existing Plaid Items. Unpaired independent connections can still create separate Items and subscription charges under your Plaid plan; avoid duplicating banks on other desktops. Finances does not transfer funds or place trades. Live bank access and physical-device behavior are not established by mock-provider tests.

## Development and repository policy

`main` is the stable source line. Numeric tags identify immutable released artifacts. `optimization` is an unreleased work-in-progress lane; do not install it through BRAT or merge it into stable without separate validation.

The supported build lives inside `Obsidian Plugin Test Vault/Plugin Development`, with `TPS-Finances (Dev)` as the mapped stable source. These repositories depend on adjacent shared tooling including `deploy-runtime.mjs`; a standalone clone is not currently self-contained.

From the contained workspace, prepare dependencies using the shared helper, then run tests and a separate final build:

```sh
# From Plugin Development:
node ./prepare-dependencies.mjs "TPS-Finances (Dev)"
cd "TPS-Finances (Dev)"
npm test
npm run build
```

Dependencies stay in the vault's `.plugin-dev-cache.nosync` through a relative `node_modules` symlink. Use a clean, current checkout; preserve unrelated changes and never build an old dirty worktree into the test runtime. Stable builds deploy only shipped artifacts to the test vault. Optimization builds are build-only. Runtime `data.json`, secrets, caches, and session state never belong in Git.

Documentation-only maintenance does not create a new plugin version. Published release tags and assets are preserved. Do not rely on legacy version/release scripts without reviewing their current behavior. Production updates remain the user's BRAT handoff.

For prior feature details and release-specific evidence, see [REFERENCE.md](REFERENCE.md) and [GitHub releases](https://github.com/ZachTish/tps-finances/releases). The September 16 cleanup changes documentation and repository metadata, not shipped behavior.
