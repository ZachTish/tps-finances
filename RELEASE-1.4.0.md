# TPS Finances 1.4.0

Phones and tablets can now connect and reconnect banks through a paired always-running Controller, without holding Plaid API credentials or bank access tokens.

- Adds browser-based Plaid Hosted Link with modern/legacy result parsing and reconnect support.
- Routes paired Connect, Reconnect, Sync, and Disconnect actions through Controller; a paused or missing Controller never triggers local fallback imports.
- Shows shared banks, host status, and resumable requests in Connections and the dashboard. Closing a request modal does not cancel the request.
- Persists exchange receipts before imports, preserves reconnect identities/cursors/environment, rejects corrupt host state, and refreshes shared routing settings before bank operations.
- Fixes premature display of the sign-in button and preserves keyboard focus when requests open/close.
- Retains unpaired desktop linking and all existing manual cash, account, asset, transaction, budget, and rule workflows.

This is a backward-compatible minor release. Minimum Obsidian: **1.12.0** for manual workflows; shared Plaid requires **Controller 1.4.0 and Obsidian 1.12.3+**.

## Setup and compatibility

Update **both TPS Controller and TPS Finances to 1.4.0** on every participating device. On the desktop that already owns the bank connection, choose the Controller role and use **Controller → Advanced → Finance server → Use this Controller**. Configure its local Plaid credentials, export a pairing code, then import that code on each other device. Keep `_assets/TPS Finance Relay` included in vault sync. Connect/Reconnect/Sync/Disconnect remain in **Finances → Connections**.

The host must stay awake with Obsidian and vault sync running. Delivery follows vault-sync latency; there is no public listener, tunnel, automatic host failover, or OS background daemon. Hosted sign-in opens in the browser; return to Obsidian to receive completion. Imported notes use ordinary vault sync. Existing independent bank connections are preserved and are not automatically merged. Pairing codes grant access to this shared connection and must remain private.

Physical iPhone/iPad sign-in and production institutions remain device acceptance tests. This release was tested in the isolated test vault and is ready for the user's BRAT pull; it is not installed in production. Plaid product/OAuth access and charges remain governed by the user's Plaid account.

## Validation

- `npm test`: **129 passed, 0 failed, 0 skipped**, including 8 new hosted-provider/host-state behavioral tests.
- Separate final `npm run build`: passed; `[runtime-deploy] target=test`. All **7 complete shipped-bundle mobile-loading tests** also passed against the final `main.js`, without Node/Electron in the mobile environment.
- Reloaded test-vault version 1.4.0; all four settings destinations, Controller handoffs, keyboard focus/dismissal, mobile-emulated Connect/Reconnect, persisted request access, and sign-in-button visibility were inspected through computer use.
- Real Plaid Sandbox Hosted Link: synthetic First Platypus Bank OAuth completed; 4 account notes and 241 transaction notes imported into an isolated fixture. Fixtures were archived and existing runtime settings hashes remained unchanged.
- Physical iOS device behavior is not established by desktop emulation; it remains a BRAT acceptance check.

## SHA-256 of tested release artifacts

| Artifact | SHA-256 |
| --- | --- |
| `main.js` | `1e05002fb9b15479063b709b18c5db1c99ec370873ccda503b3a6108cde88f64` |
| `manifest.json` | `ca526702cfc37daeeeffb0be825dfe9febe982d24c1c356768cc3b24ede9af43` |
| `styles.css` | `780b2a3aa88fbb63f2b347f3fcca3f5f6e08d3f85f5b7cb8bc2d9ab424542127` |
