import { boundedWork } from "./bounded-work";
import { App, TFile, parseYaml } from "obsidian";
import { FinanceProperties, FINANCE_PROPERTY_KEYS, FinancePropertyNames, normalizePropertyNames, financeKindCodec, financeProperties } from "./finance-properties";
import { accountsBaseBody, transactionsBaseBody, holdingsBaseBody, rulesBaseBody, budgetsBaseBody } from "./finance-store";
import { atomicBase } from "./atomic-finance-store";
import { financePath } from "./finance-paths";

export interface PropertyMigration {
  from: FinancePropertyNames;
  to: FinancePropertyNames;
  root: string;
  notes: { path: string; identity: string }[];
}
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function sameValue(a: any, b: any, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (seen.has(a)) return seen.get(a) === b;
  seen.set(a, b);
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && sameValue(a[key], b[key], seen));
}
const identity = (raw: Record<string, unknown>) => JSON.stringify(
  ["financeId", "financeAccountId", "financeBudgetId", "financeRuleId", "securityId"]
    .filter(key => own(raw, key)).map(key => [key, raw[key]]));
const fields = (body: string): Record<string, any> => {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? parseYaml(match[1]) || {} : {};
};

export function propertyChanges(from: FinanceProperties, to: FinanceProperties): { from: string; to: string }[] {
  const changes = FINANCE_PROPERTY_KEYS.filter(key => from.key(key) !== to.key(key))
    .map(key => ({ from: from.key(key), to: to.key(key) }));
  for (const change of changes) {
    if (FINANCE_PROPERTY_KEYS.some(key => from.key(key) === change.to)) {
      throw new Error(`“${change.to}” is currently used by another finance field. Choose a distinct name.`);
    }
  }
  return changes;
}

/** A one-time rename, never a reader alias. Repeating an interrupted pass is safe. */
export function migrateProperties(raw: Record<string, any>, from: FinanceProperties, to: FinanceProperties): boolean {
  const changes = propertyChanges(from, to).filter(change => own(raw, change.from));
  for (const change of changes) {
    if (own(raw, change.to) && !sameValue(raw[change.to], raw[change.from])) {
      throw new Error(`“${change.to}” already has a different value. Resolve it before migrating “${change.from}”.`);
    }
  }
  for (const change of changes) { raw[change.to] = raw[change.from]; delete raw[change.from]; }
  return changes.length > 0;
}

export async function previewPropertyMigration(app: App, from: FinanceProperties, to: FinanceProperties, root: string) {
  const notes: PropertyMigration["notes"] = [], conflicts: string[] = [];
  const changes = propertyChanges(from, to);
  await boundedWork(app.vault.getMarkdownFiles(), async file => {
    const cached = app.metadataCache.getFileCache(file)?.frontmatter;
    const content = await app.vault.cachedRead(file);
    let raw: Record<string, any>;
    try { raw = fields(content); }
    catch (error) {
      if ((cached && from.isRecord(cached)) || /^(financeId|financeAccountId|financeRuleId|financeBudgetId):/m.test(content)) conflicts.push(`${file.path}: Invalid frontmatter.`);
      return;
    }
    if (!from.isRecord(raw) || !changes.some(change => own(raw, change.from))) return;
    notes.push({path: file.path, identity: identity(raw)});
    try { migrateProperties({...raw}, from, to); }
    catch (error) { conflicts.push(`${file.path}: ${error instanceof Error ? error.message : error}`); }
  });
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return { journal: {from: from.names, to: to.names, root, notes}, conflicts: conflicts.sort() };
}

export function normalizePropertyMigration(value: PropertyMigration | null | undefined): PropertyMigration | null {
  if (!value) return null;
  if (typeof value.root !== "string" || value.root.split("/").includes("..") || !Array.isArray(value.notes)
    || value.notes.some(note => !note || typeof note.path !== "string" || !note.path.endsWith(".md")
      || note.path.startsWith("/") || note.path.split("/").some(part => part === ".." || part.startsWith("."))
      || typeof note.identity !== "string")) throw new Error("Invalid finance property migration. Restore the settings before continuing.");
  return {...value, from: normalizePropertyNames(value.from), to: normalizePropertyNames(value.to)};
}

export async function applyPropertyMigration(app: App, journal: PropertyMigration): Promise<void> {
  const from = new FinanceProperties(journal.from), to = new FinanceProperties(journal.to);
  const check = (raw: Record<string, any>, note: PropertyMigration["notes"][number]) => {
    if (identity(raw) !== note.identity || (!from.isRecord(raw) && !to.isRecord(raw))) throw new Error(`${note.path}: The finance record changed identity. Restore it before resuming.`);
    return migrateProperties(raw, from, to);
  };
  // Preflight every destination before the first write, then check again inside each atomic edit.
  const work: {file: TFile; note: PropertyMigration["notes"][number]}[] = [];
  await boundedWork(journal.notes, async note => {
    const file = app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile)) throw new Error(`${note.path}: Note moved or is missing. Restore its path before resuming.`);
    if (check(fields(await app.vault.read(file)), note)) work.push({file, note});
  });
  await boundedWork(work, ({file, note}) => app.fileManager.processFrontMatter(file, raw => { check(raw, note); }));
  await remapGeneratedBases(app, journal.root, from, to);
}

