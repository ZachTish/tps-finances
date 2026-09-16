# TPS Finances

Accounts, transactions, investments, manual cash, budgets, and manually valued resale assets in Obsidian.

Current release: [1.3.0](https://github.com/ZachTish/tps-finances/releases/tag/1.3.0) · Obsidian 1.12.0+ · Desktop only.

## Install with BRAT

Add `ZachTish/tps-finances` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Connect and use

1. Install/update **TPS Controller 1.3.0+** before Finances. Plaid operations require Controller's Obsidian 1.12.3 minimum; manual finance records remain available independently.
2. Open **Plaid setup → Open Controller settings**. Select the environment and separate client-ID/secret references under **Advanced → Plaid**. These preferences are device-local; credentials and Item tokens stay in SecretStorage.
3. Return to **Connections** to connect an institution, sync, reconnect, or disconnect. Link authentication is desktop-only. Use Sandbox for synthetic testing; Production connects real institutions under your own Plaid account and terms.
4. Use **Open finances** for balances, holdings, transactions, categorization, rules, and budgets. **Add cash account**, **Log cash transaction**, and **Add resale asset** also work without Plaid.

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
