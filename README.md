# TPS Finances

## Built-in settings search

On Obsidian **1.13.0 or newer**, the global **Search settings** field finds controls across all this plugin's destinations, including sections that are not open. It searches the published control names, descriptions, option labels and help text. **All settings** is a native settings directory; activate a result there to open the existing destination and focus the matching control. Choosing a search result never runs its named action, saves preferences, enables a feature, or changes notes. Conditional controls remain conditional; when unavailable, the destination explains that a relevant feature or saved item must be selected first.

The existing **Choose what to configure** hub, default destination, one-level disclosures, controls and save/migration owners are preserved. Navigation and result focus are transient. Native settings pages provide the directory's desktop/mobile layout and keyboard navigation; existing destination styles and mobile controls remain unchanged. Older supported Obsidian versions retain their normal settings UI without native search integration. Physical-phone acceptance is separate from desktop QA.

Search metadata is generated at build time from the existing UI copy in `scripts/settings-search-config.mjs`'s source list. After editing settings copy or adding a route, run `npm run settings:search`; tests and builds reject a stale catalog. Configuration helpers and selectable property tables are included explicitly. Runtime definition enumeration reads no vault files, note bodies, credentials, network or hidden-page DOM. There is no new watcher, timer, scan or persisted index. Existing conditional editors still mount only through their original owner when their area is opened.

The settings/action inventory is preserved in source; focused regressions cover catalog freshness, every indexed entry and destination, description/placeholder aliases, read-only navigation, 1,000 metadata-enumeration calls without UI/I/O/saves, disclosure focus and disabled-control visibility. The full declared suite and separate final build remain required. Release notes record installed search, route, state-preservation and performance evidence.


TPS Finances reads account, holding and transaction notes, calculates balances and budgets, and provides manual cash and resale-asset workflows. External Bank/Wallet imports belong to the TishOS app. Finance does not connect to providers or synchronize imports. Opening a view does not generate files.

Version **9.0.0** requires Obsidian **1.12.0+**.

Installed acceptance: all existing destinations were inspected in the reloaded desktop test vault. Native archive results and keyboard navigation were checked without executing maintenance actions or changing saved preferences. Conditional controls stay disabled/hidden until their existing prerequisites are selected. Existing mobile CSS is retained; physical phone acceptance remains separate.

## Use

- Use your own native **Bases** and **Canvas** for accounts, holdings, transactions and goals. The custom Finance/Budget dashboard, ribbon, Open finances command, GCM dashboard shortcut and home-summary renderer are removed. Existing notes, Bases, Canvas files and settings are untouched; no replacement dashboard is generated. Close any saved obsolete dashboard tab.
- **Add cash account**, **Log cash transaction** and **Add resale asset** create manual records. Cash balances combine opening balance and signed transactions; a transfer has two account effects without becoming two expenses. Updating a resale estimate changes the asset value and valuation date, not cash income.
- **Add categorization rule** and **Add monthly budget** retain their explicit actions. **Open Budgets Base** opens the existing Budgets.base under the configured Finance folder; it never creates or rewrites one. **Edit current finance record**, also available in the note context menu, opens the existing budget, manual asset-value or transaction-classification editor. Saved categories, ordered rules and imported category data contribute to classification; optional empty fields are omitted at their existing writer.
- **Review transaction titles** previews title changes. **Review transaction records** additionally previews known empty provider fields. Both start unselected, preserve bodies and unrelated properties, and reject records changed since review. Manual cash entries are excluded. These actions do not contact providers.

Finance registers no dashboard view and no metadata-change, rename or delete listener to refresh one. Native Bases owns display updates. Explicit record edits retain their existing atomic/conflict guards and settings migrations remain user-invoked.

Holdings use recorded values and dates, not live market quotes. Currency totals remain separate; Finance does not convert currencies, transfer money or place trades.

## Settings and owners

The always-visible **Choose what to configure** hub has three destinations:

