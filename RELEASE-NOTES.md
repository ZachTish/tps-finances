# TPS Finances 1.2.0

Tested in Obsidian Plugin Test Vault and ready for the user's BRAT pull. Minimum Obsidian: 1.12.0; desktop-only. Production was not accessed or updated.

## Changes

- Add cash accounts and log cash expenses, income, and transfers without Plaid. These are atomic notes in either record mode.
- Cash balances derive from opening balances and signed transactions. Editing or trashing records recalculates both cash-transfer legs; Plaid balances stay provider-owned.
- Track houses, cars, computers, and other resale assets with manually entered values and valuation dates. Update value from the account card, and optionally link existing purchase and loan notes.
- Resale assets contribute once to net worth, separately from cash/investments. Valuation edits do not create income or subtract linked debt twice.
- Preserve existing settings and actions; add three commands and an Add menu. The header wraps in narrow panes and buttons have accessible names and visible keyboard focus.

## Validation

103 tests passed, followed by the mandatory separate production-mode build and test-vault deployment. Reload verified version 1.2.0, all eight commands, unchanged settings and connections, and the original 16 Sandbox accounts, 1,694 transactions, and 13 holdings.

Actual UI creation recorded a $100 wallet and a $12.50 tagged cash expense, created a $900 computer, and updated its value to $800. Runtime tests verified expense edits ($75 remaining), a $20 cash-to-cash transfer ($55/$220), deletion restoring $75/$200, and Atomic line compatibility. Final reloaded UI showed the restored $87.50 wallet, $200 safe, and $800 computer. Add menu, conditional transfer fields, keyboard invocation, and narrow-pane layout were inspected. Temporary settings were restored and synthetic fixtures archived. No new provider calls or credentials were needed for these local features.

## Limits

Values are manual; there is no automatic appraisal, depreciation, valuation history, or exchange-rate conversion. Cash account notes store the opening balance; their current balance is calculated in the dashboard rather than persisted as a stale property. Purchase/loan/bank-transaction links are references, not automatic matching or reclassification. Record each cash transfer once. Existing category budgets remain USD-only. This release does not add a mobile plugin runtime or perform money movements.

## SHA-256

- `main.js`: `1f8908e7d757d449b36b7fcc2a4a5cd5d72a5028edf520e87f11844049cb43e2`
- `manifest.json`: `0f1f1cda9a6b8be0dd6add6b0179a84ba6a5ee398c37fede97bd08cc63c61c5d`
- `styles.css`: `8e27996858499ba41d9c6c62cc89c4d05cde2f2605577edacc73d3140809ad4c`
