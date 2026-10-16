import { financeProperties } from "./finance-properties";
import { financeDirectory, financePath, financePrefix } from "./finance-paths";
import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import type { FinanceBudget, FinanceRule, FinanceTransaction } from "./types";
import { normalizeTags } from "./classification";
import { boundedWork } from "./bounded-work";
import { budgetInputError, budgetOverlapError, budgetBucket, budgetCurrency, accountLinkPath } from "./flex-budget";
import type { DashboardFileSnapshot } from "./dashboard-file-snapshot";

type TransactionRecord = { line: string; path: string; lineNumber: number; sourceFile?: TFile };
export type TransactionReadSource = "source" | "metadata";
type TransactionIndex = {
  recordsById: Map<string, TransactionRecord[]>;
  idsByPath: Map<string, Set<string>>;
  fileOrder: Map<string, number>;
  nextFileOrder: number;
};

/** Fresh, explicit certification before retiring inline transaction discovery. */
export async function auditLegacyTransactionMarkers(app: App): Promise<{ markers: number; firstPath: string }> {
  const files = app.vault.getMarkdownFiles();
  const starting = new Map(files.map(file => [file.path, { file, mtime: file.stat.mtime, size: file.stat.size }]));
  const counts = new Array<number>(files.length).fill(0);
  await boundedWork([...files.entries()], async ([index, file]) => {
    const content = await app.vault.read(file);
    const markers = content.match(/\[financeId::/g)?.length || 0;
    counts[index] = markers ? markers - verifiedMigrationSourceMarker(app, content) : 0;
  });
  const current = app.vault.getMarkdownFiles();
  if (current.length !== files.length || current.some(file => {
    const original = starting.get(file.path);
    return !original || original.file !== file || original.mtime !== file.stat.mtime || original.size !== file.stat.size;
  })) throw new Error("The vault changed during transaction verification. Run the check again.");
  return { markers: counts.reduce((sum, count) => sum + count, 0), firstPath: files[counts.findIndex(count => count > 0)]?.path || "" };
}

/** A converted note retains its original line for retry verification, not discovery. */
function verifiedMigrationSourceMarker(app: App, content: string): number {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return 0;
  const yaml = match[1];
  let fields: Record<string, any>;
  let key: string;
  try {
    const properties = financeProperties(app);
    fields = properties.read(parseYaml(yaml) || {});
    key = properties.key("migrationSource");
  } catch { return 0; }
  const source = fields.migrationSource;
  const originalAmount = typeof source === "string" ? inlineField(source, "amount") : "";
  if (typeof source !== "string" || !/^-\s/.test(source)
    || (source.match(/\[financeId::/g)?.length || 0) !== 1
    || !["transaction", "investmentTransaction"].includes(fields.type)
    || String(fields.financeId || "") !== inlineField(source, "financeId")
    || fields.type !== inlineField(source, "type")
    || !/^\d{4}-\d{2}-\d{2}$/.test(inlineField(source, "date"))
    || !inlineField(source, "account")
    || !originalAmount || !Number.isFinite(Number(originalAmount))
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(fields.date || ""))
    || !fields.account || fields.amount === null || fields.amount === ""
    || !Number.isFinite(Number(fields.amount))) return 0;

  // Count only the literal marker inside this top-level YAML string. Comments
  // and other properties are findings, even when YAML escapes the provenance.
  const headers = [`${key}:`, `${JSON.stringify(key)}:`, `'${key.replace(/'/g, "''")}':`];
  const lines = yaml.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => headers.some(header => line.startsWith(header)) ? [index] : []);
  if (starts.length !== 1) return 0;
  const header = headers.find(candidate => lines[starts[0]].startsWith(candidate))!;
  const firstLine = lines[starts[0]].slice(header.length).trimStart();
  if (firstLine[0] === ">" || firstLine[0] === "|") {
    let end = starts[0] + 1;
    while (end < lines.length && (!lines[end].trim() || /^\s/.test(lines[end]))) end++;
    return (lines.slice(starts[0] + 1, end).join("\n").match(/\[financeId::/g)?.length || 0) === 1 ? 1 : 0;
  }
  const encoded = lines.slice(starts[0]).join("\n").slice(header.length).trimStart();
  const quote = encoded[0];
  if (quote !== '"' && quote !== "'") return 0;
  let end = 1;
  while (end < encoded.length) {
    if (quote === '"' && encoded[end] === "\\") { end += 2; continue; }
    if (encoded[end] === quote) {
      if (quote === "'" && encoded[end + 1] === "'") { end += 2; continue; }
      break;
    }
    end++;
  }
  if (end === encoded.length) return 0;
  return (encoded.slice(1, end).match(/\[financeId::/g)?.length || 0) === 1 ? 1 : 0;
}

export class FinanceStore {
  protected transactionIndex: TransactionIndex | null = null;

  constructor(
    private readonly app: App,
    private readonly rootFolder: string,
    private readonly processFrontmatter: (file: TFile, mutator: (frontmatter: Record<string, unknown>) => void) => Promise<unknown> = (file, mutator) => financeProperties(app).process(app, file, mutator),
  ) {}

  async ensureStructure(): Promise<void> {
    await this.ensureFolder(this.rootFolder);
    await this.ensureFolder(financeDirectory(this.rootFolder, "Accounts"));
    await this.ensureFolder(financeDirectory(this.rootFolder, "Snapshots"));
    await this.ensureFolder(financeDirectory(this.rootFolder, "Rules"));
    await this.ensureFolder(financeDirectory(this.rootFolder, "Budgets"));
    await this.ensureBaseFile(financePath(this.rootFolder, "", "Accounts.base"), accountsBaseBody(this.rootFolder));
    await this.ensureBaseFile(financePath(this.rootFolder, "", "Transactions.base"), transactionsBaseBody(this.rootFolder));
    await this.ensureBaseFile(financePath(this.rootFolder, "", "Holdings.base"), holdingsBaseBody(this.rootFolder));
    await this.ensureBaseFile(financePath(this.rootFolder, "", "Rules.base"), rulesBaseBody(this.rootFolder));
    await this.ensureBaseFile(financePath(this.rootFolder, "", "Budgets.base"), budgetsBaseBody(this.rootFolder));
  }

  async readTransactionRecords(_source: TransactionReadSource = "source", _files?: DashboardFileSnapshot): Promise<TransactionRecord[]> {
    return this.readLegacyTransactionRecords("source");
  }

  protected async readLegacyTransactionRecords(source: TransactionReadSource): Promise<TransactionRecord[]> {
    const index = await this.ensureTransactionIndex(source);
    return [...index.recordsById.values()].flatMap((records) => records.slice(0, 1));
  }

  readRules(sourcePaths?: Set<string>, files?: DashboardFileSnapshot): FinanceRule[] {
    const prefix = financePrefix(this.rootFolder, "Rules");
    const fields = (file: TFile) => files?.fields(file) ?? financeProperties(this.app).cache(this.app, file);
    return (files?.files ?? this.app.vault.getMarkdownFiles()).filter((file) => file.path.startsWith(prefix) && (Boolean(this.rootFolder) || fields(file)?.kind === "financeRule")).map((file) => {
      sourcePaths?.add(file.path);
      const value = fields(file) || {};
      return {
        id: String(value.financeRuleId || file.path),
        name: String(value.title || file.basename),
        enabled: value.enabled !== false,
        priority: finiteNumber(value.priority) ?? 100,
        accountContains: String(value.accountContains || ""),
        nameContains: String(value.nameContains || ""),
        merchantContains: String(value.merchantContains || ""),
        minAmount: finiteNumber(value.minAmount),
        maxAmount: finiteNumber(value.maxAmount),
        category: String(value.category || ""),
        tags: normalizeTags(arrayValue(value.tags)),
      };
    }).filter((rule) => Boolean(rule.category || rule.tags.length));
  }

  readBudgets(): FinanceBudget[] {
    const prefix = financePrefix(this.rootFolder, "Budgets");
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix) && (Boolean(this.rootFolder) || financeProperties(this.app).cache(this.app, file)?.kind === "financeBudget")).map((file) => {
      const value = financeProperties(this.app).cache(this.app, file) || {};
      return {
        id: String(value.financeBudgetId || file.path),
        name: String(value.title || file.basename),
        category: String(value.category || ""),
        monthlyLimit: finiteNumber(value.monthlyLimit) ?? 0,
      };
    }).filter((budget) => Boolean(budget.category) && budget.monthlyLimit > 0);
  }

  async createRule(rule: FinanceRule): Promise<TFile> {
    const path = this.uniquePath(financePath(this.rootFolder, "Rules", `${safeName(rule.name)}.md`));
    const body = `---\ntitle: ${yamlString(rule.name)}\nkind: financeRule\nfinanceRuleId: ${yamlString(rule.id)}\nenabled: ${rule.enabled ? "true" : "false"}\npriority: ${rule.priority}\naccountContains: ${yamlString(rule.accountContains)}\nnameContains: ${yamlString(rule.nameContains)}\nmerchantContains: ${yamlString(rule.merchantContains)}\nminAmount: ${rule.minAmount == null ? "null" : decimal(rule.minAmount)}\nmaxAmount: ${rule.maxAmount == null ? "null" : decimal(rule.maxAmount)}\ncategory: ${yamlString(rule.category)}\ntags: ${JSON.stringify(normalizeTags(rule.tags))}\n---\n`;
    return this.app.vault.create(path, financeProperties(this.app).note(body));
  }

  async createBudget(budget: FinanceBudget): Promise<TFile> {
    const path = this.uniquePath(financePath(this.rootFolder, "Budgets", `${safeName(budget.name)}.md`));
    const body = `---\ntitle: ${yamlString(budget.name)}\nkind: financeBudget\nfinanceBudgetId: ${yamlString(budget.id)}\ncategory: ${yamlString(budget.category)}\nmonthlyLimit: ${decimal(budget.monthlyLimit)}\n---\n`;
    return this.app.vault.create(path, financeProperties(this.app).note(body));
  }

  async readBudgetEntries(sourcePaths?: Set<string>, source: TransactionReadSource = "source", snapshot?: DashboardFileSnapshot): Promise<FinanceBudget[]> {
    const records: FinanceBudget[] = [];
    const prefix = financePrefix(this.rootFolder, "Budgets");
    const properties = snapshot?.properties ?? financeProperties(this.app);
    const files: { file: TFile; indexed: ReturnType<typeof properties.read> | null }[] = [];
    for (const file of snapshot?.files ?? this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const raw = (snapshot ? snapshot.cache(file) : this.app.metadataCache.getFileCache(file))?.frontmatter;
      // A missing or empty index can hide a newly-created root budget. Indexed
      // ordinary notes can be excluded without entering the content read queue.
      const indexed = raw && Object.keys(raw).some(key => key !== "position") ? snapshot?.fields(file) ?? properties.read(raw) : null;
      if (indexed && indexed.kind !== "financeBudget" && !indexed.financeBudgetId && (source === "metadata" || !this.rootFolder)) continue;
      files.push({ file, indexed: source === "metadata" ? indexed : null });
    }
    await boundedWork(files, async ({ file, indexed }) => {
      try {
        let fm = indexed;
        if (!fm) {
          const text = await this.app.vault.cachedRead(file);
          const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
          if (!match) return;
          const marked = /financeBudgetId|financeBudget/.test(match[1]);
          // A mapped kind can identify a legacy budget without either literal marker.
          if (!marked && !properties.customized) return;
          let raw: Record<string, unknown>;
          try { raw = parseYaml(match[1]) || {}; }
          catch (error) {
            if (marked) throw error;
            return; // Unrelated, malformed frontmatter was never a budget candidate.
          }
          fm = properties.read(raw);
        }
        if (!fm || (!fm.financeBudgetId && fm.kind !== "financeBudget")) return;
        sourcePaths?.add(file.path);
        const links = Array.isArray(fm.accounts) ? fm.accounts : fm.accounts ? [fm.accounts] : [];
        const accounts = links.map((value: unknown) => {
          const raw = String(value), link = raw.replace(/^\[\[|\]\]$/g, "").split("|")[0];
          const resolved = this.app.metadataCache.getFirstLinkpathDest?.(link, file.path);
          return resolved ? `[[${resolved.path.replace(/\.md$/i, "")}]]` : raw;
        });
        records.push({id:String(fm.financeBudgetId || file.path),name:String(fm.title || file.basename),
          category:String(fm.category || ""),monthlyLimit:fm.monthlyLimit == null || fm.monthlyLimit === "" ? NaN : Number(fm.monthlyLimit),
          bucket:fm.bucket || "category",currency:String(fm.currency || "USD"),accounts,sourcePath:file.path,revision:budgetRevision(fm)});
      } catch (error) {
        // Preserve the failing source for repair/deletion invalidation without
        // making successfully excluded ordinary notes dashboard dependencies.
        sourcePaths?.add(file.path);
        throw error;
      }
    });
    return records.sort((a,b)=>a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async saveBudgetEntry(budget: FinanceBudget, original?: FinanceBudget): Promise<TFile> {
    const existing = await this.readBudgetEntries();
    if (existing.some(entry=>entry.id===budget.id && entry.sourcePath!==original?.sourcePath)) throw new Error("Duplicate budget identity. Reopen the existing target.");
    const error = budgetInputError(budget) || budgetOverlapError(budget, existing);
    if (error) throw new Error(error);
    if (budgetBucket(budget) === "savings") {
      for (const link of budget.accounts || []) {
        const file = this.app.vault.getAbstractFileByPath(`${accountLinkPath(link)}.md`);
        if (!(file instanceof TFile)) throw new Error("A selected account moved or was deleted. Reopen the budget editor.");
        const body = await this.app.vault.read(file);
        const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        const fm = match ? financeProperties(this.app).read(parseYaml(match[1]) || {}) : null;
        if (!fm?.financeAccountId || !["depository", "investment", "brokerage"].includes(fm.accountType) || (fm.currency || "USD") !== budgetCurrency(budget)) {
          throw new Error("Choose existing savings or investment accounts in this currency.");
        }
      }
    }
    const fields = { title:budget.name.trim(), financeBudgetId:budget.id, bucket:budgetBucket(budget),
      category:budget.category.trim(), monthlyLimit:budget.monthlyLimit, currency:budgetCurrency(budget), accounts:budget.accounts || [] };
    if (original?.sourcePath) {
      const file = this.app.vault.getAbstractFileByPath(original.sourcePath);
      if (!(file instanceof TFile)) throw new Error("The budget note moved or was deleted. Reopen it and try again.");
      await financeProperties(this.app).process(this.app, file, fm => {
        if (!original.revision || budgetRevision(fm) !== original.revision) {
          throw new Error("The budget changed while you were editing. Reopen it to keep the newer values.");
        }
        Object.assign(fm,fields); // Preserve custom properties, tags, kind and the note body.
      });
      return file;
    }
    const path = this.uniquePath(financePath(this.rootFolder,"Budgets",`${safeName(budget.name)}.md`));
    return this.app.vault.create(path,`---\n${stringifyYaml(financeProperties(this.app).write({kind:"financeBudget",...fields}))}---\n`);
  }

  private async ensureTransactionIndex(source: TransactionReadSource = "source"): Promise<TransactionIndex> {
    if (source === "source" && this.transactionIndex) return this.transactionIndex;
    const files = this.app.vault.getMarkdownFiles();
    const index: TransactionIndex = {
      recordsById: new Map(),
      idsByPath: new Map(),
      fileOrder: new Map(),
      nextFileOrder: files.length,
    };
    await boundedWork([...files.entries()], async ([order, file]) => {
      const pathBeforeRead = file.path;
      if (source === "metadata" && this.metadataExcludesLegacyList(file)) {
        index.fileOrder.set(file.path, order);
        return;
      }
      const content = await this.app.vault.cachedRead(file);
      if (
        file.path !== pathBeforeRead
        && (
          this.app.vault.getAbstractFileByPath(file.path) !== file
          || index.fileOrder.has(file.path)
        )
      ) {
        throw new Error("A transaction source changed identity while its index was being read.");
      }
      index.fileOrder.set(file.path, order);
      this.indexTransactionFile(index, file.path, content);
    });
    // Async reads may finish out of order. Preserve vault/line precedence both for
    // duplicate metadata and for callers enumerating the transaction records.
    index.recordsById = new Map([...index.recordsById].sort((a, b) =>
      (index.fileOrder.get(a[1][0].path)! - index.fileOrder.get(b[1][0].path)!)
      || a[1][0].lineNumber - b[1][0].lineNumber));
    if (source === "source") this.transactionIndex = index;
    return index;
  }

  private metadataExcludesLegacyList(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    // A legacy marker in a Markdown list is indexed as a list item. Keep reading
    // other blocks: the old line parser also accepts raw "- " lines in code/YAML.
    return Boolean(cache
      && Array.isArray(cache.sections) && cache.sections.length
      && !cache.frontmatter && !cache.frontmatterPosition
      && (!cache.listItems || (Array.isArray(cache.listItems) && !cache.listItems.length))
      && cache.sections.every(section => section.type === "paragraph" || section.type === "heading"));
  }

  private indexTransactionFile(index: TransactionIndex, path: string, content: string): void {
    for (const financeId of index.idsByPath.get(path) || []) {
      const records = (index.recordsById.get(financeId) || []).filter((record) => record.path !== path);
      if (records.length) index.recordsById.set(financeId, records);
      else index.recordsById.delete(financeId);
    }

    if (!index.fileOrder.has(path)) {
      index.fileOrder.set(path, index.nextFileOrder);
      index.nextFileOrder += 1;
    }
    if (!content.includes("[financeId::")) {
      index.idsByPath.delete(path);
      return;
    }
    const recordsById = new Map<string, TransactionRecord[]>();
    content.split("\n").forEach((line, lineNumber) => {
      if (!/^-\s/.test(line) || !line.includes("[financeId::")) return;
      const financeId = inlineField(line, "financeId");
      if (!financeId) return;
      const records = recordsById.get(financeId) || [];
      records.push({ line, path, lineNumber });
      recordsById.set(financeId, records);
    });
    for (const [financeId, fileRecords] of recordsById) {
      const records = [...(index.recordsById.get(financeId) || []), ...fileRecords];
      records.sort((left, right) => (
        (index.fileOrder.get(left.path) ?? 0) - (index.fileOrder.get(right.path) ?? 0)
        || left.lineNumber - right.lineNumber
      ));
      index.recordsById.set(financeId, records);
    }
    if (recordsById.size) index.idsByPath.set(path, new Set(recordsById.keys()));
    else index.idsByPath.delete(path);
  }

  protected uniquePath(path: string): string {
    if (!this.app.vault.getAbstractFileByPath(path)) return path;
    const base = path.replace(/\.md$/i, "");
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(`${base} ${index}.md`)) index += 1;
    return `${base} ${index}.md`;
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    let current = "";
    for (const part of normalizePath(path).split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private async ensureBaseFile(path: string, body: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!this.app.vault.getAbstractFileByPath(normalized)) await this.app.vault.create(normalized, financeProperties(this.app).base(body));
  }
}

export function transactionLine(transaction: FinanceTransaction, accountPath: string, localMetadata: { categoryOverride?: string; tags?: string[] } = {}): string {
  const fields = [
    `[type:: ${transaction.kind}]`,
    `[financeId:: ${transaction.financeId}]`,
    `[date:: ${transaction.date}]`,
    `[account:: ${accountPath ? `[[${accountPath.replace(/\.md$/i, "")}]]` : transaction.financeAccountId}]`,
    `[amount:: ${decimal(transaction.amount)}]`,
    `[currency:: ${inlineValue(transaction.currency)}]`,
    `[pending:: ${transaction.pending ? "true" : "false"}]`,
    `[subtype:: ${inlineValue(transaction.subtype)}]`,
  ];
  if (transaction.category) fields.push(`[providerCategory:: ${inlineValue(transaction.category)}]`);
  if (transaction.categoryDetail) fields.push(`[providerCategoryDetail:: ${inlineValue(transaction.categoryDetail)}]`);
  if (localMetadata.categoryOverride) fields.push(`[categoryOverride:: ${inlineValue(localMetadata.categoryOverride)}]`);
  const tags = normalizeTags(localMetadata.tags || []);
  if (tags.length) fields.push(`[tags:: ${tags.join(", ")}]`);
  if (transaction.merchantName) fields.push(`[merchant:: ${inlineValue(transaction.merchantName)}]`);
  if (transaction.providerName) fields.push(`[providerName:: ${inlineValue(transaction.providerName)}]`);
  if (transaction.securityId) fields.push(`[securityId:: ${inlineValue(transaction.securityId)}]`);
  if (transaction.quantity != null) fields.push(`[quantity:: ${decimal(transaction.quantity)}]`);
  if (transaction.price != null) fields.push(`[price:: ${decimal(transaction.price)}]`);
  if (transaction.fees != null) fields.push(`[fees:: ${decimal(transaction.fees)}]`);
  if (transaction.investmentType) fields.push(`[investmentType:: ${inlineValue(transaction.investmentType)}]`);
  return `- ${inlineValue(transaction.name)} ${fields.join(" ")}`;
}

export function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim() || "Account";
}

function inlineValue(value: string): string {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\]/g, "\\]").trim();
}

