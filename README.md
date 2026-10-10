# TPS Finances

## 4.0.0 — One primary record ID

Finance uses the shared identity property reported by GCM's public
`nativeRecords.getStorageProfile()` contract. GCM owns that storage profile;
Finance does not duplicate its controls or trust a retired saved identity format.
With GCM absent, the existing standalone default is `tpsId`. An installed but
unready/unsupported GCM blocks record work until its public API is available;
its existing readiness event refreshes a mounted Finance view once, with no
work for an absent consumer or repeated announcement. Property identities are
supported; an unsupported active format or collisions with Finance fields,
classification keys, account/security references or legacy identity names are
reported before writing.

New transactions store their existing local ID only in that shared property.
Account, rule and budget notes use it for their own IDs too. Internal DTO names,
provider-to-local identity maps and ID values are unchanged. Transactions and
holdings retain `financeAccountId` as their account foreign key; `securityId`,
links, filenames, account folders and nutrition fields are unchanged. Holding
updates preserve independently assigned primary IDs. Imported accounts now
prepare their full fields, balances and primary identity in the initial create,
instead of creating a partial note and running two subsequent edits.

Legacy whole-note self IDs remain readable. Existing legacy-only notes keep that
single physical ID during edits; identity-less existing notes cannot acquire an
ID through an ordinary edit. A matching duplicate beside the primary is omitted
by the existing owning edit operation; ordinary display never cleans up notes.
Diverging IDs, duplicated case variants and invalid ID values fail closed.
Metadata candidate selection accepts primary-only records without reading bodies
or decoding ordinary notes with no possible transaction identity. Existing
current-source edit/delete/import guards remain authoritative; unchanged imports
perform zero transaction writes. Generated note Bases accept the configured primary
property or the existing legacy own ID, so unchanged legacy records stay visible. Customized Bases stay user-owned.

**Finances → Properties → Record IDs → Review existing IDs** is an explicit,
finite migration. Its native confirmation previews the target property, note
count and conflicts. Confirmation fresh-reads the finite namespace again and
rejects changed identities/configuration, duplicate ownership and malformed
frontmatter before any mutation. Equal aliases are removed without changing the
primary value. Legacy-only notes already have one own ID and are left unchanged;
Finance does not adopt them into the primary namespace outside GCM's mutation
authority. Each atomic callback checks the current target source bytes.
Scalar edits preserve the body, comments, unrelated properties and line endings.
There is no startup migration, persistent journal, repair loop, poller or watcher.
An interrupted action can be reviewed explicitly again. Exact plugin-generated
Bases are upgraded after consolidation, including a review with only Base changes;
customized definitions remain untouched. This is not a cross-file transaction:
completed changes remain if a later target changes. Duplicate removal changes no
identity ownership. Each target's own complete source is checked at its atomic
write boundary; later unrelated edits remain owned by their existing writers.
Update Finance on every device before creating or consolidating records: older
3.x versions cannot read primary-only transaction/account/rule/budget notes.
This storage compatibility change requires major version 4.0.0. Minimum Obsidian
remains 1.12.0; GCM must expose the public storage-profile API (tested with 8.2.0).

The settings destination map, default route, single disclosure depth and
persisted settings keys/defaults are unchanged. The new action belongs to the
existing Properties destination, before property-name editors. Its transient
review modal has native buttons, Enter confirmation, Cancel, an alert for errors
and focus restoration. It uses the existing mobile layout; no new settings CSS
or persisted UI state is introduced.

Regression coverage includes configurable IDs, own/foreign relationships,
kind-list metadata, same-mtime edits, stale sources, pending-to-posted updates,
manual transfers, holding/rule/budget owners, namespace conflicts, source-byte
preservation and explicit migration counts. Installed QA and final validation
boundaries are recorded in [4.0.0 release notes](release-notes/4.0.0.md).
The versioned full suite passes 467/467 checks (2 connection and 465 Finance),
with no failures or skips. Foreground installed 4.0.0 QA uses native account and
cash-transaction creation and the native migration preview/cancel/confirm flow.
New account and transaction notes have one primary ID; the transaction's account
reference remains. An isolated four-note inventory performs 12 fresh reads across
two previews and the apply preflight, one write, and preserves the migrated note's
body and separate calories/protein/carbs/fat properties byte for byte. A legacy-only
transaction remains byte-identical and readable; the final model has one account,
three transactions and the expected balance of 64. All eight
plugin settings hashes remain unchanged; four fixtures are moved directly to `_archive`.
The migration UI inventory is narrowed to synthetic notes. Namespace and legacy-only preservation
guards are covered by source-level tests; production imports, cold-start timings
and physical iPhone interaction were not measured. The final separate
TypeScript-checked build deploys only to Test, and targeted reload verifies 4.0.0
with GCM 8.2.0. There is no new background scan or discovery writer.
This release is tested in the test vault for the user's BRAT pull. Production
installation and existing-note consolidation are separate actions.

## 3.0.3 — Build Budget details when opened

Budget keeps its plan, totals, actions and complete transaction drill-downs.
Closed flexible transactions, Category limits and Review disclosures now contain
only their summaries and empty content containers. Native disclosure toggles
build or remove only their own content. A budget-row expansion updates that row's
existing button and transaction container without rebuilding the dashboard or
recalculating the plan. Keyboard focus, control identity and surrounding scroll
are retained. Removed controls and repeated native toggle deliveries cannot alter
the current Budget surface.

The existing transient expanded set owns all disclosure and row state, including
Review, across data refreshes and month/currency changes while the view remains
open. A refresh still reads the latest dashboard model and recalculates normally;
month/currency controls redraw from the current model. No persisted setting,
background work, cache, new event listener on the vault or data migration is
added. Disclosure depth, mobile touch targets, action owners and currency
formatting are unchanged. One formatter is shared per Budget render. Calculation
uses each row's existing identity-to-amount map instead of scanning its growing
transaction array; both legs of a manual cash transfer still contribute to that
same map entry and produce one detail row.

This backward-compatible performance/correctness fix uses patch 3.0.3; all
published tags and version metadata were checked before selecting it. Minimum
Obsidian remains 1.12.0. The actual renderer and calculation regressions initially
pass 63/70 on unchanged 3.0.2, then pass all 70 after the fix. They cover 1,000
flexible purchases, lazy category/review controls, expansion bursts, model-read
and calculation counts, native control identity, focus/scroll, stale controls,
refreshed data, month/currency boundaries, 2,000 fixed movements, duplicate IDs
and both manual-transfer legs. The closed synthetic Budget creates 141 nodes
across the stubbed Overview/loading and Budget flow, zero transaction buttons,
one formatter and one Budget calculation pass. A single Rent expansion creates
six nodes, zero model reads/calculation passes/root clears/new formatters and
keeps the original controls. These in-memory counts exclude real Obsidian icons
and must be compared separately from SVG-inclusive installed counts.
The full versioned suite passes all 428 checks
(2 connection and 426 Finance), with no failures or skips; its TypeScript-checked
build is build-only (`target=none reason=TPS_NO_DEPLOY`). A separate build-only
TypeScript-checked build also passes after the documentation changes.

Foreground Test-vault installed QA loads 3.0.3 with all eight active consumers
enabled and the actual Finance view prototype/render queue/native controls on an
isolated synthetic model. Initial Budget has 173 SVG-inclusive DOM nodes, zero
transaction buttons and one formatter, versus 5,203 nodes, 1,002 hidden buttons
and 1,024 formatters on 3.0.2. Native Rent expansion adds six nodes/one source
button, retains all sampled control identities and focus, and adds zero model
reads/full renders/root clears/formatters. Native Category/Food and Flex expansion
constructs 1,000 visible source rows only when opened; closing removes them with
no page redraw. Guarded DOM/Console checks cover Review, action callbacks, new
data and currency changes where dynamic accessibility controls were unavailable.
Refresh updates the selected synthetic purchase and preserves Review expansion;
repeated Budget presentation performs one redraw/formatter and zero model reads.
A 380-pixel container has no horizontal overflow and retains 44-by-44-pixel row
buttons. Original error DOM/settings are preserved and temporary global/DOM/Intl
instrumentation is removed. The existing real Test cash-account-link validation
error was not remediated; populated provider data, cold startup and physical
iPhone latency were not measured. Final build uses only the Test deployment
target and preserves the QA artifact hashes. Tested in the Test vault and ready
for the user's BRAT pull; production installation remains a separate step.
Exact validation boundaries and hashes are in [3.0.3 release notes](release-notes/3.0.3.md).

## 3.0.2 — Late GCM menu readiness

The existing **Open finances** GCM action now becomes available when GCM finishes
loading after Finances. Finances listens to the existing API-readiness event and
keeps one transient registration owner: repeated announcements for the same API
do not replace the action, while replacement or unavailability releases its old
registration before adding a new one. GCM's unload announcement is authoritative
even while its old API remains discoverable. Finances unload removes its current
action and the plugin-owned readiness listener. Labels, visibility and the
dashboard click action are unchanged.

Readiness performs no vault discovery, note reads/writes, dashboard model loads,
provider calls or settings changes. No poller, persistent cache, background
import, new configuration or public API is added. This backward-compatible patch
fixes startup dependency correctness; it is not a measured UI-speed improvement.
Minimum Obsidian remains 1.12.0. Fourteen actual-source in-memory regressions cover
both load orders, repeated/replaced APIs, unload, unrelated/malformed events,
failed registration/cleanup and preserved action behavior. Validation boundaries
and artifacts are recorded in [3.0.2 release notes](release-notes/3.0.2.md).
The versioned declared suite passes all 419 checks (2 connection and 417 Finance),
with no failures or skips; its TypeScript-checked build passes in build-only mode.
The separate final build deployed only to Test. The exact loaded lifecycle passes
all eight isolated readiness checks, versus four before. Targeted reload leaves
one real GCM Finances action; twenty same-API helper calls add no registrations.
Eight active plugins' settings, data and enabled/loaded state stay unchanged.
These hidden/unfocused operation checks do not measure physical input or UI speed;
no production install or provider request was performed.

## 3.0.1 — Failed dashboard source ownership

A settled dashboard error retains the source paths that contributed to or blocked
that read. Ordinary unrelated note edits, renames, and deletions no longer rebuild
the full dashboard after a record-validation failure. The existing per-model file
snapshot records atomic candidates before inspection and records file-specific
metadata/budget failures before rethrowing. Errors stay visible; no note is repaired
or omitted to obtain a successful model. Correcting, deleting, declassifying, or
moving a blocking source, introducing a relevant Finance record, and explicit
owner/settings refreshes still use the existing render queue. In-flight reads and
failures before any source is known retain their conservative invalidation behavior.
No new cache, watcher, timer, retry, setting, or writer is added. This is a
backward-compatible patch; minimum Obsidian remains 1.12.0.
The candidate preflight also stops treating body-only `[financeId::` examples or
legacy-only `type: financeTransactions` ledgers as new dashboard records: whole-note
readers no longer consume them. Actual Finance fields, holding/snapshot types,
configured reader sections, and existing source dependencies still invalidate.

