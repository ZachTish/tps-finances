# TPS Finances

Accounts, transactions, investments, manual cash, budgets, and manually valued resale assets in Obsidian.

Current release: [1.3.1](https://github.com/ZachTish/tps-finances/releases/tag/1.3.1) · Obsidian 1.12.0+ · Desktop only.

## Install with BRAT

Add `ZachTish/tps-finances` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Connect and use

1. Install/update **TPS Controller 1.3.0+** before Finances. Plaid operations require Controller's Obsidian 1.12.3 minimum; manual finance records remain available independently.
2. Open **Plaid setup → Open Controller settings**. Select the environment and separate client-ID/secret references under **Advanced → Plaid**. These preferences are device-local; credentials and Item tokens stay in SecretStorage.
3. Return to **Connections** to connect an institution, sync, reconnect, or disconnect. Link authentication is desktop-only. Use Sandbox for synthetic testing; Production connects real institutions under your own Plaid account and terms.
4. Use **Open finances** for balances, holdings, transactions, categorization, rules, and budgets. **Add cash account**, **Log cash transaction**, and **Add resale asset** also work without Plaid.

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

Each device connects independently. Separate Plaid Items may incur separate subscription charges. Finances does not transfer funds or place trades. Live bank access and physical-device behavior are not established by mock-provider tests.

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