| Destination | Controls and actions |
| --- | --- |
| **Data & storage** — default | Finance folder, debug logging; one **Older records** disclosure contains Check old entries, Convert to transaction notes and Review existing IDs. |
| **Rules & budgets** | Add rule, Open Budgets Base and Add budget. |
| **Properties** | GCM settings handoff, Save property names, Discard edits and a selector for the five existing mapping groups. Current fields appear first; one **Imported and older records** disclosure holds that group's other mappings. A pending migration instead shows Resume migration. |

The folder default is `Finances`; blank means vault-root records without generated subfolders. Changing it does not move existing notes. Global Context Menu owns shared record classification, Scheduled and primary-ID configuration. With its v2 contract, kind/date appear as managed information instead of duplicate editors; saved Finance aliases remain readable. If GCM is installed but its required API is not ready, Finance blocks record work until that authority is available. Standalone primary identity defaults to `id`.

All **57** existing business-property mappings remain available. These are names used by the codec, not switches controlling which values an importer writes:

| UI placement / owner | Logical mappings |
| --- | --- |
| Current manual/shared fields (30) | `kind`, `type`, `title`, `date`, `currency`, `tags`, `financeSource`, `category`, `account`, `amount`, `subtype`, `transferAccount`, `linkedTransaction`, `accountType`, `accountSubtype`, `current`, `openingBalance`, `valuationDate`, `purchaseTransaction`, `liabilityAccount`, `enabled`, `priority`, `accountContains`, `nameContains`, `merchantContains`, `minAmount`, `maxAmount`, `monthlyLimit`, `bucket`, `accounts` |
| Imported or directly edited data, read by Finance (23) | `authorizedDate`, `pending`, `merchant`, `providerName`, `providerTitle`, `providerCategory`, `providerCategoryDetail`, `investmentType`, `institution`, `accountMask`, `available`, `limit`, `name`, `ticker`, `holdingType`, `quantity`, `price`, `fees`, `value`, `costBasis`, `asOf`, `stale`, `active` |
| Older mappings and explicit conversion (4) | `accountName` reads older names; `categoryOverride` reads older categories; `transactionLogTarget` remains available for saved mappings and explicit renames; `migrationSource` is written by explicit older-entry conversion to verify its source. |

The second and third rows sit in the disclosure. Normal manual actions do not add imported fields; explicit conversion can preserve source values. TishOS controls its own import output. Finance's `type` discriminator is only needed when configured transaction kinds otherwise overlap. The existing five groups remain Common, Transactions, Accounts & assets, Holdings, and Rules & budgets.

Editing a name pins it in `propertyNames.keys`; its toggle restores the default name, not whether the field is written. Save/Discard precede the fields. A default-valued pin changes settings without scanning notes. An actual rename previews affected records and offers **Migrate and save**, **Save without migrating** or **Cancel**. Renames preserve identity values and bodies and reject collisions. Declining migration leaves notes unchanged; ordinary property renames do not add historical aliases. GCM's saved kind/date compatibility is a separate existing contract.

A confirmed rename uses the existing temporary migration journal and atomic conflict checks. Interrupted work pauses Finance operations until explicit Resume. Only exact generated, uncustomized Bases can be updated by the existing migration owners; customized Bases, external queries and other plugins' settings remain user-owned. Installation, navigation and settings opening never perform note cleanup.

Route, group, draft, disclosure, focus and scroll state are transient. There are no new persisted settings or defaults in 9.0.0. Disclosures are native and never nested; rerenders preserve a visible open disclosure and restore the invoked control's focus. Native buttons expose route selection, fields have labels, and focus remains visible. On narrow screens the route strip scrolls horizontally, controls stack, text wraps and buttons retain usable height. All settings CSS is Finance-namespaced.

## Whole-note-only transactions