The installed 3.0.0 baseline had an existing cash-account validation error. Three
separate body-only edits of one plain synthetic note each caused one full Finance
model read and 16,757–16,818 all-plugin metadata lookups, with no unrelated vault
events during those edit samples. Quiet idle performed no model or metadata work;
this was event amplification, not an autonomous retry loop. Settings stayed
unchanged and the fixture was archived with its exact final contents. The window
was hidden/unfocused, so these are operation counts, not device-latency evidence.
The focused dashboard suites passed 54 checks, including 24 new actual
reader/view/event regressions with an in-memory Obsidian facade. The full versioned
suite passed 405 checks (2 connection plus 403 Finance), with no failures or skips;
its TypeScript-checked build and separate final build passed. After Test-vault
deployment and targeted reload, the same three body edits caused zero Finance
model reads and 227–282 all-plugin metadata lookups each. The existing validation
error stayed visible, exact note contents and settings were preserved, and
temporary observers were removed. These counts do not measure physical input
latency. See the [release notes](release-notes/3.0.1.md) for full evidence and hashes.

## 3.0.0 — Kind-owned finance identity

With GCM's `frontmatterKinds` v2, a Finance transaction or holding whose configured kind-list value uniquely identifies it no longer needs an authored `type` property. Finances derives the internal ordinary transaction, investment transaction, or holding type from GCM's decoded classification for sync, dashboards, budgets, titles, and identity checks. It writes the configured kind list and keeps `investmentType`, `holdingType`, IDs, dates, values, tags, and other finance fields. A configured shared kind-list value for ordinary and investment transactions still retains the `type` discriminator; Finances will not guess an investment identity from optional provider fields. The Finance property-name setting for `type` remains available to read older records and support shared mappings. A read-only GCM alias for `type: transaction` can identify old Wallet notes without causing new writes to include that key. GCM owns the kind values and any discriminator, so removing an active GCM discriminator is also necessary before new notes can be type-free.

Newly generated whole-note Transactions and Holdings Bases filter on the configured kind classifications rather than relying on `type` or `financeId` alone. GCM v2 generated Base filters use each classification's primary mapping only; read aliases still work in Finance's note decoder but no longer keep old-only notes in generated views. **Migrate existing notes and Bases before installing this version in a vault that still depends on old tag, scalar-kind, or type-only filters.** Existing customized Bases are not rewritten. Snapshot and historical inline-line `type` values are separate formats and remain unchanged. No background migration, scan, repair, or new Finances settings are added. Minimum Obsidian remains 1.12.0.

The versioned suite passed 2 connection and 379 Finance checks, then a separate TypeScript-checked build deployed to the Test Vault. Hot Reload showed the new legacy-type explanation under **Properties** without changing a setting. The dashboard command opened, but an existing Test Vault cash note with a broken account link prevented a populated UI check; the type-free dashboard model passed its focused regression. No provider request or UI record creation was performed. Artifact hashes and the validation limit are in [3.0.0 release notes](release-notes/3.0.0.md).

## 2.1.2 — Explicit Finance field names for external writers

Finances now preserves an explicitly saved property name even when it equals the default. The Properties editor lets you pin or reset each editable name. Pin-only saves change settings without scanning or rewriting notes or Bases; actual renames keep the existing preview and migration flow. This lets external writers read the physical field names from one Finances-owned map and refuse an incomplete configuration. Kind paths and shared Scheduled, title, and record identity keys remain owned by GCM. Minimum Obsidian remains 1.12.0. Validation and release artifacts are in [2.1.2 release notes](release-notes/2.1.2.md).

## 2.1.1 — Preserve legacy investment updates during kind migration

Some older investment transactions have `type: investmentTransaction` but carry the former ordinary-finance tag. Finance now uses that existing type to read the note when GCM settings map both transaction types to the same kind-list value. A differing configured path or a conflicting authored kind list still fails closed, including a differently cased kind property. A direct Finance update writes the configured list and Scheduled field, drops the superseded date field, and retains only tags that GCM's configured writer keeps. It does not scan or repair notes on startup, display, or navigation. Finance contains no fixed path or tag taxonomy; the shared path and aliases come from GCM settings.

This backward-compatible patch changes no Finance settings or IDs and keeps minimum Obsidian 1.12.0. It is intended to run with GCM 7.0.1 so an update can retire old classification tags while keeping manual tags. Regression tests cover legacy reads, mutation round-trips, date folding, and conflicting classifications; a real GCM/Finance codec integration probe checks the installed contract. Full validation and Test-vault verification are in [2.1.1 release notes](release-notes/2.1.1.md).

## 2.1.0 — Configurable kind-list compatibility

When TPS Global Context Menu exposes `frontmatterKinds` v2, Finance records use its configured kind-list mapping for new and updated account, transaction, investment, holding, snapshot, rule, and budget notes. Finances stores no duplicate taxonomy or kind-path setting. GCM's custom **Scheduled** property's key determines the date field written to these notes; Finances continues using its internal `date` value for provider logic and display. Existing Finance property-name settings for kind and date remain saved as read-only legacy aliases while this migration is in progress. In the Finances Properties page, GCM-owned keys are shown for reference and configured through the existing **Configure in GCM** handoff.

Readers accept the configured GCM primary and legacy classifications plus the old Finance kind field. For transaction dates, the configured Scheduled key wins when populated, then the saved Finance date key, then the original `date` key. New notes write the current GCM kind-list path and Scheduled key; mutation of a note with a kind list preserves unrelated list entries. A pre-migration scalar kind can be updated only when the corresponding scalar legacy alias is configured in GCM. GCM's mapping must therefore include the old scalar/tag forms before migrating notes. Missing or conflicting Finance classifications fail clearly rather than selecting a hardcoded kind path. Numeric `priority` on finance rules remains the rule-order field; this change does not turn it into a task-priority tag.

Multiple internal Finance record types can share one visible kind-list value, including ordinary and investment transactions under one configured path. Their existing configurable Finance `type` property supplies the expected record type to GCM's decoder; no new discriminator is written. If that type is absent, GCM leaves an ambiguous authored kind list unchanged instead of guessing. The `kind` key itself can be the configured list key without deleting the decoded internal type during Finance reads.

Generated Finance Bases combine GCM's configured primary and read-only aliases so old and new notes remain visible during the rollout, and use the configured Scheduled key for whole-note transaction columns and sorting. Finances changes only its own uncustomized generated Bases; custom Bases and the production vault's other Bases require separate migration. When GCM v2 has no configured Scheduled key, dated Finance writes and generated-Base creation stop with an actionable error; old dates remain readable. A classification-list key or Scheduled key that collides with another Finance field also stops before a note is changed. If GCM disables writes for a mapped record type, its refusal propagates without a Finance fallback path. With GCM v1 or no GCM, the previous Finance mapping and date behavior remain available for installations that have not adopted v2. The v2 path adds no background scan, note repair, new persisted Finances setting, or write on display. Focused v2 checks cover sync/read/write formats, legacy account reuse, missing-key and disabled-writer failures, configurable key changes, multi-kind preservation, shared visible transaction paths, generated filters and previews, finance-rule order, and repeated metadata display with three scans and zero body reads or write attempts. The actual GCM v2 codec passed a local encode/decode/mutation integration probe. All 374 declared checks pass. Minimum Obsidian remains 1.12.0. The separate final build deployed to the Test Vault, Hot Reload exposed the GCM ownership handoff in Properties, and Finance data.json remained unchanged. No QA provider import or iPhone check was performed. Production-vault behavior remains unverified; hashes are in [2.1.0 release notes](release-notes/2.1.0.md).

## 2.0.0 — Whole-note-only transactions

TPS Finances now creates, reads, classifies, and syncs transactions as individual Markdown notes. The record-format and transaction-discovery selectors, daily-note/account-note routing controls, and inline fallback are removed from active behavior. Provider, Apple Wallet, and manual cash writes use transaction notes; Overview, Home, and the public dashboard model read transaction notes only. **Browse all transactions** opens the generated whole-note Transactions Base, or the preserved alternate whole-note Base when `Transactions.base` was customized. Existing inline entries and account `transactionLogTarget` properties are left in their notes, but they are no longer active records. The saved `transactionLogTarget` property-name mapping remains available for compatibility; it has no routing effect. This removal of supported storage modes is a major version; the minimum Obsidian version remains 1.12.0.

**Settings → Data & storage → Legacy inline transactions** offers **Check old entries** and **Convert to transaction notes**. A previously saved explicit `recordMode: atomic-line` or `legacyTransactionDiscovery: discover` pauses transaction writes, including Controller sync and Apple Wallet import. The dashboard explains the pause. Check old entries freshly reads Markdown notes only when selected and reports the number of remaining `[financeId::` markers and the first path; it changes no notes. A zero-marker check saves the existing legacy settings markers as `atomic-note`/`atomic-only` and resumes writes. Conversion is a separate user action: each verified transaction note is written before its exact old line is replaced with a link, and unresolved lines stay in place. Review and convert any remaining entries, then run the check again. The check conservatively counts malformed markers and examples in code, with an exception for verified conversion provenance. No startup scan, automatic conversion, deduplication, or repair is added.

Older settings files with neither legacy key are treated as whole-note mode so a missing key does not disable a working installation. Finances cannot infer whether such a vault contains old inline entries; users can run Check old entries before the next sync. The former `recordMode` and `legacyTransactionDiscovery` keys remain only as review markers for explicit old selections and never select a writer or reader. Other settings, account and transaction IDs, provider connection state, custom Base content, and note bodies are preserved. The settings hub still defaults to Data & storage, with Rules & budgets and Properties one click away; its mobile route strip, native buttons, focus behavior, and persisted-state contract remain intact.

Focused regression coverage checks missing-key settings, write gates before provider requests, fresh review and interrupted conversion, classification without inline fallback, duplicate atomic IDs, and dashboard operation counts. The final versioned suite passed 366/366 checks, and a separate TypeScript-checked build deployed matching `main.js`, `manifest.json`, and `styles.css` to the Test vault. Hot Reload showed the new Data & storage page without old selectors; a manual cash entry created exactly one whole-note transaction, visible in Overview, with no inline line in its account. Both temporary QA notes were moved directly to `_archive`, and Finance `data.json` stayed byte-identical. Installed details and artifact hashes are in [2.0.0 release notes](release-notes/2.0.0.md). No provider sync or physical iPhone check was performed. Production installation remains the user's BRAT pull.

## 1.16.0 — Browse transaction history from Overview