function generatedBaseDefinitions(root: string): Record<string, string[]> {
  return {
    Accounts: [accountsBaseBody(root)], Rules: [rulesBaseBody(root)], Budgets: [budgetsBaseBody(root)],
    Transactions: [transactionsBaseBody(root), atomicBase(root, "Transactions")],
    Holdings: [holdingsBaseBody(root), atomicBase(root, "Holdings")],
    "Transactions (Atomic notes)": [atomicBase(root, "Transactions")],
    "Holdings (Atomic notes)": [atomicBase(root, "Holdings")],
  };
}

export async function previewGeneratedBaseClassificationChange(app: App, root: string,
  change: {recordKind: string; from: {tag: string} | {parentKind: string; key: string; value: string} | {kindList: {key: string; value: string}} | {scalar: {key: string; value: string}};
    to: {tag: string} | {parentKind: string; key: string; value: string} | {kindList: {key: string; value: string}} | {scalar: {key: string; value: string}}}): Promise<Array<{path: string; before: string; after: string}>> {
  if (!["account", "finance-transaction", "investment-transaction", "holding", "ledger", "finance-rule", "finance-budget"].includes(change.recordKind)) return [];
  const gcm = (app as any).plugins?.plugins?.["tps-global-context-menu"];
  const api = gcm?.api?.frontmatterKinds;
  if (!api?.definition) throw new Error("Enable TPS Global Context Menu before changing finance record classifications.");
  const from = financeProperties(app);
  if ("key" in change.to || "kindList" in change.to) {
    const targetKey = "kindList" in change.to ? change.to.kindList.key : change.to.key;
    const kindListKey = "kindList" in change.to && targetKey.toLowerCase() === (api.propertyKey?.("kind") || "kind").toLowerCase();
    const occupied = [
      ...FINANCE_PROPERTY_KEYS.filter(key => !kindListKey || key !== "kind"),
      ...FINANCE_PROPERTY_KEYS.filter(key => !kindListKey || key !== "kind").map(key => from.key(key)),
      "tpsId", gcm?.settings?.nativeRecordIdentityPropertyKey || "tpsId",
      "financeId", "financeAccountId", "financeBudgetId", "financeRuleId", "securityId",
    ];
    if (occupied.some(key => key.toLowerCase() === targetKey.toLowerCase())) {
      throw new Error(`Subkind property “${targetKey}” conflicts with a Finance field or record ID. Choose another name.`);
    }
  }
  if (("tag" in change.from || "tag" in change.to) && from.key("tags") !== "tags") throw new Error("Migrate the Finance Tags property name back to tags before changing this record classification.");
  if (("key" in change.from || "key" in change.to) && from.key("kind") !== "kind") throw new Error("Migrate the Finance Record kind property name back to kind before changing this record classification.");
  const to = new FinanceProperties((app as any).plugins?.plugins?.["tps-finances"]?.settings?.propertyNames,
    financeKindCodec({ ...api,
      definition: (kind: string) => kind === change.recordKind ? change.to : api.definition(kind),
      readDefinitions: (kind: string) => kind === change.recordKind
        ? [change.to, ...(api.readDefinitions?.(kind) || []).filter((definition: unknown) => JSON.stringify(definition) !== JSON.stringify(change.to))]
        : api.readDefinitions?.(kind) || [],
    }));
  const changes: Array<{path: string; before: string; after: string}> = [];
  for (const [name, bodies] of Object.entries(generatedBaseDefinitions(root))) {
    const file = app.vault.getAbstractFileByPath(financePath(root, "", `${name}.base`));
    if (!(file instanceof TFile)) continue;
    const before = await app.vault.read(file);
    const body = bodies.find(candidate => from.base(candidate) === before);
    if (!body) continue; // A customized Base remains user-owned.
    const after = to.base(body);
    if (after !== before) changes.push({path: file.path, before, after});
  }
  return changes;
}

export async function remapGeneratedBases(app: App, root: string, from: FinanceProperties, to: FinanceProperties): Promise<void> {
  for (const [name, bodies] of Object.entries(generatedBaseDefinitions(root))) {
    const file = app.vault.getAbstractFileByPath(financePath(root, "", `${name}.base`));
    if (!(file instanceof TFile)) continue;
    const content = await app.vault.read(file), body = bodies.find(body => from.base(body) === content);
    if (!body) continue; // User-authored Bases belong to the user.
    const replacement = to.base(body);
    if (replacement !== content) await app.vault.process(file, current => current === content ? replacement : current);
  }
}
