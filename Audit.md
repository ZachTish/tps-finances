# TPS Finances audit status

This historical audit is retained only as a pointer to the current implementation spec in `README.md`.

Resolved through 0.4.2:

- Plaid credentials, connected Item tokens, cursors, and identity state use device-local Obsidian SecretStorage; plugin data stores only secret names and non-secret preferences.
- Connect and sync actions are single-flight and surface failures in Obsidian.
- Stable `financeId` values deduplicate provider changes and removals.
- Transaction and snapshot mutations use atomic vault processing, and reroutes confirm the destination before removing the source line.
- Rule, budget, and classification modal saves disable while in flight and report persistence failures.
- Transport, persistence, and dashboard rendering are separated into focused modules.

Current intentional limitations:

- Plaid authentication and synchronization are desktop-only.
- One Mac should act as the synchronized writer; other devices consume the durable Markdown logs and snapshots.
- Optional Investments products may be temporarily unavailable and retry without erasing last-known holdings.
- Production Plaid products can carry subscription costs controlled by the Plaid account.

See `README.md` for the authoritative contract, privacy policy, validation coverage, and version notes.
