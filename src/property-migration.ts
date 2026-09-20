import { boundedWork } from "./bounded-work";
import { App, TFile, parseYaml } from "obsidian";
import { FinanceProperties, FINANCE_PROPERTY_KEYS, FinancePropertyNames, normalizePropertyNames } from "./finance-properties";
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

export async function remapGeneratedBases(app: App, root: string, from: FinanceProperties, to: FinanceProperties): Promise<void> {
  const definitions: Record<string, string[]> = {
    Accounts: [accountsBaseBody(root)], Rules: [rulesBaseBody(root)], Budgets: [budgetsBaseBody(root)],
    Transactions: [transactionsBaseBody(root), atomicBase(root, "Transactions")],
    Holdings: [holdingsBaseBody(root), atomicBase(root, "Holdings")],
    "Transactions (Atomic notes)": [atomicBase(root, "Transactions")],
    "Holdings (Atomic notes)": [atomicBase(root, "Holdings")],
  };
  for (const [name, bodies] of Object.entries(definitions)) {
    const file = app.vault.getAbstractFileByPath(financePath(root, "", `${name}.base`));
    if (!(file instanceof TFile)) continue;
    const content = await app.vault.read(file), body = bodies.find(body => from.base(body) === content);
    if (!body) continue; // User-authored Bases belong to the user.
    const replacement = to.base(body);
    if (replacement !== content) await app.vault.process(file, current => current === content ? replacement : current);
  }
}
