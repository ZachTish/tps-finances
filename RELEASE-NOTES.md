# TPS Finances 1.1.0

Tested in Obsidian Plugin Test Vault and ready for the user's BRAT pull. This release is not installed in production. Minimum Obsidian: 1.12.0; desktop-only.

## Changes

- Reconnect repairs expired Plaid authorization through update mode while retaining the existing Item, access token, identities, and cursor.
- Cash, investments, debt, and net worth are calculated separately per currency. Account balances take precedence over holdings. Overpaid credit balances retain the correct sign.
- Refunds reduce spending; identified credit-card repayments do not count purchases twice. USD budgets exclude foreign currencies.
- Matched pending-to-posted transitions preserve the local note, category, tags, and body.
- Unchanged provider transaction revisions skip writes, and per-note metadata events do not repeatedly refresh the dashboard during sync.
- Atomic dashboards exclude unrelated finance collections while retaining moved records linked to their own accounts.

## Validation

91 tests passed with no skips/failures; TypeScript and the mandatory separate production build passed. The build deployed only to the isolated test vault. Reload preserved settings and connections. All four settings routes were inventoried; the dashboard and budget creation modal were exercised.

Actual Safari Sandbox Link imported 14 accounts, 394 bank transactions, 1,169 investment transactions, and 13 holdings. All account balances and all transaction amounts/dates matched independent API reads. A one-Item repeat sync took 4.7 seconds without duplicates. Forced login expiration preserved the checkpoint and last success, then the actual Safari Reconnect flow repaired the same Item.

A second dynamic Sandbox Item exercised pending-to-posted updates, retaining an annotated note's identity, category, tags, and body. A two-Item repeat sync retained 16 accounts, 1,694 unique transactions, and 13 holdings in 8.7 seconds. The UI-created $100 budget showed $39.35, matching the categorized record.

## Limits

Sandbox does not prove real-bank OAuth behavior or physical mobile compatibility. Connection/sync remains desktop-only and user-initiated. Category budgets are USD-only; no exchange-rate conversion, double-entry reconciliation, tax filing, or money movement is implemented. The original two-year import on 1.0.0 took about 13 minutes in the iCloud test vault; repeat-sync timings are observations, not first-import guarantees. The dynamic test institution has no investment accounts and correctly reports optional Investments unavailable. Existing user settings and credentials remain unchanged; two Sandbox test connections remain for inspection.

## SHA-256

- main.js: `b77363aad54d4526fa8abc2a3c26ab136c28a358db043916305f750320b2af98`
- manifest.json: `f42a7cd0c724246cec4c809d88473c59d11da1997bf8b80aaf11716bd594f3b3`
- styles.css: `2f1e226e1e001dca3f42af78827e0770ca19ad81e304e4baba44717d9a27a6e0`