Overview labels its capped list **Latest 80 transactions** and provides **Browse all transactions** above the list. That button opens the existing Transactions Base in a new tab, using the same Atomic notes versus Atomic line Base selection already exposed by the plugin API. The overview still renders at most 80 transaction rows; the underlying model, record discovery, settings, note contents, and Home summary are unchanged. On narrow panels the browse label stays visible and wraps inside a full-width 44 px touch target.

This backward-compatible feature is a minor version and needs no data, settings, or plugin API migration. Minimum Obsidian remains 1.12.0. The dashboard still builds its full model before displaying the latest 80 rows; the browse action itself only opens the configured Base and does not rebuild that model. Focused regression coverage checks the 80-row cap, one model read, native button and accessible label, Base selection for both storage modes plus the existing fallback, and narrow-screen text/touch styling. The versioned declared suite passed 367/367 tests, and a separate TypeScript-checked build deployed matching `main.js`, `manifest.json`, and `styles.css` to the test vault. Test-vault Hot Reload loaded the installed build. Overview showed the heading and browse button in a half-width pane; the button opened the Atomic notes Transactions Base with 1,694 results. At a mobile-like breakpoint created by app zoom, the full label and touch target remained visible. The existing Base still shows opaque filenames; physical iPhone layout remains unverified. See [1.16.0 release notes](release-notes/1.16.0.md) for artifact hashes.

## 1.15.3 — One read-only file snapshot per dashboard model

An atomic-note dashboard model captures Obsidian's Markdown file list once and shares it across snapshot, account, holding, transaction, rule, and budget readers. Those readers memoize decoded metadata only for that model. The atomic transaction index still checks current metadata separately for candidate selection and inspection, and writers still make their existing current-source checks. There is no persistent cache, watcher, note migration, or settings change. A note created after the list is captured appears in the next model; Obsidian's metadata-change event schedules that render for an open dashboard.

In synthetic Atomic notes only fixtures with 10,000 indexed transactions, one metadata-backed model used one file enumeration and no note-body reads: 30,000 metadata lookups at the vault root, or 10,000 in a configured `Finances/Transactions` folder. The preceding released model used six enumerations and 70,000 or 10,000 lookups respectively. With 90,000 indexed unrelated notes, one model still checks them for cross-vault atomic candidates: 180,003 metadata lookups at root or 90,001 with a configured folder, with zero note-body reads. The configured folder does not limit transaction discovery to that folder. The default Include inline entries mode still scans legacy candidates separately, root notes without metadata and ambiguous root budgets may require body reads, source/API reads retain their current-source behavior, and a stale non-null ordinary metadata entry can remain hidden until Obsidian refreshes it. One classification save performs no model scan on its direct atomic path, but its refresh still rebuilds a full model; a later metadata event can schedule a second build if it arrives during or after the first.

Focused regressions cover 10,000 transactions, 90,000 unrelated notes, fresh atomic candidate and inspection metadata, unindexed arbitrary filenames, duplicate IDs, late file creation and event-driven rerender, mapped Finance/GCM fields, root budget fallback, and source versus metadata model equivalence. All 365 declared tests passed after versioning, followed by a separate TypeScript-checked build to this test vault. The installed runtime and source artifacts match, while Finance `data.json` stayed byte-identical. Reloading only Finances showed 1.15.3 enabled, and Overview and Budget rendered in the foreground test vault; see [1.15.3 release notes](release-notes/1.15.3.md). These are in-memory operation counts, not installed-device latency measurements.

## 1.15.2 — Targeted atomic classification and readable summaries

With **Transaction discovery → Atomic notes only**, a displayed atomic transaction keeps a private binding to its original note. Saving its category or tags checks that the same file remains at the displayed path and that its current ID, type, category override, and tags still match the rendered row. The check occurs inside Obsidian's frontmatter mutation; a moved, replaced, or reclassified note must be reopened before saving. This avoids a full transaction index read for the selected action. Plain API rows without that binding retain ID lookup, and **Include inline entries** retains its existing inline fallback. A duplicate ID introduced after the row was displayed is not checked by this targeted save; a later full index read or sync rejects it once both notes are visible to discovery. An unchanged submission still enters the frontmatter mutation to check current source safely. No setting, note format, automatic migration, cache, watcher, or retry is added.

The Home summary now uses the same metadata-backed display model as the Finance dashboard, so it does not read every indexed atomic transaction body. Atomic index discovery no longer asks Obsidian for metadata before inspecting a file whose configured Transactions path already makes it a candidate. Genuine dashboard refreshes still rebuild the full model. In synthetic 10,000-transaction fixtures, the isolated save performed zero vault enumerations, metadata lookups, or note-body reads and one frontmatter mutation. The following display-model refresh performed six enumerations and 10,000 metadata lookups in a configured `Finances/Transactions` folder, or six enumerations and 70,000 metadata lookups at the vault root; neither read transaction bodies. Those are in-memory operation counts and timings are not an installed-device speed claim. The prior source-backed Home model read 10,000 transaction bodies in the folder fixture; the updated Home model read zero. Default **Include inline entries** still discovers legacy lines on normal model loads, and this test vault still has inline markers that block enabling Atomic notes only until reviewed separately.

Overview and Home summary metric cards use wider responsive minimum widths and wrap complete amounts and labels instead of truncating them with ellipses. The Home and Overview display changes do not alter record data or settings. All 357 declared tests passed (2 connection and 355 plugin), followed by a separate TypeScript-checked production build to the test vault. Reloading only Finances showed 1.15.2 enabled; wide Overview cards showed complete amounts, and a narrow approximately 400 CSS px pane wrapped to one card per row without clipping. The privacy control still masked values and was restored to its original visible state. Home summary layout was not directly exercised in the installed UI; its metadata-backed read is covered by the 10,000-note regression. Finance runtime `data.json` stayed byte-identical, and no note conversion, provider sync, or production installation occurred. Artifact hashes and verification boundaries are in [1.15.2 release notes](release-notes/1.15.2.md).

## 1.15.1 — Manual classification follows transaction discovery

Categorizing a manual transaction uses the selected **Transaction discovery** mode. If its atomic note has disappeared, **Atomic notes only** reports the missing record without searching or editing inline entries; **Include inline entries** retains the existing fallback. The missing-record message no longer assumes a daily note. No setting, note, or migration is changed by this correction. A focused regression exercises the real classification action and counts legacy reads and writes in both modes, including a successful atomic-note edit. Atomic notes only still permits explicit conversion checks and may read ambiguous root budget notes during dashboard loading.

The final 1.15.1 suite passed 345 checks (2 connection and 343 plugin), with no failures or skips. A separate TypeScript-checked production build deployed the tested bundle only to this test vault. Obsidian's third-party-plugin reload showed TPS Finances 1.15.1 enabled; Overview and Budget rendered, and Finance `data.json` remained byte-identical. The installed vault still uses Include inline entries, so the Atomic notes only behavior is verified by the regression rather than a live setting change; activation requires its fresh marker audit. No conversion, provider sync, or production installation was performed. Minimum Obsidian remains 1.12.0. Artifact hashes and validation boundaries are in [1.15.1 release notes](release-notes/1.15.1.md).

## 1.15.0 — Record classification settings handoff

**Settings → Properties → Record classification → Configure in GCM** opens GCM's Custom fields page, where each existing mapped type can be stored as a complete tag or a `kind`/subkind property pair. Finance field-name inputs still configure field names; they do not duplicate GCM's classification mode. Finances continues using GCM's live `frontmatterKinds` mapping for imports, manual records, reads, updates and generated Base predicates. Its additive `api.classificationBases` preview includes only Bases whose complete contents still match a Finance-generated definition; GCM 4.1.0 converts those alongside reviewed notes. Customized Bases remain user-owned. Existing note IDs, account matching and atomic-line fields are unchanged.

Install Finances 1.15.0 before applying a Finance classification conversion in GCM 4.1.0. Finance mappings that use tags require the core `tags` key; property pairs require the core `kind` key. If either Finance field name was customized, migrate it back in Finances before switching its classification format. A Finance subkind property cannot reuse a Finance field name, its configured name, or a record identity key, regardless of case; this prevents later writes from replacing record data. Arbitrary Base formulas and custom rules require manual review. No startup migration, new persisted Finance setting or automatic repair is added. The three settings destinations and responsive mobile layout remain unchanged. Minimum Obsidian remains 1.12.0. Validation, test-vault reload, and artifact hashes are in [1.15.0 release notes](release-notes/1.15.0.md). Physical iPhone acceptance and production BRAT installation remain separate.

## 1.14.1 — Read indexed budgets without opening note bodies

The dashboard's Budget and Overview displays now use Obsidian's decoded property index for indexed budget notes. Indexed ordinary notes are still excluded before content reads. In a 1,025-note root fixture, 20 display loads read zero note bodies instead of 20 budget bodies; 20 source/API loads still read the budget body 20 times. Notes with missing or ambiguous metadata still receive content reads, and every display still enumerates the vault and checks candidate metadata. These operation counts are synthetic, not an installed-vault speed claim.

Editing an existing budget first refreshes that budget from current source, refuses a same-path budget identity change, and retains the existing revision check at the write boundary. Source reads also recognize a legacy budget whose kind is encoded by Global Context Menu as a tag without a literal `financeBudget` field or ID. Mapped budget properties, immediate root creation before indexing, and custom kinds remain supported. A root note with stale non-null ordinary metadata can still remain hidden until Obsidian refreshes its index. This patch changes no stored settings or notes, and needs no migration. Minimum Obsidian remains 1.12.0. The final declared suite passed 342 checks (2 connection plus 340 plugin), including source/editor authority and operation-count regressions. Hot Reload reopened the installed Test-vault Finance dashboard and Budget tab with the same visible totals and unchanged `data.json`. One foreground Budget switch measured about 0.97 seconds before and 0.70 after; repeated switches measured about 0.42 and 0.67 seconds. These include automation waits and do not establish a latency improvement; physical iPhone and a real budget edit remain unverified. Full details and artifact hashes are in [1.14.1 release notes](release-notes/1.14.1.md); production installation remains the user's BRAT pull.

## 1.14.0 — Choose when Finance stops reading old inline transactions

**Data & routing → Transaction discovery** now offers **Include inline entries** (the existing default) and **Atomic notes only**. The latter removes the vault-wide legacy transaction body scan from atomic-note dashboard/API reads and sync. It does not change transaction identities or filenames, rewrite a note, or change the record format. Atomic transaction filenames already encode their stable `financeId`; a further filename suffix would not remove the legacy scan.

