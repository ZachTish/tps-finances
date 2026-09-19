# TPS Finances 1.6.0

Atomic transaction notes no longer accumulate empty provider fields. A new **Review transaction records** command previews readable-title corrections and empty-property cleanup for existing notes, then applies only selected changes.

## Changes

- New imports omit empty optional merchant, authorization, subtype, category-detail and investment fields. Provider corrections remove stale optional data; identical retries do not rewrite notes.
- The new review lists each property to remove. It preserves custom titles, populated fields, real zeros, amounts, dates, currencies, identities, tags, category overrides, user properties, note bodies, paths and links. Manual cash records are excluded.
- Transfer and investment title reviews normalize spacing without dropping trade details. Untracked missing titles can be recovered from retained provider descriptions. The existing **Review transaction titles** command remains title-only.
- Applying a preview rechecks current frontmatter inside the atomic write. Changes to identity, ownership, title or reviewed optional fields require a fresh review. Failed writes retain unfinished selections.

No settings or existing commands were removed. There is no automatic historical scan, personal-vault migration, forced resync or new bank connection. Atomic-line storage is unchanged.

## Validation and handoff

- 209 tests passed, including new import/correction/cleanup regressions and existing provider, manual-finance, safe-retry and mobile-loading coverage.
- A separate final production-mode build passed and deployed only shipped files to the isolated Obsidian Plugin Test Vault.
- Reloaded version 1.6.0; source and test-runtime artifact hashes match. Runtime settings retained their pre-build checksum.
- Synthetic UI QA verified three selected record cleanups, unchanged manual records, custom titles, zero fees, tags, body links and empty user properties. Space and Enter keyboard controls worked. Desktop and 390-pixel layouts were inspected without horizontal overflow.
- Physical iPhone/iPad validation remains pending user testing. Production records were not changed.

This is a minor release for the added maintenance workflow. Minimum Obsidian version: **1.12.0**; shared Controller banking requires **1.12.3+**. Tested in the test vault and ready for the user's BRAT pull; not installed into production by this release.

## SHA-256

| Artifact | SHA-256 |
| --- | --- |
| main.js | `2ea10a4a4b311d12f81c3ec83d5d65311c7786cf4c4244d4a59b6b13e4d4bc2f` |
| manifest.json | `8d555b7d7feba97b362801efb753f8981c24fa5e48ea7417108ce1bb871c5573` |
| styles.css | `c88e7e36dfd95a92bed5b6cef2ffb6a9d51e3abc010fcefa18a22f706d717f62` |
