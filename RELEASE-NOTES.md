# 1.0.0

Each transaction, account, and current holding can now be an atomic Markdown note with ordinary properties and core Bases views. Atomic note is the default; Atomic line remains available. This major release changes the default storage format.

- Preserve existing Plaid connections, cursors and finance identities; no bank reconnection is needed.
- Preserve user note bodies, unrelated properties, categories and tags during transaction updates; provider removals use configured trash behavior.
- Convert owned ledger lines by saving/verifying their notes before replacing exact source lines with local links. Interrupted work can resume; ambiguous records stay in place and block sync for review.
- Balances and holdings live on notes; atomic mode creates no new line snapshots. Disappeared holdings become inactive.
- Replace exact old generated transaction/holding Bases with core tables; customized Bases remain intact and receive separate atomic views.

Known limits: bank linking/sync remains desktop-only and manual/API-triggered. Mobile can use synced notes and core Bases; physical iOS and real Plaid authentication were not tested. Existing ledger readers remain available until conversion. There is no automatic reverse conversion to lines. The recovery property migrationSource preserves the original migrated line. Protect identity fields and avoid reconnecting accounts unnecessarily on Plaid's free plan.

Validation: 81 tests passed. Actual test-vault QA verified duplicate prevention, posted correction, preserved classifications, conversion of an existing line into a linked atomic note, two rows in the core Transactions Base, a 500 account balance and 100 holding value from notes. No new line snapshots were created. All four settings routes were inspected. Separate final production-mode builds deployed to the isolated test vault; affected plugins were reloaded. No live bank data or credentials were used.

Minimum Obsidian: 1.12.0. Tested in the test vault and ready for BRAT; publication alone does not install it in production.

## SHA-256

- `main.js`: `dd63c72dd6bb7fe7cb18daefe4f829df39c744170bda363760d5dfb1095c5772`
- `manifest.json`: `5b19088f42839c96069dcafc745ba212180d7021cc6a529b0d169ff4bd33b837`
- `styles.css`: `2f1e226e1e001dca3f42af78827e0770ca19ad81e304e4baba44717d9a27a6e0`
