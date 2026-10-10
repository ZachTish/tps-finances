import { App, TFile, parseYaml } from "obsidian";
import { boundedWork } from "./bounded-work";
import { financeProperties, FinanceProperties } from "./finance-properties";
import { previewGeneratedBaseIdentityChanges } from "./property-migration";

export interface FinanceIdentityMigrationNote {
  path: string;
  id: string;
  legacyKey: string;
}

/** Transient review evidence only. Never persisted or run during discovery. */
export interface FinanceIdentityMigrationPreview {
  primaryKey: string;
  configuration: string;
  inspected: number;
  notes: FinanceIdentityMigrationNote[];
  bases: Array<{path: string; before: string; after: string}>;
  conflicts: string[];
}

interface SourceEvidence {
  file: TFile;
  path: string;
  mtime: number;
  size: number;
  source: string;
}
interface IdentityInventory {
  preview: FinanceIdentityMigrationPreview;
  evidence: SourceEvidence[];
  replacements: Map<string, string>;
}

const normalizedId = (value: unknown): string => typeof value === "string" && value === value.trim() ? value : "";
const normalizedKey = (value: string): string => value.toLocaleLowerCase();

function actualKey(raw: Record<string, unknown>, key: string): string | null {
  const keys = Object.keys(raw).filter(candidate => normalizedKey(candidate) === normalizedKey(key));
  if (keys.length > 1) throw new Error(`The “${key}” property occurs more than once.`);
  return keys[0] || null;
}

function configurationSignature(app: App, properties: FinanceProperties): string {
  const gcm = (app as any).plugins?.plugins?.["tps-global-context-menu"]?.api;
  return JSON.stringify([properties.identityKey, properties.names,
    (app as any).plugins?.plugins?.["tps-finances"]?.settings?.financeFolder || "",
    gcm?.nativeRecords?.getStorageProfile?.(),
    ["account", "finance-transaction", "investment-transaction", "finance-rule", "finance-budget"]
      .map(kind => gcm?.frontmatterKinds?.definition?.(kind) || null)]);
}

interface Header { start: number; end: number; raw: Record<string, unknown>; }
function header(source: string): Header | null {
  const opening = source.match(/^(?:\uFEFF)?---[ \t]*\r?\n/u);
  if (!opening) return null;
  const remainder = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/mu.exec(remainder);
  if (!closing || closing.index === undefined) throw new Error("The frontmatter block is not closed.");
  const yaml = remainder.slice(0, closing.index);
  const parsed = parseYaml(yaml);
  if (parsed == null) return {start: opening[0].length, end: opening[0].length + closing.index, raw: {}};
  if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Frontmatter must contain properties.");
  return {start: opening[0].length, end: opening[0].length + closing.index, raw: parsed};
}

/** Remove only a matching owned duplicate scalar line. Preserve every other source byte. */
export function consolidateFinanceIdentitySource(source: string, primaryKey: string,
  legacyKey: string, expectedId: string): string {
  const parsed = header(source);
  if (!parsed) throw new Error("The finance note no longer has frontmatter.");
  const primary = actualKey(parsed.raw, primaryKey), legacy = actualKey(parsed.raw, legacyKey);
  if (!primary) throw new Error("The current finance identity is missing; a single legacy ID stays unchanged.");
  if (!legacy || normalizedId(parsed.raw[legacy]) !== expectedId) throw new Error("The legacy finance identity changed.");
  if (normalizedId(parsed.raw[primary]) !== expectedId) throw new Error("The current and legacy finance IDs differ.");
  if (normalizedKey(primary) === normalizedKey(legacy)) return source;
  const yaml = source.slice(parsed.start, parsed.end);
  const lines = /^(?:([A-Za-z_][A-Za-z0-9_-]*)|("(?:[^"\\]|\\.)*")|('(?:[^']|'')*'))([ \t]*:[ \t]*)([^\r\n]*)(\r?\n|$)/gmu;
  let matching: RegExpExecArray | null = null;
  for (let line = lines.exec(yaml); line; line = lines.exec(yaml)) {
    const key = line[1] || (line[2] ? JSON.parse(line[2]) : line[3].slice(1, -1).replace(/''/g, "'"));
    if (key !== legacy) continue;
    if (matching) throw new Error("The identity property is duplicated in the source.");
    matching = line;
  }
  if (!matching || /^[&*|>]/u.test(matching[5].trim())) {
    throw new Error("The identity must be a standalone scalar property before consolidation.");
  }
  const offset = matching.index;
  const next = source.slice(0, parsed.start) + yaml.slice(0, offset)
    + yaml.slice(offset + matching[0].length) + source.slice(parsed.end);
  const updated = header(next)!.raw;
  const actualPrimary = actualKey(updated, primaryKey);
  if (!actualPrimary || normalizedId(updated[actualPrimary]) !== expectedId || actualKey(updated, legacyKey)) {
    throw new Error("Could not verify the consolidated finance identity.");
  }
  return next;
}