Before Atomic notes only can be saved, Finances freshly reads every Markdown file and refuses activation if any active `[financeId::` marker remains, including malformed lines and examples in code or frontmatter. The sole exception is a verified converted transaction's original line retained in its `migrationSource` property for retry verification; extra markers still block activation. The error reports a count and first vault-relative path for review. **Convert to atomic notes** remains a separate explicit action; its moved/skipped counts are not a completion certificate, because ambiguous or duplicate inline entries may remain. The full audit is deliberately conservative. A failed audit leaves the prior mode active; after a settings-write error, Finances reads back the mode that actually reached disk. Switching to Atomic line restores inline discovery. If another device or tool adds an inline entry after Atomic notes only is enabled, choose Include inline entries to see it; no background scan tries to detect that later change.

In Include inline entries mode, dashboard display may skip reading a note body only when Obsidian's complete-looking section metadata shows headings/paragraphs with no list or ambiguous block. It still reads YAML, code, lists, missing/partial metadata and current source for edits/migration. A newly added inline entry may wait for Obsidian's metadata event before display; source mutations verify current content at their write boundary. The shortcut reduces candidate body reads but still enumerates the vault and is not a cold-start speed guarantee. At vault root, atomic notes whose metadata has not arrived must also be read from source because their filenames can be edited; a fully unindexed root still needs a full candidate read. Before creating an incoming ID missing from the root index, a write batch checks otherwise excluded note sources once so stale non-null metadata cannot manufacture another note with that ID. Ordinary root reads can still omit arbitrary-name notes whose stale metadata has no finance hint, and a hidden duplicate of an already indexed ID remains undetected until metadata updates. The separate root budget reader can read ambiguous note bodies even with Atomic notes only enabled. Minimum Obsidian remains 1.12.0; this is an opt-in backward-compatible feature.

The final versioned suite passed 336 checks, with no failures or skips. Focused operation-count regressions prove an atomic-only model with 1,024 unrelated notes reads one atomic source and zero display bodies; the conservative default-mode preflight halves body reads in its mixed synthetic fixture. Conversion-provenance and stale-root-metadata regressions cover activation and duplicate prevention. In the installed test vault, Hot Reload loaded 1.14.0, the new control showed a checking state, and its fresh audit found 10 markers and left Include inline entries selected. Finance `data.json` stayed byte-identical; no notes were converted. Foreground desktop first/repeated open observations were about 1.37/0.92 seconds before and 1.62/0.97 seconds after; those samples include automation waits, show no default-mode speed gain, and do not measure physical iPhone or production performance. Full validation and artifact hashes are in [1.14.0 release notes](release-notes/1.14.0.md). Production installation remains the user's BRAT pull.

## 1.13.0 — Clearer phone dashboard

The dashboard now shows a loading status on first open while its model is being read. Existing content stays visible during later refreshes. Recent transactions wrap their names and context in narrow panels, show a distinct imported provider name on touch devices, and include that name in the accessible row label. Narrow-panel route, account, budget and classification controls have at least 44 px touch targets. These display changes add no model reads, source scans, writes, timers or persisted settings; the Overview amount-privacy control retains its existing behavior.

This is a backward-compatible mobile UX feature with no note migration and the same Obsidian 1.12.0 minimum. Focused tests cover first-load and error presentation, source-name visibility, narrow CSS, and unchanged model-read counts. The full declared suite, final build/deployment, reload, and installed narrow-panel QA are documented in [1.13.0 release notes](release-notes/1.13.0.md). The installed Test-vault check is a desktop narrow panel, not physical iPhone acceptance. The remaining Finance scale cost is legacy inline transaction discovery: genuine model loads still cached-read candidate note bodies because those lines may exist anywhere in root storage. Filename IDs do not remove that requirement; retiring it needs an explicit legacy migration or a separately designed maintained index.

## 1.12.0 — Private amounts on Overview

The main dashboard’s **Hide amounts** eye button masks summary totals, account balances, holding share quantities/prices/values and recent transaction amounts. Tap a masked value to reveal just that value; tap again to hide it. **Show amounts** restores the normal display. Percentages, dates, account labels and identifiers remain visible. Budget, the home summary, Bases, notes, forms and other views are unchanged.

The mode belongs to the open dashboard view only. It stays on across Overview/Budget navigation and data refreshes, which remask individually revealed values; closing/reopening the view or reloading the plugin starts with the normal visible display. There is no persisted setting or data migration. Masked numeric values are absent from the rendered text, tooltips and accessibility labels until explicitly revealed. The underlying finance data remains unchanged.

Native buttons support touch, Enter/Space, accessible labels and visible focus; amount targets are at least 44 px. Revealing an amount never triggers the surrounding transaction’s navigation. The global toggle reuses the currently displayed model and preserves dashboard scroll/focus; individual reveals update only their button. No additional data read, scan, write, background listener, cache or timer is added. This additive feature uses a minor version; minimum Obsidian remains 1.12.0.

The compact 44 px eye control sits beside the title to avoid adding a mobile toolbar row. Four actual-renderer regressions cover field coverage and accessibility, individual disclosure and transaction event propagation, refresh/route/reset behavior, view isolation and operation counts. Validation: 24 focused and 309 full tests passed, with no failures or skips; TypeScript and the separate final production build passed. The named Test plugin reload loaded 1.12.0. Installed pointer/keyboard checks covered 13 masked fields, single-value reveal without note navigation, Budget isolation, refresh remasking and Show amounts. The 320 px panel had no horizontal overflow and all new targets were at least 44 px. Synthetic model/open-source adapters were restored; no notes or provider calls were made, and seven runtime settings files remained byte-identical. Physical iPhone acceptance is still needed. Detailed test-vault UI boundaries and artifact hashes are recorded in [1.12.0 release notes](release-notes/1.12.0.md).

## 1.11.6 — Dashboard display uses Obsidian's property index

The Finances dashboard now reads atomic transaction properties from Obsidian's existing metadata index. Previously, opening or refreshing the dashboard reparsed the source YAML of every atomic candidate, duplicating work already owned by Obsidian. The existing view refresh queue responds when metadata is published, renamed or removed; local route/month controls continue reusing their displayed model.

This makes display freshness explicit: newly created notes appear after Obsidian indexes their properties, and edits appear on its metadata event. No fallback parser, additional cache, watcher, timer or persisted state is added. Current mappings and complete kind tags still govern interpretation. Duplicate identity/configuration errors remain errors. Legacy inline transactions still use their existing body reader, including lines inside atomic notes, with atomic records retaining identity precedence.

Sync, edits, migrations, title review, and zero-argument `api.getDashboardModel()` retain their current-source checks. The dashboard alone requests the internal `metadata` read mode; that result never supplies mutation authority. Snapshot and budget body reads remain unchanged. No configuration, note migration, default or minimum-version change; Obsidian 1.12.0 remains required.

Seven new regressions cover unchanged display bursts, no atomic YAML parses, indexed creation/removal, stale indexed display versus current-source reads and edits, duplicates/legacy precedence, mappings, migration guards and explicit view routing. Final validation and installed measurements are recorded in [1.11.6 release notes](release-notes/1.11.6.md). Production installation remains the user's BRAT pull.

Validation passed 115 focused and all 305 declared checks, with zero failures/skips, TypeScript and the separate Test build. A named Finances-only reload preserved the concurrent authentication panel. Installed API/real-dashboard tests verified creation after metadata publication, amount edits, rename, classification removal/restoration and legacy removal/restoration; each data change produced one model and correct DOM rows. An unrelated rename still produced no model. Ten fixtures across before/after were directly archived with exact source bytes preserved. In a separate comparison on the final installed build, the same 1,694 transactions/16 accounts/13 holdings had identical model hashes; display removed 3,566 atomic source reads/parses per model (14,803 cached reads → 11,237), while the default API retained them. Legacy body discovery remains. Those samples were hidden/unfocused, and the dashboard was covered by a separate authentication panel: no foreground input, physical iPhone, cold-process, production or native-parity speed claim. Five settings hashes were verified during each fixture run and seven settings files at final validation. No runtime-owned state was replaced.


## 1.11.5 — Refresh dashboards only for relevant changes

Each open dashboard retains a set of the source paths used by its displayed model. The existing account, snapshot, holding, rule, budget and transaction readers collect those paths during their normal reads; this adds no file reads or scans. The set is replaced after each successful model load and released on close. It contains paths, not cached note content or another transaction index. Public model results and zero-argument API calls are unchanged.

Metadata, rename and delete events now use that view-owned dependency set before requesting the existing render queue. Ordinary unrelated note edits/renames and attachment changes do not rebuild the dashboard. Removing the last finance marker or a legacy inline transaction still refreshes because its old source belongs to the displayed model. New mapped/tag-classified records, label-only account notes, legacy lines outside the finance folder and configured storage-section candidates remain discoverable. Old paths and containing folders preserve move/deletion handling. While a model read is in flight or has failed, Markdown changes conservatively invalidate the existing queue so incomplete dependencies cannot authorize stale display. Sync and migration retain their final-refresh ownership.

This is a backward-compatible correction with no new watcher, timer, persisted setting, migration or background work. Genuine model loads still perform the existing legacy discovery; first dashboard loading is not reduced by this change. Minimum Obsidian remains 1.12.0. Regression coverage includes 50-event bursts, removed markers, legacy lines, mapped fields, folder and extension transitions, close/error/in-flight behavior, and actual-reader dependency collection with identical returned data and I/O counts. Test-vault evidence and artifact hashes are recorded in [1.11.5 release notes](release-notes/1.11.5.md). Production installation remains the user's BRAT pull.

Validation: twelve new regressions (eight failed before), 46 focused checks and all 298 declared tests pass, zero failures/skips. TypeScript, the separate production build and named Test reload passed with unchanged plugin settings. The installed before/after test used actual file operations, readers and dashboard DOM: an unrelated rename dropped from one model load/nine enumerations/14,742 cached reads to zero model loads/zero enumerations/one trace-wide cached read. Atomic amount changes stayed correct; removing/restoring atomic classification and legacy lines now removes/restores the displayed rows. Each genuine change used one model load. Four synthetic files per run were archived with exact final bytes; five disk settings files and Finances memory settings were preserved, and all hooks were removed. This was an API operation/DOM check with a temporary synthetic finance destination and all consumers enabled, not pointer or latency acceptance; the after run was unfocused. Existing full model discovery, cold-process/mobile speed and the native-performance goal remain separate.

## 1.11.4 — Prepare cash forms from account data

Log cash transaction now uses the existing snapshot/account readers to populate account choices. It previously loaded the complete dashboard, including every transaction, holdings, rules, budgets and derived cash balances, although the form only displays account names, paths, currencies and eligibility. Snapshot fallback for account currency and account ordering are preserved. Existing property/migration validation runs before discovery; the existing manual writer and its fresh-source validation still own Record. Canceling/opening a form writes nothing, and successful recording still refreshes the dashboard.

