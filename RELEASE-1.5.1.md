# TPS Finances 1.5.1

Imported atomic-note transactions now use the provider's readable merchant name when available. For example, `PURCHASE WM SUPERCENTER #1700` becomes `Walmart`; transfers without a merchant and investment trades retain their description. This patch fixes title selection and preservation without changing account connections or transaction identities.

- Keep the imported description in `providerName` and the last generated title in `providerTitle`. Sync respects manually edited titles, including edits made during a provider update. Existing description-based categorization rules still work.
- Add **Review transaction titles** to the command palette. Preview/select changes for existing atomic notes; no notes are changed simply by opening the review. Stale previews and partial failures are handled without discarding pending work or repeating completed changes.
- Preserve filenames, links, custom properties, bodies, tags and category overrides. Manual cash records are excluded. Atomic-line title behavior remains unchanged.
- Make the review usable with native checkboxes, Enter/Space, clear focus, pagination and wrapping narrow-screen controls.
- Include a researched Cash App/Venmo/PayPal connection assessment. No SimpleFIN/MX integration or new bank connection is added by this release.

## Validation and compatibility

All **201 tests passed**, including provider import/retry behavior, concurrent manual title edits, legacy title review, failed/stale writes, categorization, keyboard scope, partial-save retry and mobile loading without Node. A mandatory separate `npm run build` passed after the final source/README edits and deployed only shipped artifacts to **Obsidian Plugin Test Vault**. The final plugin was reloaded there; synthetic note import/review and a 390-pixel layout were checked. Runtime-owned `data.json` remained byte-identical, and QA fixtures were moved to `_archive`.

Minimum Obsidian **1.12.0**; shared Controller banking still requires **1.12.3+**. Physical iPhone/iPad behavior and real Cash App connections were not tested. Merchant quality depends on provider data. Old ambiguous titles require the review command; no historical resync or startup migration is forced.

Tested in the isolated test vault and ready for the user's **BRAT pull of 1.5.1**. This is not a production installation or user acceptance claim. The canonical older checkout's unrelated edits were preserved in place; release work used a clean stable worktree based on published main.

## SHA-256 of tested release artifacts

| Artifact | SHA-256 |
| --- | --- |
| main.js | b4287eb417ba995a1a1fb6985c37cf131fa89ee52e5cf0f2b5d6239f7e4bef64 |
| manifest.json | 3e27c3b65e0069dc7468467764ad40a77c634b67295dbd71ce78ab9be9389d84 |
| styles.css | c88e7e36dfd95a92bed5b6cef2ffb6a9d51e3abc010fcefa18a22f706d717f62 |