function assertInventoryUnchanged(app: App, inventory: IdentityInventory): void {
  const files = app.vault.getMarkdownFiles();
  if (files.length !== inventory.evidence.length) throw new Error("The vault changed during ID consolidation. Review again.");
  const current = new Set(files);
  for (const evidence of inventory.evidence) {
    if (!current.has(evidence.file) || evidence.file.path !== evidence.path
      || app.vault.getAbstractFileByPath(evidence.path) !== evidence.file
      || evidence.file.stat.mtime !== evidence.mtime || evidence.file.stat.size !== evidence.size) {
      throw new Error("A note changed during ID consolidation. Review again.");
    }
  }
}

async function inventoryIdentities(app: App): Promise<IdentityInventory> {
  const properties = financeProperties(app), primaryKey = properties.identityKey;
  if (!primaryKey) throw new Error("The active Finance record ID property is unavailable.");
  const configuration = configurationSignature(app, properties);
  const files = app.vault.getMarkdownFiles();
  const inventory: IdentityInventory = {preview: {primaryKey, configuration, inspected: files.length, notes: [], bases: [], conflicts: []},
    evidence: [], replacements: new Map()};
  const owners = new Map<string, Set<string>>();
  const addOwner = (id: string, path: string) => {
    const key = normalizedKey(id);
    const paths = owners.get(key) || new Set<string>();
    paths.add(path); owners.set(key, paths);
  };
  await boundedWork(files, async file => {
    const evidence: SourceEvidence = {file, path: file.path, mtime: file.stat.mtime, size: file.stat.size, source: ""};
    evidence.source = await app.vault.read(file);
    inventory.evidence.push(evidence);
    try {
      const parsed = header(evidence.source);
      if (!parsed) return;
      const primary = actualKey(parsed.raw, primaryKey);
      if (primary) {
        const id = normalizedId(parsed.raw[primary]);
        if (!id) throw new Error(`The “${primaryKey}” identity is not a nonempty string.`);
        addOwner(id, evidence.path);
      }
      const decoded = properties.read(parsed.raw);
      const legacyKey = properties.ownIdentityKey(decoded);
      if (!legacyKey || normalizedKey(legacyKey) === normalizedKey(primaryKey)) return;
      const legacy = actualKey(parsed.raw, legacyKey);
      if (!legacy) return;
      const id = normalizedId(parsed.raw[legacy]);
      if (!id) throw new Error("The legacy finance identity is not a nonempty string.");
      addOwner(id, evidence.path);
      if (!primary) return;
      const next = consolidateFinanceIdentitySource(evidence.source, primaryKey, legacyKey, id);
      if (next !== evidence.source) {
        inventory.preview.notes.push({path: evidence.path, id, legacyKey});
        inventory.replacements.set(evidence.path, next);
      }
    } catch (error) {
      inventory.preview.conflicts.push(`${evidence.path}: ${error instanceof Error ? error.message : error}`);
    }
  });
  for (const paths of owners.values()) if (paths.size > 1) {
    inventory.preview.conflicts.push(`Duplicate note identity in ${[...paths].sort().join(", ")}.`);
  }
  inventory.preview.bases = await previewGeneratedBaseIdentityChanges(app,
    (app as any).plugins?.plugins?.["tps-finances"]?.settings?.financeFolder || "");
  inventory.preview.notes.sort((a, b) => a.path.localeCompare(b.path));
  inventory.preview.conflicts.sort();
  if (configurationSignature(app, financeProperties(app)) !== configuration) throw new Error("Finance property settings changed. Review again.");
  assertInventoryUnchanged(app, inventory);
  return inventory;
}

/** Explicit finite source scan; UI calls it only after Review is clicked. */
export async function previewFinanceIdentityMigration(app: App): Promise<FinanceIdentityMigrationPreview> {
  return (await inventoryIdentities(app)).preview;
}

export async function applyFinanceIdentityMigration(app: App, preview: FinanceIdentityMigrationPreview): Promise<number> {
  if (preview.conflicts.length) throw new Error("Resolve the ID conflicts before consolidating finance notes.");
  const inventory = await inventoryIdentities(app);
  if (inventory.preview.conflicts.length) throw new Error(inventory.preview.conflicts[0]);
  if (preview.configuration !== inventory.preview.configuration
    || JSON.stringify(preview.notes) !== JSON.stringify(inventory.preview.notes)
    || JSON.stringify(preview.bases) !== JSON.stringify(inventory.preview.bases)) {
    throw new Error("The reviewed finance identities changed. Review again.");
  }
  let updated = 0;
  const evidenceByPath = new Map(inventory.evidence.map(item => [item.path, item]));
  for (const note of inventory.preview.notes) {
    const evidence = evidenceByPath.get(note.path)!;
    const replacement = inventory.replacements.get(note.path)!;
    if (configurationSignature(app, financeProperties(app)) !== preview.configuration) throw new Error("Finance property settings changed. Review again.");
    await app.vault.process(evidence.file, current => {
      if (evidence.file.path !== evidence.path || app.vault.getAbstractFileByPath(evidence.path) !== evidence.file) {
        throw new Error(`${note.path}: The reviewed note moved or was replaced. Review again.`);
      }
      if (configurationSignature(app, financeProperties(app)) !== preview.configuration || current !== evidence.source) {
        throw new Error(`${note.path}: The reviewed source changed. Review again.`);
      }
      return replacement;
    });
    updated += 1;
  }
  return updated;
}