No new cache, state, listener, timer, retry, setting, schema or API. Full dashboard reads remain unchanged where that complete model is required. Minimum Obsidian remains 1.12.0. Six focused regressions execute the real command method with mocked account/modal boundaries and the real manual writer; four fail before the correction. Final validation and installed counts are documented in [1.11.4 release notes](release-notes/1.11.4.md). Production installation remains the user's BRAT pull.

Validation: 45 focused checks and all 286 declared tests pass, with zero failures or skips; TypeScript, the separate production build and named test-vault reload pass. The installed command preserved the same 16 account choices and their order/currencies while eliminating its dashboard model load: 14,730 cached note reads → 0 and seven Markdown enumerations → two. Five monitored plugin settings files were unchanged and no note writes occurred. This API probe used the actual readers but replaced their account result with an empty list at the presentation boundary to suppress the modal; it is operation-count evidence, not actual modal UI or latency acceptance. All consumers remained enabled. Minimum compatibility, manual write validation and successful-save refresh are unchanged; physical iPhone, cold-process and production performance remain unverified.

## 1.11.3 — Less work during transaction discovery

Atomic transaction candidate discovery checks the fixed `financeId` metadata field directly, instead of validating and decoding every configurable finance property on every unrelated note. Configuration/migration and identity-key validation still runs before discovery; each candidate's current source still goes through the existing property decoder and write guards. Folder candidates remain discoverable before metadata arrives, and metadata never authorizes a write.

Legacy discovery now skips line splitting when the current source contains no `[financeId::` marker. It still reads the same files, preserves legacy lines anywhere in the vault, removes obsolete index entries, and retains duplicate/line ordering and atomic-record precedence. This adds no cache, watcher, timer, retry, schema or setting. Initial filesystem reads, actual transaction parsing and real refreshes remain necessary work; this is not a claim that dashboard opening is instantaneous.

Six focused regressions cover unchanged candidate bursts, mapped current-source fields versus stale metadata, folder metadata delay, configuration/mid-read migration guards, marker-free body operation counts and removal/reinstatement of legacy ownership. Two failed before the fix. Validation and artifact hashes are recorded in [1.11.3 release notes](release-notes/1.11.3.md). The three settings destinations, existing commands, record formats and minimum Obsidian 1.12.0 remain unchanged. Production installation remains the user's BRAT pull. All 107 focused and 280 declared checks pass, with no failures/skips. The separate production build deployed to Test; named plugin reload verified 1.11.3 with unchanged settings. With the full suite enabled, two foreground warm dashboard opens took 784–869 ms versus 1,067–1,129 ms before. Synchronous atomic candidate discovery fell from 140 ms to 18–19 ms; summed synchronous legacy indexing time from 65–66 ms to 12–13 ms. The same approximately 14,700 cached reads remain, plus one new release-note Markdown file. Budget selection took 49 ms without a model load or cached read. Five monitored settings and runtime artifact hashes were preserved across each run; views and window geometry were restored. These small instrumented desktop samples do not establish cold startup, physical iPhone performance or native parity. No provider or note mutation was triggered. The final README-only build was byte-identical to the installed, tested artifacts.

## 1.11.2 — Keep display controls out of the vault reader

Dashboard Overview/Budget switches and budget month, currency and transaction-expansion controls now redraw the model already displayed. They previously called the same data-loading operation used after record changes, causing each local interaction to rebuild the transaction index and read every Markdown body for legacy finance lines. The existing render queue still owns fresh model reads on open, explicit refresh and data invalidation; a pending refresh applies its newest model to the current route. Local controls do not create another data request. New model rendering replaces the old controls and their model closures.

This extracts the existing paint step; it adds no persistent model cache, watcher, timer, settings, schema or migration. Focus restoration, scroll position, empty/error presentation, closed-view protection, budget calculations and mutating action owners remain intact. Native and legacy record discovery is unchanged: initial dashboard loading and real data refreshes still read the vault. It does not explain ordinary note navigation when no dashboard is open. Minimum Obsidian remains 1.12.0.

Eight regressions execute the actual dashboard and budget renderers with a small DOM facade, including local action bursts, fresh-data invalidation, route changes during an in-flight read, focus/scroll, closure replacement, action ownership and close/error behavior. Five checks failed before correction; all 35 focused dashboard/budget checks pass. The final versioned suite passed all 274 tests; the separate production build deployed to the test vault. The restarted test app loaded 1.11.2. Actual foreground Overview/Budget clicks fell from 915–1,018 ms to 18–51 ms with zero model loads or cached body reads; changing the month took 14 ms. A real refresh still loaded fresh data. Settings and note contents were unchanged. Initial loading remains expensive (3.0 seconds after the app restarted; a later refresh took 892 ms), so these results are specific to local controls, not general vault speed or native-performance equivalence. The left sidebar was temporarily collapsed for the after-run controls and restored. Currency and transaction expansion had unit coverage only because the installed budget had one currency and no configured rows. Full validation details and artifact hashes are recorded in [1.11.2 release notes](release-notes/1.11.2.md).

## 1.11.1 — Readable investment holding names

New atomic holding notes use **Ticker — Account note name**, for example `EXM — Example Bank Investing •1234.md`. Investments without a ticker use their supplied investment name. The full investment name remains in the configured `name` property. The same readable label is written to the configured `title` property on creation; IDs remain unchanged in identity properties.

The originating defect was in `AtomicFinanceStore.writeSnapshot`: it deliberately encoded the account/security identity pair into the filename and omitted a title despite having a ticker and account path. Creation now uses those existing labels and the normal finance filename sanitizer/unique-path allocator. An unrelated occupied name receives a numeric suffix, and distinct accounts retain distinct holding notes. Missing account paths or investment labels stop the write rather than inventing a label or an empty account link.

Sync continues locating existing holdings by account/security IDs, preserving their filenames, edited titles, bodies and unrelated properties. Newly created holdings enter that same in-memory identity index immediately and are written active at creation. Root-mode discovery reads unindexed note content when metadata has not caught up; immediate repeated snapshots do not create duplicate holdings. Disappeared positions retain the existing inactive-note behavior. No watcher, background rename, repair sweep, new settings, title-ownership property or automatic migration was added. Existing ID-named notes require a separately requested one-time rename; installing this release does not rename them.

This is a patch for the existing import operation. The three settings destinations (Data & routing default, Rules & budgets, Properties), connection handoff, disclosures, keyboard/mobile layout, commands, configurable fields and minimum Obsidian 1.12.0 remain unchanged. Focused tests exercise the actual holding writer for root/folder imports, untickered securities, unsafe names, name collisions, repeated IDs, metadata delay, custom titles, old ID-named notes and configured property names. See [release validation](release-notes/1.11.1.md) for the full suite, separate final build, test deployment/reload, installed synthetic import checks, limitations and artifact hashes. Production installation remains the user's BRAT pull.

## 1.9.0 — Records here, connections in Controller

Settings now has **Data & routing** (default), **Rules & budgets**, and **Properties**. Record format, root/folder destination, atomic-note conversion, atomic-line routing, logging, rule/budget actions, and property migration remain here. **Open connections** goes directly to Controller → Connections → Banks & Wallet. The dashboard's Connections action does the same, including on unpaired phones. Its quick Sync action and existing command/API IDs remain compatible.

The old Plaid setup and Connections tabs are removed. Controller now presents Connect, Sync, Reconnect, Disconnect confirmation, pending requests/continued sign-in, and transaction-history depth alongside its own credential/pairing controls. Finances supplies the existing adapter and continues importing/categorizing Markdown records. It remains usable for manual cash, assets, transactions, and budgets without Controller. Connection setup requires Controller 2.6.0+; an older/missing Controller gets a clear notice.

New Apple Wallet connections use TishOS 0.18.2+ on the iPhone to choose a vault/accounts and import automatically. The former instruction to enable a Controller Wallet-import toggle is retired. The legacy relay remains solely for existing imports and safe handoff to the phone writer.

The connection editor API is `api.connectionSettings = { version: 1, render(parent): dispose }`. Controller mounts one editor at a time and disposes it on navigation/hide. Provider-specific editors retain the existing save paths, runtime adapters, commands, and device state. No keys, tokens, pairing authority, queued requests, connection IDs, sync cursors, or note mappings are copied or reset. No connection or provider test runs merely from opening settings. Missing/outdated plugins produce an upgrade/enable message instead of a duplicate configuration surface.

There are no new persisted settings or schema migrations. The three routes use native buttons, aria-pressed, focus restoration, and a narrow scrollable strip. Connection operations disable their invoking button while pending, and detached editors do not render after delayed saves. Disconnect remains confirmed and preserves Markdown records. Minimum Obsidian remains 1.12.0 (Controller needs 1.12.3). This is a minor configuration/API release. See [release validation](release-notes/1.9.0.md) for tests, final build, test deployment/reload/UI checks, limitations and hashes.

## Previous releases (historical settings locations)


## Apple Card import corrections — 1.8.1

Apple Card debt now reduces net worth consistently with Plaid credit accounts.
The native Wallet message represents money owed as positive; Finances converts
that to a negative account balance. An overpayment becomes a positive asset,
while zero and unavailable balances remain zero and unknown. Available credit,
credit limits, transaction signs and Apple Savings balances are unchanged.

The Wallet importer also prepares the configured finance folder before writing
notes. A first import into a new folder now works without a prior Plaid sync or
manual account creation; root storage continues to work.

The next successful Wallet import updates existing account notes in place using
the configured balance property. No connection reset, ID change, new setting,
frontmatter key or startup migration is introduced. The five settings routes,
commands and mobile UI remain unchanged. This is a backward-compatible patch;
Obsidian 1.12.0+ is still required (Controller requires 1.12.3+).

Regression tests cover Card/Savings net worth, overpayments, zero/unknown balances,
root storage with a renamed balance key, fresh-folder setup before writes, and repeated corrections preserving
transaction amounts and user content. Real Apple account authorization and
reconciliation require TishOS 0.17.0 (147) on the paired iPhone.

Validation: 254/254 tests and typecheck/build pass. The reloaded 1.8.1 test-vault
backend created a fresh synthetic finance folder, Card/Savings account notes and
a purchase, then applied an overpayment and corrected purchase twice without
duplicates. Renamed balance/amount/title keys, user title/tags/category and receipt
body were preserved. Test fixtures were archived directly; finance settings,
Controller role and both data.json files were unchanged. No outbound provider was
enabled. The final separate production build deploys only to the test vault.

## Apple Card and Savings — 1.8.0

TishOS 0.17.0 on one iPhone can read the Apple Wallet accounts and history you
approve, then send encrypted changes to TPS Controller 2.3.0. Enable **Import
Apple Wallet** in Controller → Advanced → Finance server and enter its private
pairing code in TishOS → Apple Wallet. The phone separately confirms the named
vault and requests Apple permission. No Plaid credentials or subscription are
needed for this connection. The request folder must sync and Controller must run.

