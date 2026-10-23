// Generated from settings UI copy. Run npm run settings:search; do not edit.
export const SETTINGS_SEARCH_ROUTES = {
  "data": "Data & storage",
  "rules": "Rules & budgets",
  "properties": "Properties"
} as const;
export const SETTINGS_SEARCH_ENTRIES = [
  {"name":"Bank connections","desc":"Bank and Wallet importing are retired here. Configure imports in TishOS; existing notes remain available.","aliases":["Bank connections"],"route":"data"},
  {"name":"Record classification","desc":"Global Context Menu owns record classification, Scheduled and record IDs. Review older IDs under Data & storage → Older records.","aliases":["Record classification","Configure in GCM"],"route":"properties"},
  {"name":"Property migration paused","desc":"Resume to finish renaming properties. Finance writes remain paused until it completes.","aliases":["Property migration paused","Resume migration"],"route":"properties"},
  {"name":"Property names","desc":"Current manual fields appear first. Imported and older-record mappings remain below. The toggle pins a property name; turning it off restores the default name, not whether a field is written. Import output is configured in TishOS. Save asks before renaming existing properties; ID values stay unchanged.","aliases":["Property names","Save property names","Discard edits"],"route":"properties"},
  {"name":"Property group","desc":"","aliases":["Property group"],"route":"properties"},
  {"name":"Scheduled","desc":"","aliases":["date","Scheduled","Record kind"],"route":"properties"},
  {"name":"Finance folder","desc":"Leave blank for the vault root, without subfolders. Existing notes stay where they are.","aliases":["Finance folder","Vault root"],"route":"data"},
  {"name":"Debug logging","desc":"Log record operations without tokens or transaction descriptions.","aliases":["Debug logging"],"route":"data"},
  {"name":"Legacy inline transactions","desc":"Older inline entries may still exist. Transaction notes are the active format; adding transactions stays paused until a full check finds no remaining markers. Existing notes are left untouched. Transaction notes are the active format. Check older inline entries when reviewing an imported or older vault; the check changes no notes.","aliases":["Legacy inline transactions","Check old entries","Convert to transaction notes"],"route":"data"},
  {"name":"Record IDs","desc":"New finance notes use one record ID. Review existing notes to remove matching duplicate self IDs. Notes with only an older ID stay unchanged and readable. Account and security references remain unchanged.","aliases":["Record IDs","Review existing IDs"],"route":"data"},
  {"name":"Categorization rules","desc":"Create a rule for ordered account, name, merchant, amount, category, and tag matching.","aliases":["Categorization rules","Add rule"],"route":"rules"},
  {"name":"Monthly budgets","desc":"Plan income, fixed expenses, flexible spending, and savings contributions.","aliases":["Monthly budgets","Open Budgets Base","Add budget"],"route":"rules"},
  {"name":"Data & storage","desc":"Open this settings area.","aliases":["TPS Finances","Choose what to configure","Consolidate finance record IDs?","ID values, note paths, links, bodies, provider state and account/security references are preserved. Nothing changes until you confirm.","Consolidate IDs","Cancel","Migrate existing properties?","Migrate and save","Save without migrating","Without migration, old properties stay in the notes but Finances stops using them. Customized Bases and other plugins must be updated separately."],"route":"data"},
  {"name":"Properties","desc":"Open this settings area.","aliases":["These names read existing data or support explicit conversion. Changing them does not change TishOS import settings. Conversion can preserve source values; opening this section changes no notes."],"route":"properties"},
  {"name":"Rules & budgets","desc":"Open this settings area.","aliases":["Rules and budgets are ordinary notes. Use these shortcuts to create them, then manage the full collections in their notes or your Bases."],"route":"rules"}
] as const;
