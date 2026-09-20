TPS Finances 1.7.0 makes note property names configurable under **Settings → Properties**. Previously, names such as `type`, `accountType`, and `amount` were fixed in storage code. All 57 non-ID frontmatter fields now share one mapping across writers, readers, manual records, provider imports, budgets, categorization, dashboards, maintenance, and generated Bases.

When names change, the confirmation offers **Migrate and save**, **Save without migrating**, and **Cancel**. Migration moves values to the new keys and removes the old keys. Declining leaves existing note properties untouched. Finances reads only the configured names; no fallback aliases or historical name lists are retained.

Existing values, IDs, filenames, bodies and unrelated properties are preserved. Conflicting destination values block migration. A temporary durable journal permits resuming interrupted work from Properties and pauses finance operations until completion. Uncustomized generated Bases are updated; customized Bases and other plugins' mappings are left for the user to edit. Atomic-line annotations keep their existing format. Default property names and classification values are unchanged.

This is a backward-compatible minor release. Minimum Obsidian: **1.12.0**; Controller banking still requires **1.12.3+**.

Validation:

- All **233 tests pass**, including 24 property/migration regressions and existing mobile loading checks without Node dependencies.
- The mandatory separate production build deployed only shipped files to **Obsidian Plugin Test Vault**, followed by a targeted plugin reload.
- Actual settings UI exercised Cancel, keyboard activation of Migrate and save, and Save without migrating using isolated synthetic records and in-memory configuration. Migrated records retained their amount/body and remained readable; the declined old key stayed untouched and was no longer read as the configured field.
- Final 1.7.0 runtime verification migrated both transaction `type` and account `accountType`, preserved the body and verified the readable transaction count. All five settings destinations and all 57 property controls were rendered and inventoried. Desktop UI and a 390-pixel content viewport were checked; no horizontal content/control overflow.
- Test runtime settings remained byte-identical. No live bank request, personal-vault migration, production installation, or credential change was performed. Synthetic fixtures are archived in the test vault.

Known limits: physical iPhone/iPad testing remains the user's BRAT acceptance. Saving without migration can make older records disappear from finance views until their properties are updated. Missing/moved journal targets must be restored before resuming. Other plugins, custom queries/Bases and Obsidian's built-in behavior for names such as `tags` are not reconfigured automatically.

Published artifacts are the tested files. Ready for the user's **BRAT pull of 1.7.0**; not claimed installed or accepted in production.

SHA-256:

```text
1179bd4f6c11a428460183d2f16026d3edcbca1a882bbfe3b47718fba63badbb  main.js
4e24ba3532620477009d40ac9213aacc5725ad6d6f8854e2c968a6f3e8201b2a  manifest.json
eba7034ae1621bf76bd2ac78ff9de0983ed1486b257832cda19423fc35eb4564  styles.css
```