Finances remains the only account/transaction note writer. Wallet imports require
**Atomic note** mode, use the currently configured root/folder and property names,
and pause during unfinished property migrations. Apple transaction identities
are stable on the paired phone: retries and pending/posted corrections update
one note. User transaction titles, categories, tags, extra properties and bodies
survive updates. Debit spending is negative, credits positive; credit-card
balances are negative amounts owed, while overpayments may be positive.
Unavailable balances remain unknown rather than zero. Transfers and known
purchase/fee/interest types feed the existing classification; ambiguous movements
remain for review, with no guessed category.

Only explicit FinanceKit history deletions or rejected transactions trash their
matching records. Missing accounts, narrower permissions and empty results never
remove notes. One phone exports per collection; phone replacement or lost
private state needs a deliberate identity migration. The iPhone supports
foreground/manual and system-granted refresh, with no promise of continuous
background execution. A Files-accessible vault and ordinary vault synchronization
are required. Existing Plaid imports and manually maintained assets stay separate.

**Settings inventory:** the five current destinations, default route, property
editors and commands remain. Connections gains one Apple Card & Savings row with
an Open Controller settings handoff. There is no duplicated permission or
credential control, new setting, extra disclosure or hardcoded frontmatter key.
The existing mobile wrapping controls and native keyboard actions are retained.

**Validation:** parser, hosted-owner and actual atomic-store tests cover omitted
Swift balances, signs, malformed records, corrections, explicit deletion, root
storage with renamed properties, preserved user edits, retries and trash errors.
The complete suite passes 253 tests. A separate production build deploys only
to the test vault; CLI reload verifies 1.8.0. Actual vault APIs created synthetic
account and transaction notes under Inbox, applied a posted correction twice
without duplicates, and preserved a renamed title, tags, category and body.
Fixtures moved directly to _archive afterward. The reloaded Connections page
was visually inspected; its five routes and prior actions remain. Settings file
hashes were unchanged and no real bank/Wallet connection was enabled. Actual Apple balances/history require iPhone
acceptance. This additive feature is a minor release; minimum Obsidian stays
1.12.0 (Controller requires 1.12.3). Production installation remains a BRAT pull.


Accounts, transactions, investments, manual cash, budgets, and manually valued resale assets in Obsidian.