Accounts and transactions use whole notes with stable identity. New manual transactions use an account wikilink without a duplicate foreign-account field; holdings resolve that link with a legacy-reference read path retained for older data. New accounts use their title without duplicating accountName. New categories use the shared category property; explicit category edits remove the selected older override. Empty optional rule, budget, link and provider-bookkeeping fields are not invented by manual creation.

Old inline entries are handled only by **Data & storage → Older records**. Check is read-only; conversion is explicit and retains source/identity verification. Old review markers can block writes until checked or converted; they do not select a live alternate storage mode. Review existing IDs previews matching duplicate self IDs, leaves legacy-only records readable and does not rewrite account/security references. Supported legacy readers remain; there is no automatic migration or repair loop.

Retired import settings have no runtime importer. Ordinary settings saves omit retired environment, redirect and history options while preserving opaque/private state and saved secret references. This release does not inspect credentials or remove properties from existing notes.

## Budgets

The recurring monthly plan separates Income, Fixed expenses, Flexible spending and Savings. Left to allocate is planned income minus fixed, flexible and savings allocations. Flexible remaining subtracts actual flexible spending from the allowance; category caps do not add to that allowance. Refunds reduce spending; transfers and credit-card repayments are excluded from ordinary expenses.

Savings targets link account notes and measure posted contributions minus withdrawals, not account balances or market gains. Each account belongs to one savings target per currency; matching internal transfer legs cancel. Missing legs, different posting months or ambiguous older investment classification can affect the result and must be reviewed. The retained calculation functions include pending ordinary income/spending, while savings uses posted movements. Calculations use an explicit month and currency without currency conversion. Changing a goal changes the recurring plan for all months; no historical snapshots, monthly overrides or rollovers are created.

Targets remain ordinary notes with the shared identity, title, monthly limit and optional bucket/currency/category/account links. Budget editors preserve custom fields and bodies and reject stale edits. Invalid identities, duplicate targets and broken links are surfaced. Goal-linked dynamic Bases replacement remains separate prototype work, not shipped behavior.

## Integration and development

The existing public `api` retains read-only `getDashboardModel` (its historical API name; no UI is created), transaction-Base and Daily Note paths, classification-Base preview/signature, and a versioned connection-settings retirement panel with disposal. The rendering APIs `openDashboard` and `renderHomeSummary` are removed. It exposes no provider importer. Controller is not required for manual Finance; GCM contracts coordinate shared record storage when present. Source modules `finance-properties.ts`, `manual-finance.ts`, `atomic-finance-store.ts` and `finance-store.ts` own mapping and persistence; settings only routes existing actions.

Build dependencies are declared locally: TypeScript, esbuild, Obsidian typings, Node typings, builtin-modules and YAML. Runtime uses Obsidian's APIs and bundled code; the mobile bundle must not import Node built-ins. Run the declared `npm test`, then a separate final `npm run build`. Neither command deploys or reloads any vault. The workspace source map and release checklist own explicit test deployment and publication.

Regression coverage retains actual finance model/mapping/writer tests, metadata-only reads, cash balance calculations, budget edits, identity conflicts and read-only Base navigation. Retirement coverage checks startup and 1,000 event bursts perform zero scans, body reads or writes, and verifies the retained note editors and command/menu ownership. The existing settings tests preserve all 57 mappings and all three routes; only dashboard launchers are removed. Exact release/test-vault evidence is in [9.0.0 release notes](release-notes/9.0.0.md). No physical-phone acceptance is claimed.

## Install and history

Install published numeric releases through BRAT with `ZachTish/tps-finances`. A public release, test deployment, production installation and phone acceptance are distinct states. Production/private-state changes require their own authorization. An older plugin can restore its retired execution paths if enabled; retained private state is not erased by an update.

Current behavior is specified here. Prior narratives and validation remain in existing Git history, [release notes](release-notes/), [historical reference](REFERENCE.md) and [public releases](https://github.com/ZachTish/tps-finances/releases). Historical connection/setup instructions are not the current workflow.