function decimal(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function accountsBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - kind == "account"\n    - ${root ? `file.path.startsWith(${JSON.stringify(financePrefix(root, "Accounts"))})` : 'financeAccountId != null'}\nviews:\n  - type: table\n    name: Accounts\n    order:\n      - institution\n      - accountName\n      - accountType\n      - accountSubtype\n      - accountMask\n      - currency\n      - file.name\n    sort:\n      - property: institution\n        direction: ASC\n      - property: accountName\n        direction: ASC\n`;
}

export function transactionsBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - file.ext == "md"\nviews:\n  - type: tps-table\n    name: Transactions\n    lineFilterKey: financeId\n    order:\n      - date\n      - account\n      - amount\n      - currency\n      - subtype\n      - pending\n      - providerCategory\n      - categoryOverride\n      - tags\n      - merchant\n    sort:\n      - property: date\n        direction: DESC\n`;
}

export function holdingsBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - ${root ? `file.path.startsWith(${JSON.stringify(financePrefix(root, "Snapshots"))})` : 'type == "financeSnapshot"'}\nviews:\n  - type: tps-table\n    name: Holdings\n    lineFilterKey: securityId\n    order:\n      - account\n      - quantity\n      - price\n      - value\n      - costBasis\n      - currency\n      - asOf\n      - stale\n    sort:\n      - property: value\n        direction: DESC\n`;
}

export function rulesBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - kind == "financeRule"\n    - ${root ? `file.path.startsWith(${JSON.stringify(financePrefix(root, "Rules"))})` : 'financeRuleId != null'}\nviews:\n  - type: table\n    name: Categorization rules\n    order:\n      - enabled\n      - priority\n      - accountContains\n      - nameContains\n      - merchantContains\n      - minAmount\n      - maxAmount\n      - category\n      - tags\n      - file.name\n    sort:\n      - property: priority\n        direction: ASC\n`;
}

export function budgetsBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - kind == "financeBudget"\n    - ${root ? `file.path.startsWith(${JSON.stringify(financePrefix(root, "Budgets"))})` : 'financeBudgetId != null'}\nviews:\n  - type: table\n    name: Monthly budgets\n    order:\n      - category\n      - monthlyLimit\n      - file.name\n    sort:\n      - property: category\n        direction: ASC\n`;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function arrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function inlineField(line: string, key: string): string {
  const match = line.match(new RegExp(`\\[${key}::\\s*(\\[\\[[^\\]]+\\]\\]|[^\\]]*)\\]`));
  return match?.[1]?.trim() || "";
}

function wikilinkTarget(value: string): string {
  const match = value.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
  return match?.[1]?.trim() || value;
}

// Only owned fields participate; unrelated property/body edits remain safe to preserve.
function budgetRevision(fm: Record<string, unknown>): string {
  return JSON.stringify(["financeBudgetId", "title", "kind", "category", "monthlyLimit", "bucket", "currency", "accounts"].map(key => fm[key] ?? null));
}