Current release: [3.0.2](https://github.com/ZachTish/tps-finances/releases/tag/3.0.2) · Obsidian 1.12.0+ · Desktop and mobile.

## Install with BRAT

Add `ZachTish/tps-finances` to BRAT. Use manual updates with `Latest`, or freeze an exact numeric tag for a controlled rollout. Each release supplies `main.js`, `manifest.json`, and `styles.css`; release notes record validation and artifact hashes. A published release is not evidence that any device has installed it.

## Connect and use

1. Install/update **TPS Controller 1.4.0+ and Finances 1.6.0** on your desktop and mobile devices. Shared Plaid operation requires Obsidian 1.12.3+; manual finance records retain the 1.12.0 minimum.
2. On your always-running Controller desktop, open **Plaid setup → Open Controller settings**. Configure the environment and separate client-ID/secret references under **Advanced → Plaid**, then choose **Finance server → Use this Controller**. Use the desktop that already owns your bank connections.
3. Export its pairing code and enter it in Controller's Finance server settings on the phone/iPad. Pairing, credentials, connection tokens, and request journals are device-local. Do not connect the same banks independently on each device.
4. Return to **Connections** to Connect, Sync, Reconnect, Disconnect, or reopen a pending request. Bank sign-in opens [Plaid Hosted Link](https://plaid.com/docs/link/hosted-link/) in your browser. Return to Obsidian afterward; the Controller imports the records and normal vault sync delivers the notes.
5. Use **Open finances** for balances, holdings, transactions, categorization, rules, and budgets. **Add cash account**, **Log cash transaction**, and **Add resale asset** work without Plaid.

## Configurable finance properties — 1.7.0

**Settings → Properties** configures Finance-owned frontmatter names. Common fields include title, currency, tags and finance source; the legacy **Record type** (`type`) name remains editable for older records or shared kind mappings. With GCM v2, its configured kind list, Scheduled property, and optional discriminator own record classification and dates; Finances shows a direct settings handoff. The five property groups are Common, Transactions, Accounts & assets, Holdings, and Rules & budgets. Provider imports, manual cash/asset records, corrections, budgets, categorization, dashboards, title cleanup and generated Bases use the same mapping. IDs remain fixed, except the existing identity property owned by Global Context Menu.

The toggle beside each editable field controls whether its name is stored explicitly in `propertyNames.keys`. An explicit name may equal the default, which lets companion tools confirm the agreed field name from Finance settings. Editing a name makes it explicit; turning its toggle off restores the default. Saving or resetting one field preserves the other explicit names. A save that only adds or removes default-valued entries changes no note or Base format and does not scan or rewrite notes; actual renames keep the existing migration confirmation. For Finance-owned fields, default and explicit names resolve through the same map. GCM v2 takes precedence for kind and Scheduled keys, and a unique configured kind makes the old Finance `type` key read-only.

Edit names, then choose **Save property names**. The confirmation lists old → new names and the count of affected finance notes, with **Migrate and save**, **Save without migrating**, and **Cancel**. Migration is explicit and covers identified finance notes throughout the vault, including records in older folders. It moves each value to the new key and removes its old key, preserving bodies, paths, IDs and unrelated properties. A conflicting destination value blocks migration; identical duplicate values can be consolidated. Declining migration leaves existing properties untouched. Finances reads only the currently configured name: there are no fallback aliases, historical property-name lists or background migrations. Older unmigrated records can disappear from finance views until their properties are updated.

A durable, temporary migration journal is saved before note writes. An interruption pauses finance operations; **Properties → Resume migration** completes the idempotent renames before committing the new mapping. Every target is preflighted and its identity/collision guards are rechecked in the atomic frontmatter callback. Missing or moved targets must be restored before resuming. The journal contains the source/target mapping, paths and stable identities, not note bodies or financial amounts. It is removed on completion. The `propertyNames.keys` and temporary `propertyMigration` settings sync with the vault because every device must interpret the same note schema. There is no automatic migration on startup.

Generated, uncustomized finance Bases are updated to the new names using [Obsidian property syntax](https://obsidian.md/help/bases/syntax). Customized Bases, external queries, other plugins' property settings and Obsidian's special treatment of names such as `tags` are not rewritten. Atomic-line annotations keep their existing format; these controls map note frontmatter. Property names must be distinct, nonempty plain names and cannot collide with stable IDs or another finance field. Defaults retain the existing schema.

**Settings/state inventory:** the original Plaid setup, Data & routing, Connections and Rules & budgets destinations and their controls/actions remain available. Properties is the fifth destination; Plaid setup remains the default. One group selector shows only that group's fields, with Save/Discard before the collection and no nested disclosures. Route, group and unsaved draft are transient. Native buttons/inputs, labelled selectors, confirmation keyboard activation, focus restoration, wrapping actions and the narrow horizontal navigation strip support desktop and mobile layouts.

**Validation (2026-09-20):** all 233 tests pass. `scripts/test-finance-properties.mjs` exercises all mapped fields, strict reads after declining migration, accounts/transactions/holdings, manual cash and assets, budgets/rules, generated Bases, collision guards, interrupted writes, failed journal/final settings writes, resume, stale settings previews, stale metadata, resumed identity-key collisions and concurrent destination edits. The full suite also checks the mobile bundle without Node dependencies. The real test-vault dialog verified Cancel, keyboard Enter for migration, and Save without migrating against isolated synthetic account/transaction notes and in-memory settings. Migration removed `type`, wrote `transactionType`, preserved the amount/body and kept the transaction readable. Declining the next rename preserved the existing property and stopped reading it as the configured type. The 390-pixel content viewport stacked controls without horizontal overflow; desktop screenshots and focus restoration were checked. Final verification includes the separate production build, shipped-file-only test deployment, reload, and unchanged runtime-settings checksum. No personal-vault records are migrated as part of this release. This is a backward-compatible minor release; minimum Obsidian remains 1.12.0 (Controller banking requires 1.12.3+). Physical iPhone/iPad acceptance remains the user's BRAT test.

## Transaction record cleanup — 1.6.0

New atomic-note imports omit empty optional provider fields. Ordinary purchases no longer accumulate blank investment properties. The optional fields are `authorizedDate`, `merchant`, `providerCategoryDetail`, `subtype`, `securityId`, `quantity`, `price`, `fees`, and `investmentType`. Nonempty values and real zeros remain; absent optional fields are cleared when the provider supplies a revised transaction. Identical retries do not rewrite the note.

For older notes, run **TPS Finances: Review transaction records**. The preview shows proposed title changes and the exact empty properties to remove. Nothing is selected initially; apply selected entries only. Manual cash records are excluded. Tracked custom titles stay unchanged even when their empty provider properties are cleaned. Amounts, dates, currencies, identities, tags, category overrides, arbitrary user properties (including blank ones), filenames, links and bodies are preserved. A changed identity, title, ownership or reviewed optional field invalidates the preview, including a previously empty field that now contains zero. Failed writes keep remaining selections available for retry.

The existing **Review transaction titles** command remains available and never removes properties. Both reviews now also normalize spacing in transfer and investment descriptions without guessing merchants or dropping trade details, and can recover an untracked missing title from retained provider text. Spacing-only changes are labelled **Normalize spacing** instead of displaying two apparently identical titles. Historical title ownership remains unknown until explicit review; existing tracked manual titles are protected.

**Interface/state contract:** one additive maintenance command, no new settings, no background cleanup, no bank calls or forced resync. The existing settings destinations and commands remain intact. Both previews reuse one flat, paginated review with 40 entries, native labelled checkboxes, keyboard activation and wrapping controls. Selection, page and busy state stay in memory only. Atomic-line records and manual finance workflows retain their existing format.

**Validation (2026-09-19):** 209 tests cover imports, corrections, no-op retries, optional field removal, zero preservation, manual titles/records, custom fields and bodies, stale/altered previews, transfer/investment titles, failed writes and existing provider/mobile loading behavior. Synthetic test-vault UI QA verified a new compact import and three selected cleanups: a legacy merchant title plus empty fields, empty fields beneath a custom title, and a transfer's spacing. Native Space selected a row, and Enter activated Select shown and Apply; rereading all notes confirmed their preserved values and the manual-record exclusion. Desktop and 390-pixel layouts were inspected without horizontal overflow. The release validation also requires the final versioned full suite, separate production build, test-only artifact deployment, plugin reload and runtime-settings checksum comparison. Fixtures are archived after QA. Physical iPhone/iPad testing and production installation remain the user's BRAT handoff.

This is a minor release for the added record-review workflow. Minimum Obsidian compatibility stays 1.12.0; Controller banking still requires 1.12.3+. Personal vault records are not migrated automatically.

## Readable transaction titles — 1.5.1

Atomic-note imports use Plaid's enriched merchant name for the title when it is available. For example, `PURCHASE WM SUPERCENTER #1700` becomes `Walmart`. Transfers without a merchant keep their provider description; investment transactions keep their trade description. Only surrounding/repeated whitespace is cleaned. There is no merchant dictionary, inferred counterparty, AI rewrite, or case conversion. This follows [Plaid's guidance for merchant names](https://plaid.com/docs/api/products/transactions/#transactions-sync-response-added-merchant-name).

`providerName` retains the exact imported `name` value and `providerTitle` records the last generated title. These are additive provider bookkeeping properties, alongside the existing provider category properties. They are not the optional, unparsed Plaid `original_description` field. Sync corrects a generated title while it remains unedited; a title changed by the user is preserved inside the atomic frontmatter update. Other properties, note bodies, tags, categories, stable identities, filenames and links stay in place. Existing name-based category rules also match `providerName`, so making the title readable does not discard their original matching text. The dashboard shows the note title and exposes the imported description on hover. Atomic-line records keep their current format and title behavior.

Run **TPS Finances: Review transaction titles** for older atomic notes. It previews old/new titles without writing anything, selects nothing initially, and applies only the selected entries. It uses 40 rows per page with native labelled checkboxes, wrapping text, keyboard focus, and touch-size buttons. Already-tracked manual titles and manual cash records are excluded. Older versions did not track title ownership, so an ambiguous old title is never silently replaced during sync. A reviewed legacy title is retained as `providerName` until the next provider revision supplies its description. Changed identities, ownership, titles or merchant data invalidate the preview; failed writes retain remaining selections for a retry. Previously saved entries are not repeated. Notes already using their merchant name need no review; old verifiable provider descriptions can upgrade when a new provider revision arrives.

No settings or existing actions were removed; the four settings destinations remain unchanged. This patch adds one maintenance command and makes no startup scans, bank calls, forced resync, filename migration or provider connection changes. Historical transactions not included in a provider update use the explicit review command. Minimum Obsidian compatibility remains 1.12.0 (Controller banking requires 1.12.3+).

Regression coverage includes merchant/fallback/investment titles, exact imported descriptions, manual edits before and during writes, unchanged retries, legacy review, failed/stale reviews, manual identity collisions, and original-description category rules. Validation uses synthetic transactions under Inbox in the isolated test vault, followed by the full suite, separate final build, shipped-artifact deployment and plugin reload. Physical iPhone/iPad validation remains the user's BRAT testing step.

**Test-vault UI verification (2026-09-18):** a synthetic import displayed `Walmart` while retaining `PURCHASE WM SUPERCENTER #1700`. The review proposed only the legacy title and excluded a manually edited title. Native Space selected a checkbox; focused Select shown and Apply buttons worked with Enter after fixing Obsidian modal-scope handling. The saved note kept its path and imported description. At a 390-pixel viewport, the modal wrapped controls and long paths without horizontal overflow. The final full suite contains 201 checks; release validation includes a separate final production build, test-only deployment, reload, and runtime-data checksum comparison. Synthetic fixtures are archived after QA. A clean stable worktree based on released main isolates this patch from the canonical checkout's older unrelated edits.

For Cash App, Venmo and PayPal feasibility, see [wallet connection research](WALLET-CONNECTIONS.md). No new provider is installed or connected by this patch.

## Flex budgeting — 1.5.0

Open **Finances → Budget** (or **Open budget** in the command palette). The recurring monthly plan has four sections: **Income**, **Fixed expenses**, **Flexible spending**, and **Savings**. Enter planned income and fixed-category targets, choose one flexible allowance, then reserve savings amounts. **Left to allocate** is planned income minus those three allocations; **Flexible remaining** subtracts actual flexible spending from its allowance. Negative values stay visible. Existing category budgets remain optional caps under Flexible spending; their limits do not increase or determine the flexible allowance. This follows the useful single-pool idea in [Monarch's flex budgeting guide](https://help.monarch.com/hc/en-us/articles/32125337244052-Understanding-Flex-Budgeting), adapted to four sections and ordinary vault notes.

- **Income:** add one or more expected amounts. An optional category matches actual income to that row; blank means a planned amount only. The income total counts each income transaction once, including sources without a target.
- **Fixed expenses:** match the effective category (manual override, rule, or provider), ignoring case and surrounding whitespace. Purchases, fees and loan payments count; refunds reduce spending. Other spending, including uncategorized expenses, goes into the flexible pool. Credit-card repayments and transfers stay out of expenses.
- **Savings:** link existing cash/depository or investment account notes. Actual progress is posted contributions minus withdrawals for the selected month, not the account balance. Pending transfers, ordinary income, interest, dividends, security trading and market gains do not count. A provider buy/contribution is counted as new money invested, consistent with [Plaid's contribution representation](https://support.plaid.com/hc/en-us/articles/40621176117271-Why-is-a-contribution-Investments-transaction-represented-as-an-outflow). Old negative contribution records lacking investment type are flagged for review instead of guessing their direction. Re-syncing those records can restore the type.
- A savings account belongs to one target per currency. Transfers between accounts in the same target cancel when both legs are present. Manual cash transfers derive the second manual-cash leg from the single transaction note; bank counterparts use their imported leg. Different posting months, a missing bank leg, or incorrect provider classification can temporarily distort progress. Direct payroll deposits marked as income are not automatically treated as savings contributions.
- **Month and currency** select actuals; they do not create a historical plan snapshot or convert currencies. Editing a target changes the recurring plan shown for every month. Monthly overrides, rollovers, automatic account allocation and money transfers are not part of this release. Pending ordinary income/spending is included and labelled; savings counts posted movements only.

Every target remains a `financeBudget` note, using the existing `financeBudgetId`, `title`, `category` and `monthlyLimit` plus optional `bucket`, `currency` and `accounts` links. Missing bucket means the previous category-limit behavior; missing currency means USD. No existing notes or settings are migrated automatically. A blank finance folder creates new targets at the vault root. Reads use current note content even before metadata indexing catches up; editor saves reject changed budget fields and preserve custom properties and bodies. **Open note** provides direct editing or Obsidian's normal trash workflow. Invalid plans, duplicate targets/identities and broken account links are surfaced rather than silently included in available money.

**Navigation/settings inventory:** the Finances page adds Overview/Budget navigation, with Overview as its initial route. Add cash account/transaction/resale asset, Rule, Connect, Sync, account routing, note links and classification remain available. The previous header Budget action is now the always-visible Budget route; `add-monthly-budget` remains available and `open-budget` is additive. Settings retain Plaid setup (default), Data & routing, Connections, and Rules & budgets, with every prior control/action preserved; Rules & budgets adds **Open budget** beside **Add budget**. Category limits and transaction lists use one disclosure level. Native controls expose route selection, expansion, month/currency labels, keyboard focus and form validation. Narrow panels rearrange amounts beneath the label; the editor stacks controls on small screens. The budget header scrolls with the page rather than covering the plan. Route, month, currency and disclosure state are transient, not shared settings.

**Validation:** the focused budget suite covers allocation arithmetic, refunds, category matching, currencies/month boundaries, pending movements, transfers and investments, invalid/duplicate data, metadata lag, vault-root writes, legacy notes, stale editors and failed saves. The full suite also retains provider orchestration, safe import retries, manual finance and mobile loading without Node. Release QA uses synthetic notes in an isolated Inbox destination, with provider actions blocked and the real plugin settings unchanged. Desktop and narrow-panel UI checks cover creation, editing, cancellation, keyboard activation, month changes and transaction expansion. Physical iPhone/iPad behavior remains a BRAT device-testing step. This is a backward-compatible feature release; minimum Obsidian compatibility remains 1.12.0 (shared Controller banking still requires 1.12.3+).

**Release checks (2026-09-18):** all 187 tests passed. In the test vault, the plan correctly reserved $5,000 income, $2,000 fixed, $1,500 flexible and $1,000 savings, leaving $500 unallocated. Savings showed $950 actual from an $800 deposit, $50 withdrawal and $200 investment contribution. Native keyboard Cancel preserved the saved amount; keyboard Save changed the synthetic target to $900 without duplicating it. August showed zero actuals while September restored the posted movements. Transaction expansion preserved keyboard focus. The 390-pixel viewport had no horizontal overflow. All four settings destinations retained their controls and the new Open budget action was present. Budget records remain atomic notes regardless of provider transaction mode; there is no task/checkbox creation path. Final validation uses a separate production-mode build, shipped-file-only test deployment and plugin reload. Settings and credentials are unchanged, synthetic fixtures are archived, and production installation remains the user's BRAT pull.

## Faster atomic-note imports — 1.4.1

Bank and investment imports write up to 16 independent transaction notes concurrently. Revisions sharing a finance ID retain their original order; deletions complete before replacements start. Input validation and duplicate-identity checks finish before transaction mutations. An error stops queued work and waits for already-started writes before reporting failure, so a retry cannot race the previous batch. The bank cursor still advances only after the whole transaction batch succeeds.

Content inspections use Obsidian's invalidated-on-write `cachedRead` API; property updates continue to use `processFrontMatter` against current content and preserve user tags, categories, other properties, and note bodies. Deletion and legacy-migration guards force fresh reads. Empty patches avoid indexing, dashboard reads reuse the fields gathered during their index pass, and legacy line discovery uses bounded parallel reads while preserving vault/line precedence. No persistent cache or schema migration is introduced. Fast retries at the vault root can reuse a verified ID-named transaction before metadata indexing catches up, while unrelated name collisions still fail safely. See [Obsidian's content-cache and atomic-write contract](https://docs.obsidian.md/Plugins/Vault).

The existing **Data & routing → Enable logging** switch now reports phase durations for provider requests, account/transaction/investment/holding note writes, legacy migration, and dashboard refresh, plus index/write totals for atomic transactions. It records counts and timings rather than note contents or credentials. Settings, actions, routing, filenames, Controller pairing, and the minimum Obsidian version are unchanged; this is a backward-compatible patch release.

Regression coverage includes a 250-note batch, bounded writes and cold index reads, same-ID ordering, failed writes/verification/reads, drained retries, cursor commit ordering, duplicate precedence, empty patches, root metadata lag, and preserved manual content. The previously separate transaction-index suite is now part of `npm test`. Synthetic test-vault benchmarking isolates note creation from Plaid and cross-device vault transport; real bank response time, device storage, and other plugins can add latency. Physical iPhone/iPad throughput remains a device-testing limitation.

**Release validation (2026-09-18):** all 160 tests passed, including the mobile bundle without Node dependencies. In the reloaded desktop test vault, the released 1.4.0 importer took 157.76 seconds to create 250 synthetic transaction notes; the final 1.4.1 build took 35.90 seconds (about 4.4× faster), replayed the same batch in 1.27 seconds without duplicate notes, and read its dashboard records in 2.59 seconds. These are measured runs in a busy iCloud-backed test vault, not a throughput guarantee. A separate synthetic provider run exercised the actual sync orchestration, account creation, migration, cursor persistence, and dashboard model: 250 records in 55.05 seconds, then a correction and deletion in 11.26 seconds, leaving exactly 249 records with the corrected amount and preserved manual category, tags, custom property, and receipt body. Provider calls and device-state writes in that run were confined to in-memory fixtures; no bank connection or credential was changed. The separate final production-mode build deployed only shipped files to the test vault, followed by a plugin reload and artifact/state verification. Runtime `data.json` stayed byte-identical. QA notes were moved from `Inbox` to `_archive`. Production installation remains the user's BRAT pull; physical mobile performance and live bank latency were not tested in this release.

## Shared Controller connection — 1.4.0

One pinned desktop imports bank data for all paired devices. The Controller checks for requests every four seconds and defaults to refreshing bank data every 15 minutes; its interval can be changed or set to manual-only. It must remain awake with Obsidian and vault sync running. A sleeping/offline Controller leaves requests waiting. This is a personal server inside Obsidian, not an OS background daemon. Request/response latency follows your vault synchronization.

Keep `_assets/TPS Finance Relay` included in vault sync. Those Markdown files carry encrypted requests, institution summaries, and short-lived sign-in URLs. Controller's AES-256-GCM transport does not put API secrets, bank access tokens, Link tokens, or the operation journal into plaintext notes or shared plugin settings. Your imported finance notes continue to use your normal vault synchronization. Treat pairing codes as private credentials.

Closing the connection modal or restarting Obsidian preserves a request. Reopen it from **Connections**. Reconnect uses the existing Item and preserves account IDs, transaction cursors, credential references, and the original environment even after defaults change. An interrupted one-time token exchange is recovered from a persisted receipt when possible; otherwise it is reported as uncertain rather than blindly creating another connection. Missing or corrupt Controller bank state pauses provider operations. Partial bank import failures are reported to the requesting device. A paired client never falls back to importing locally when Controller is paused or unavailable.

The always-running host refreshes shared Finances settings before linking or importing, using the existing merge-aware settings writer. Changes such as a blank vault-root destination take effect at the next operation without restarting the host. Files already identified by finance ID continue to be updated in place. This adds no automatic folder migration or new note schema.

Unpaired desktop installations retain the earlier local-browser connection flow. Unpaired mobile devices must pair a Controller before Connect/Reconnect becomes available. Manual records work independently on every device. Existing bank tokens are neither copied to mobile nor merged across desktops. Production institutions and OAuth eligibility remain subject to the user's own Plaid account; scheduled reads do not force a bank refresh or call the paid Transactions Refresh endpoint. No fund transfers or trading operations are added.

**Settings/API:** the existing four destinations remain **Plaid setup** (default, direct Controller handoff), **Data & routing**, **Connections**, and **Rules & budgets**. Connections now shows shared banks, Controller status, and recent resumable requests when paired; local bank actions remain for unpaired desktop installations. Native buttons, stable status text, keyboard focus, and wrapping mobile controls avoid rerendering an active sign-in button every poll. `api.controllerFinanceBackend` version 1 supplies host-only provider operations; `api.openConnectionSettings()` opens the Connections destination. The only new Item field, `linkRequestId`, is a local SecretStorage completion receipt. No existing setting defaults or commands are removed.

**Validation:** hosted-provider tests cover modern and legacy result shapes, OAuth update completion, duplicate-item rejection, persisted exchange receipts, environment/cursor preservation, lost host state, refreshed shared settings, and client-only routing. Full mobile-bundle tests cover paired bank requests without Node/Electron as well as existing manual workflows and unpaired guards. Controller tests independently simulate delayed device synchronization and recovery failures. A real Plaid Sandbox browser session completed the synthetic First Platypus Bank OAuth flow and produced four account notes and 241 transaction notes in an isolated Inbox fixture. The full suite, separate final build/deployment, test-vault reload, desktop settings, and mobile-emulated connection controls are required for the release. Physical iPhone/iPad sign-in and production-bank acceptance still require device testing after the BRAT pull.

### Earlier mobile compatibility — 1.3.2

Version 1.3.2 removed the desktop-only manifest restriction and deferred Node's HTTP module until desktop Link is invoked. Manual records and dashboards already worked on mobile; 1.4.0 adds paired mobile bank authentication through the Controller without loading that callback server.

## Vault-root storage

In **Data & routing → Finance folder**, leave the field blank (or enter `/`) to write new finance notes and Bases directly in the vault root, without category subfolders. The empty value survives closing settings and reloading. A missing setting on a new installation still defaults to `Finances`; named folders keep their existing layout.

Existing identified finance records stay where they are and remain discoverable in root mode; this is not a bulk move. Accounts, transactions, and holdings are updated by identity instead of duplicated after changing the destination. Root views filter by finance properties, and ordinary notes are not treated as rules, budgets, or snapshots. Name collisions preserve existing content. Atomic line transactions retain their configured Daily Note/account-note routing.

Patch **1.3.1** fixes the empty-value fallback in both the settings field and persistence normalization, and removes folder assumptions from writers, readers, and generated Bases. Regression coverage includes persistence, flat manual/provider records, folder-to-root identity reuse, unrelated-note exclusion, and collisions. All 114 tests and the separate production build passed; the build deployed only to the test vault. After a plugin reload, UI QA cleared Finance folder, verified its blank persisted value, reloaded again, and created a synthetic cash-account note directly at the root. Original settings were restored and QA outputs archived. No provider call was made.

Root mode discovers finance records across the vault. Duplicate identities or broken account links in old records must be repaired; they are not silently ignored. The test vault contains an older cash fixture with a missing account link, so its combined root dashboard correctly reports that error. Isolated root dashboard/read/write cases pass the regression suite.

## Records and valuation

Atomic note mode stores each account and transaction as its own note with stable identity. Existing records are preserved when transport moves to Controller; no bank reconnection or note migration is required for 1.3.0. Cursors commit after successful ledger writes. Imported transactions preserve manual classifications.

Manual cash balances combine the opening balance with signed cash transactions. A transfer is one record with two account effects, not two duplicate expenses. A house, car, or computer uses a manually entered resale value and optional purchase/loan links; updating that estimate does not create cash income.

Holdings use the most recently synchronized provider price/value and dated snapshots, not a guaranteed real-time market feed. Retained data after a provider outage is last-known. Plaid categories are retained as `providerCategory`; a manual override or matching rule supplies the effective category. Monthly category budgets are durable `financeBudget` notes. Currency totals are not silently converted; legacy category budgets default to USD; the monthly plan now separates currencies explicitly.

## Settings and compatibility

The five settings destinations are **Plaid setup** (Controller handoff), **Data & routing**, **Connections**, **Rules & budgets**, and **Properties**. Selection is transient; account actions remain in Finances.

Atomic line compatibility: Bank and investment transactions are plain `log` bullets in the configured daily note. Each account card can inherit that default or explicitly choose daily notes/account note. Changing either route moves existing identified transactions to the resolved owner; it does not keep mirrored copies. See [the reference](REFERENCE.md) for the legacy line format and conversion history.

Paired devices share the Controller’s existing Plaid Items. Unpaired independent connections can still create separate Items and subscription charges under your Plaid plan; avoid duplicating banks on other desktops. Finances does not transfer funds or place trades. Live bank access and physical-device behavior are not established by mock-provider tests.

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

## 1.10.0 — Two-level frontmatter kinds

GCM owns the configured record classifications. Its existing `nativeRecordKindPropertyKeys` map accepts either a key string (unchanged behavior) or `{key, value, parentKind}`, for example a food-entry record mapped to `{key: "transactionKind", value: "food-entry", parentKind: "transaction"}`. These mappings are opt-in; upgrading never changes notes or classification settings automatically. The additive `api.frontmatterKinds` v1 exposes encode/decode/definition for domain writers. Canonical record IDs and internal domain kinds remain stable while notes store the selected parent and subtype. Current mappings are authoritative; this adds no watcher, automatic repair, or startup migration.

Health library-note creation uses that shared encoding; logged records continue through GCM's record writer. Finances uses it at its existing property read/write boundary for imports, manual entries, updates and generated Base filters, retaining its canonical internal finance types. Controller omits an unsolicited `status: scheduled`; explicit template statuses and cancellation statuses are preserved, and cancellation restoration can return status to absent. Calendar identity remains its stable ID while public kind/subkind fields belong to the note/template.

The user's one-time taxonomy migration is separate from shipped plugin behavior. It must update settings, existing notes, templates, embedded/standalone Base filters and presentation/hide rules together, with conflict checks, source snapshots and preserved identifiers/bodies. Empty optional properties are not created by the classification mapping. GCM custom-property definitions govern the properties panel; removing specialized nutrition/finance definitions does not delete their stored data. Existing settings destinations, disclosures and mobile layouts are unchanged. Physical iPhone acceptance remains outstanding. Full test/build and test-vault verification results are recorded in release notes.

Validation for 1.10.0 (2026-09-26): 257 checks passed; TypeScript and production build passed. The installed test-vault plugins were reloaded by manifest ID after refreshing manifests. Synthetic API creation/update checks verified food-entry parent/subtype encoding, stable IDs, calendar template classifications, preserved calendar body and absent status, plus finance encoding/decoding. Temporary in-memory classification/root settings were restored without saving, and fixtures moved directly from Inbox to `_archive/Taxonomy QA 2026-09-26`. No external provider was called. Focused finance tests additionally cover investment round trips and dotted Base expressions with renamed keys. Final separate build/deployment and artifact hashes are recorded in the release notes.

## 1.11.0 — Shared record tags

Finances supports complete GCM classification tags through its existing property codec. Imported accounts/transactions, subsequent updates and manual records preserve their identity and other fields without recreating kind. Generated Base filters use file.hasTag for tag mappings; legacy property mappings retain their original predicates. User-authored Bases are not silently rewritten. No new settings, background migration or provider calls are added. Requires GCM 3.6.0 for tag mappings; existing vault filters require a coordinated one-time migration. Settings navigation is unchanged.

Validation: focused tag round trips and creation/update tests, full declared tests, a separate final build, test-vault deployment and targeted reload are required. Final results and artifact hashes are recorded in release notes.

Validation on 2026-09-26: all 258 tests passed, including tag-based account creation, transaction import/update/readback and generated Base predicates. TypeScript and final build/deployment passed; targeted test-vault reload loaded 1.11.0. No finance connections, provider requests, production notes or settings were changed.
