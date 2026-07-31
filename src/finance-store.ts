import { App, TFile, normalizePath } from "obsidian";
import type { DeviceState, FinanceAccount, FinanceBudget, FinanceHolding, FinanceRule, FinanceTransaction } from "./types";
import { normalizeTags } from "./classification";
import { providerIdentityKey } from "./identity";
import { appendTransactionIfMissing, removeTransactionContent, upsertTransactionContent } from "./transaction-content";

const GENERATED_START = "<!-- tps-finances:generated:start -->";
const GENERATED_END = "<!-- tps-finances:generated:end -->";
type TransactionRecord = { line: string; path: string; lineNumber: number };
type TransactionIndex = {
  recordsById: Map<string, TransactionRecord[]>;
  idsByPath: Map<string, Set<string>>;
  fileOrder: Map<string, number>;
  nextFileOrder: number;
};
export type TransactionTargetContext = { date: string; accountPath: string; line: string };

export class FinanceStore {
  private transactionIndex: TransactionIndex | null = null;

  constructor(
    private readonly app: App,
    private readonly rootFolder: string,
    private readonly processFrontmatter: (file: TFile, mutator: (frontmatter: Record<string, unknown>) => void) => Promise<unknown> = (file, mutator) => app.fileManager.processFrontMatter(file, mutator),
    private readonly resolveDailyNote: (isoDate: string) => Promise<TFile> = async () => { throw new Error("Daily-note storage is unavailable."); },
    private readonly resolveTransactionTarget: (context: TransactionTargetContext) => Promise<TFile> = (context) => resolveDailyNote(context.date),
  ) {}

  async ensureStructure(): Promise<void> {
    await this.ensureFolder(this.rootFolder);
    await this.ensureFolder(`${this.rootFolder}/Accounts`);
    await this.ensureFolder(`${this.rootFolder}/Snapshots`);
    await this.ensureFolder(`${this.rootFolder}/Rules`);
    await this.ensureFolder(`${this.rootFolder}/Budgets`);
    await this.ensureBaseFile(`${this.rootFolder}/Accounts.base`, accountsBaseBody(this.rootFolder));
    await this.ensureBaseFile(`${this.rootFolder}/Transactions.base`, transactionsBaseBody(this.rootFolder));
    await this.ensureBaseFile(`${this.rootFolder}/Holdings.base`, holdingsBaseBody(this.rootFolder));
    await this.ensureBaseFile(`${this.rootFolder}/Rules.base`, rulesBaseBody(this.rootFolder));
    await this.ensureBaseFile(`${this.rootFolder}/Budgets.base`, budgetsBaseBody(this.rootFolder));
  }

  async upsertAccounts(accounts: FinanceAccount[]): Promise<Map<string, string>> {
    const paths = new Map<string, string>();
    if (!accounts.length) return paths;
    const accountFilesById = this.indexAccountFiles(
      new Set(accounts.map((account) => account.financeAccountId)),
    );
    const refreshedAccountIds = new Set<string>();
    let vaultMayHaveChanged = false;
    for (const account of accounts) {
      let existing = accountFilesById.get(account.financeAccountId) || null;
      if (
        existing
        && vaultMayHaveChanged
        && !refreshedAccountIds.has(account.financeAccountId)
        && !this.isCurrentAccountFile(existing, account.financeAccountId)
      ) {
        accountFilesById.delete(account.financeAccountId);
        existing = null;
      }
      if (!existing && vaultMayHaveChanged) {
        existing = this.findAccountFile(account.financeAccountId);
      }
      const path = existing?.path || this.accountPath(account);
      const file = existing || await this.createAccountFile(path, account);
      await this.processFrontmatter(file, (frontmatter) => {
        frontmatter.title = accountDisplayName(account);
        frontmatter.kind = "account";
        frontmatter.institution = account.institutionName;
        frontmatter.accountType = account.type;
        frontmatter.accountSubtype = account.subtype;
        frontmatter.accountName = account.name;
        frontmatter.accountMask = account.mask;
        frontmatter.currency = account.currency;
        frontmatter.financeAccountId = account.financeAccountId;
      });
      vaultMayHaveChanged = true;
      accountFilesById.set(account.financeAccountId, file);
      refreshedAccountIds.add(account.financeAccountId);
      paths.set(account.financeAccountId, file.path);
    }
    return paths;
  }

  async applyTransactions(
    added: FinanceTransaction[],
    modified: FinanceTransaction[],
    removedProviderIds: string[],
    state: DeviceState,
    accountPaths: Map<string, string>,
  ): Promise<{ added: number; modified: number; removed: number }> {
    if (!added.length && !modified.length && !removedProviderIds.length) {
      return { added: 0, modified: 0, removed: 0 };
    }
    try {
      let removed = 0;
      for (const providerId of removedProviderIds) {
        const financeId = state.providerIdentityMap[providerIdentityKey("transaction", providerId)];
        if (financeId && await this.removeTransaction(financeId)) removed += 1;
      }
      for (const transaction of modified) await this.upsertTransaction(transaction, accountPaths);
      for (const transaction of added) await this.upsertTransaction(transaction, accountPaths);
      return { added: added.length, modified: modified.length, removed };
    } finally {
      this.transactionIndex = null;
    }
  }

  async replaceInvestmentTransactions(transactions: FinanceTransaction[], accountPaths: Map<string, string>): Promise<void> {
    if (!transactions.length) return;
    try {
      for (const transaction of transactions) await this.upsertTransaction(transaction, accountPaths);
    } finally {
      this.transactionIndex = null;
    }
  }

  async writeSnapshot(accounts: FinanceAccount[], holdings: FinanceHolding[], accountPaths: Map<string, string>, at: Date): Promise<string> {
    const date = formatDate(at);
    const path = normalizePath(`${this.rootFolder}/Snapshots/${date}.md`);
    const lines = [
      ...accounts.map((account) => balanceSnapshotLine(account, accountPaths.get(account.financeAccountId) || "")),
      ...holdings.map((holding) => holdingSnapshotLine(holding, accountPaths.get(holding.financeAccountId) || "", date)),
    ];
    const generated = `${GENERATED_START}\n${lines.join("\n")}\n${GENERATED_END}`;
    const existing = this.findFinanceLedgerFile(`${this.rootFolder}/Snapshots/`, "financeSnapshot", "date", date)
      || this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (content) => replaceGeneratedBlock(content, generated));
    } else {
      const frontmatter = `---\ntitle: Finance snapshot ${date}\nkind: ledger\ntype: financeSnapshot\ndate: ${date}\n---\n`;
      await this.app.vault.create(path, `${frontmatter}${generated}\n`);
    }
    return path;
  }

  async readTransactionRecords(): Promise<TransactionRecord[]> {
    const index = await this.ensureTransactionIndex();
    return [...index.recordsById.values()].flatMap((records) => records.slice(0, 1));
  }

  async migrateLegacyTransactionLedgers(): Promise<{ moved: number; skipped: number }> {
    const prefix = normalizePath(`${this.rootFolder}/Transactions/`);
    const legacyFiles = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix));
    let moved = 0;
    let skipped = 0;
    for (const legacyFile of legacyFiles) {
      const lines = (await this.app.vault.cachedRead(legacyFile)).split("\n");
      for (const line of lines.filter((candidate) => /^-\s/.test(candidate) && candidate.includes("[financeId::"))) {
        const financeId = inlineField(line, "financeId");
        const date = inlineField(line, "date");
        if (!financeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          skipped += 1;
          continue;
        }
        const dailyNote = await this.resolveDailyNote(date);
        await this.app.vault.process(dailyNote, (content) => appendTransactionIfMissing(content, financeId, line));
        await this.removeTransactionFromFile(legacyFile, financeId);
        moved += 1;
      }
      await this.removeEmptyLegacyLedger(legacyFile);
    }
    this.transactionIndex = null;
    return { moved, skipped };
  }

  async rerouteTransactions(): Promise<{ moved: number; skipped: number }> {
    const records = [...(await this.ensureTransactionIndex()).recordsById.values()].flatMap((items) => items.slice(0, 1));
    let moved = 0;
    let skipped = 0;
    for (const record of records) {
      const date = inlineField(record.line, "date");
      const accountPath = wikilinkTarget(inlineField(record.line, "account"));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !accountPath) {
        skipped += 1;
        continue;
      }
      const target = await this.resolveTransactionTarget({ date, accountPath, line: record.line });
      if (target.path === record.path) continue;
      const financeId = inlineField(record.line, "financeId");
      await this.app.vault.process(target, (content) => appendTransactionIfMissing(content, financeId, record.line));
      this.transactionIndex = null;
      const source = this.app.vault.getAbstractFileByPath(record.path);
      if (source instanceof TFile) await this.removeTransactionFromFile(source, financeId);
      moved += 1;
    }
    this.transactionIndex = null;
    return { moved, skipped };
  }

  readRules(): FinanceRule[] {
    const prefix = normalizePath(`${this.rootFolder}/Rules/`);
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix)).map((file) => {
      const value = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
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
    const prefix = normalizePath(`${this.rootFolder}/Budgets/`);
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix)).map((file) => {
      const value = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      return {
        id: String(value.financeBudgetId || file.path),
        name: String(value.title || file.basename),
        category: String(value.category || ""),
        monthlyLimit: finiteNumber(value.monthlyLimit) ?? 0,
      };
    }).filter((budget) => Boolean(budget.category) && budget.monthlyLimit > 0);
  }

  async createRule(rule: FinanceRule): Promise<TFile> {
    const path = this.uniquePath(normalizePath(`${this.rootFolder}/Rules/${safeName(rule.name)}.md`));
    const body = `---\ntitle: ${yamlString(rule.name)}\nkind: financeRule\nfinanceRuleId: ${yamlString(rule.id)}\nenabled: ${rule.enabled ? "true" : "false"}\npriority: ${rule.priority}\naccountContains: ${yamlString(rule.accountContains)}\nnameContains: ${yamlString(rule.nameContains)}\nmerchantContains: ${yamlString(rule.merchantContains)}\nminAmount: ${rule.minAmount == null ? "null" : decimal(rule.minAmount)}\nmaxAmount: ${rule.maxAmount == null ? "null" : decimal(rule.maxAmount)}\ncategory: ${yamlString(rule.category)}\ntags: ${JSON.stringify(normalizeTags(rule.tags))}\n---\n`;
    return this.app.vault.create(path, body);
  }

  async createBudget(budget: FinanceBudget): Promise<TFile> {
    const path = this.uniquePath(normalizePath(`${this.rootFolder}/Budgets/${safeName(budget.name)}.md`));
    const body = `---\ntitle: ${yamlString(budget.name)}\nkind: financeBudget\nfinanceBudgetId: ${yamlString(budget.id)}\ncategory: ${yamlString(budget.category)}\nmonthlyLimit: ${decimal(budget.monthlyLimit)}\n---\n`;
    return this.app.vault.create(path, body);
  }

  async updateTransactionMetadata(financeId: string, categoryOverride: string, tags: string[]): Promise<boolean> {
    const records = (await this.ensureTransactionIndex()).recordsById.get(financeId) || [];
    if (!records.length) return false;
    for (const path of new Set(records.map((record) => record.path))) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      await this.app.vault.process(file, (content) => content.split("\n").map((line) => line.includes(`[financeId:: ${financeId}]`)
        ? setInlineField(setInlineField(line, "categoryOverride", categoryOverride), "tags", normalizeTags(tags).join(", "))
        : line).join("\n"));
    }
    this.transactionIndex = null;
    return true;
  }

  private async upsertTransaction(transaction: FinanceTransaction, accountPaths: Map<string, string>): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)) return;
    const existingRecords = await this.refreshTransactionRecords(transaction.financeId);
    const localMetadata = this.transactionMetadata(existingRecords);
    const line = transactionLine(transaction, accountPaths.get(transaction.financeAccountId) || "", localMetadata);
    const target = await this.resolveTransactionTarget({
      date: transaction.date,
      accountPath: accountPaths.get(transaction.financeAccountId)?.replace(/\.md$/i, "") || "",
      line,
    });
    const targetContent = await this.app.vault.process(
      target,
      (content) => upsertTransactionContent(
        content,
        transaction.financeId,
        transactionLine(
          transaction,
          accountPaths.get(transaction.financeAccountId) || "",
          this.transactionMetadataForTarget(
            transaction.financeId,
            target.path,
            content,
            existingRecords,
            localMetadata,
          ),
        ),
      ),
    );
    this.updateTransactionFileIndex(target.path, targetContent);
    for (const path of new Set(existingRecords.map((record) => record.path).filter((path) => path !== target.path))) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.removeTransactionFromFile(file, transaction.financeId);
      else this.transactionIndex = null;
    }
  }

  private transactionMetadata(records: TransactionRecord[]): { categoryOverride: string; tags: string[] } {
    const line = records[0]?.line;
    if (line) return { categoryOverride: inlineField(line, "categoryOverride"), tags: arrayValue(inlineField(line, "tags")) };
    return { categoryOverride: "", tags: [] };
  }

  private async removeTransaction(financeId: string): Promise<boolean> {
    const records = await this.refreshTransactionRecords(financeId);
    if (!records.length) return false;
    for (const path of new Set(records.map((record) => record.path))) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.removeTransactionFromFile(file, financeId);
      else this.transactionIndex = null;
    }
    return true;
  }

  private async refreshTransactionRecords(financeId: string): Promise<TransactionRecord[]> {
    const index = await this.ensureTransactionIndex();
    const records = index.recordsById.get(financeId) || [];
    if (!records.length) return records;
    for (const path of new Set(records.map((record) => record.path))) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        this.transactionIndex = null;
        return (await this.ensureTransactionIndex()).recordsById.get(financeId) || [];
      }
      const content = await this.app.vault.cachedRead(file);
      if (file.path !== path || this.app.vault.getAbstractFileByPath(path) !== file) {
        this.transactionIndex = null;
        return (await this.ensureTransactionIndex()).recordsById.get(financeId) || [];
      }
      this.indexTransactionFile(index, path, content);
      if (!(index.recordsById.get(financeId) || []).some((record) => record.path === path)) {
        this.transactionIndex = null;
        return (await this.ensureTransactionIndex()).recordsById.get(financeId) || [];
      }
    }
    return index.recordsById.get(financeId) || [];
  }

  private transactionMetadataForTarget(
    financeId: string,
    targetPath: string,
    content: string,
    existingRecords: TransactionRecord[],
    fallback: { categoryOverride: string; tags: string[] },
  ): { categoryOverride: string; tags: string[] } {
    const line = content.split("\n").find((candidate) => (
      /^-\s/.test(candidate)
      && candidate.includes("[financeId::")
      && inlineField(candidate, "financeId") === financeId
    ));
    if (!line) return fallback;
    const firstExisting = existingRecords[0];
    const targetOrder = this.transactionIndex?.fileOrder.get(targetPath) ?? Number.MAX_SAFE_INTEGER;
    const existingOrder = firstExisting
      ? this.transactionIndex?.fileOrder.get(firstExisting.path) ?? Number.MAX_SAFE_INTEGER
      : Number.MAX_SAFE_INTEGER;
    return !firstExisting || firstExisting.path === targetPath || targetOrder < existingOrder
      ? { categoryOverride: inlineField(line, "categoryOverride"), tags: arrayValue(inlineField(line, "tags")) }
      : fallback;
  }

  private async ensureTransactionIndex(): Promise<TransactionIndex> {
    if (this.transactionIndex) return this.transactionIndex;
    const files = this.app.vault.getMarkdownFiles();
    const index: TransactionIndex = {
      recordsById: new Map(),
      idsByPath: new Map(),
      fileOrder: new Map(),
      nextFileOrder: files.length,
    };
    for (const [order, file] of files.entries()) {
      const pathBeforeRead = file.path;
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
    }
    this.transactionIndex = index;
    return index;
  }

  private async removeTransactionFromFile(file: TFile, financeId: string): Promise<void> {
    const content = await this.app.vault.process(
      file,
      (current) => removeTransactionContent(current, financeId),
    );
    this.updateTransactionFileIndex(file.path, content);
  }

  private updateTransactionFileIndex(path: string, content: string): void {
    if (this.transactionIndex) this.indexTransactionFile(this.transactionIndex, path, content);
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

  private async removeEmptyLegacyLedger(file: TFile): Promise<void> {
    const content = await this.app.vault.cachedRead(file);
    const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    if (!body && String(frontmatter.type || "") === "financeTransactions") await this.app.vault.delete(file);
  }

  private findAccountFile(financeAccountId: string): TFile | null {
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(normalizePath(`${this.rootFolder}/Accounts/`))) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (String(frontmatter?.financeAccountId || "") === financeAccountId) return file;
    }
    return null;
  }

  private indexAccountFiles(
    requestedAccountIds: ReadonlySet<string>,
  ): Map<string, TFile> {
    const filesById = new Map<string, TFile>();
    const prefix = normalizePath(`${this.rootFolder}/Accounts/`);
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const financeAccountId = String(frontmatter?.financeAccountId || "");
      if (
        requestedAccountIds.has(financeAccountId)
        && !filesById.has(financeAccountId)
      ) {
        filesById.set(financeAccountId, file);
        if (filesById.size === requestedAccountIds.size) break;
      }
    }
    return filesById;
  }

  private isCurrentAccountFile(
    file: TFile,
    financeAccountId: string,
  ): boolean {
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) return false;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return String(frontmatter?.financeAccountId || "") === financeAccountId;
  }

  private findFinanceLedgerFile(folder: string, type: string, key: string, value: string): TFile | null {
    const prefix = normalizePath(folder);
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      if (String(frontmatter.type || "") === type && String(frontmatter[key] || "") === value) return file;
    }
    return null;
  }

  private accountPath(account: FinanceAccount): string {
    return normalizePath(`${this.rootFolder}/Accounts/${safeName(accountDisplayName(account))}.md`);
  }

  private async createAccountFile(path: string, account: FinanceAccount): Promise<TFile> {
    const uniquePath = this.uniquePath(path);
    return this.app.vault.create(uniquePath, `---\ntitle: ${yamlString(accountDisplayName(account))}\nkind: account\n---\n`);
  }

  private uniquePath(path: string): string {
    if (!this.app.vault.getAbstractFileByPath(path)) return path;
    const base = path.replace(/\.md$/i, "");
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(`${base} ${index}.md`)) index += 1;
    return `${base} ${index}.md`;
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!this.app.vault.getAbstractFileByPath(normalized)) await this.app.vault.createFolder(normalized);
  }

  private async ensureBaseFile(path: string, body: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!this.app.vault.getAbstractFileByPath(normalized)) await this.app.vault.create(normalized, body);
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
  if (transaction.securityId) fields.push(`[securityId:: ${inlineValue(transaction.securityId)}]`);
  if (transaction.quantity != null) fields.push(`[quantity:: ${decimal(transaction.quantity)}]`);
  if (transaction.price != null) fields.push(`[price:: ${decimal(transaction.price)}]`);
  if (transaction.fees != null) fields.push(`[fees:: ${decimal(transaction.fees)}]`);
  return `- ${inlineValue(transaction.name)} ${fields.join(" ")}`;
}

function balanceSnapshotLine(account: FinanceAccount, accountPath: string): string {
  const current = account.current == null ? "" : ` [balance:: ${decimal(account.current)}]`;
  const available = account.available == null ? "" : ` [available:: ${decimal(account.available)}]`;
  return `- ${inlineValue(accountDisplayName(account))} [type:: balanceSnapshot] [account:: [[${accountPath.replace(/\.md$/i, "")}]]]${current}${available} [currency:: ${inlineValue(account.currency)}]`;
}

function holdingSnapshotLine(holding: FinanceHolding, accountPath: string, snapshotDate: string): string {
  const label = holding.ticker || holding.name;
  const costBasis = holding.costBasis == null ? "" : ` [costBasis:: ${decimal(holding.costBasis)}]`;
  const stale = holding.stale ? " [stale:: true]" : "";
  return `- ${inlineValue(label)} [type:: holdingSnapshot] [account:: [[${accountPath.replace(/\.md$/i, "")}]]] [securityId:: ${inlineValue(holding.securityId)}] [quantity:: ${decimal(holding.quantity)}] [price:: ${decimal(holding.price)}] [value:: ${decimal(holding.value)}]${costBasis} [currency:: ${inlineValue(holding.currency)}] [asOf:: ${inlineValue(holding.asOf || snapshotDate)}]${stale}`;
}

function accountDisplayName(account: FinanceAccount): string {
  const suffix = account.mask ? ` •${account.mask}` : "";
  return `${account.institutionName} ${account.name}${suffix}`.trim();
}

function safeName(value: string): string {
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

function formatDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function replaceGeneratedBlock(content: string, generated: string): string {
  const start = content.indexOf(GENERATED_START);
  const end = content.indexOf(GENERATED_END);
  if (start >= 0 && end >= start) return `${content.slice(0, start)}${generated}${content.slice(end + GENERATED_END.length)}`;
  return `${content.replace(/\s+$/, "")}\n${generated}\n`;
}

function accountsBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - kind == "account"\n    - file.path.startsWith("${root}/Accounts/")\nviews:\n  - type: table\n    name: Accounts\n    order:\n      - institution\n      - accountName\n      - accountType\n      - accountSubtype\n      - accountMask\n      - currency\n      - file.name\n    sort:\n      - property: institution\n        direction: ASC\n      - property: accountName\n        direction: ASC\n`;
}

function transactionsBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - file.ext == "md"\nviews:\n  - type: tps-table\n    name: Transactions\n    lineFilterKey: financeId\n    order:\n      - date\n      - account\n      - amount\n      - currency\n      - subtype\n      - pending\n      - providerCategory\n      - categoryOverride\n      - tags\n      - merchant\n    sort:\n      - property: date\n        direction: DESC\n`;
}

function holdingsBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - file.path.startsWith("${root}/Snapshots/")\nviews:\n  - type: tps-table\n    name: Holdings\n    lineFilterKey: securityId\n    order:\n      - account\n      - quantity\n      - price\n      - value\n      - costBasis\n      - currency\n      - asOf\n      - stale\n    sort:\n      - property: value\n        direction: DESC\n`;
}

function rulesBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - kind == "financeRule"\n    - file.path.startsWith("${root}/Rules/")\nviews:\n  - type: table\n    name: Categorization rules\n    order:\n      - enabled\n      - priority\n      - accountContains\n      - nameContains\n      - merchantContains\n      - minAmount\n      - maxAmount\n      - category\n      - tags\n      - file.name\n    sort:\n      - property: priority\n        direction: ASC\n`;
}

function budgetsBaseBody(root: string): string {
  return `model:\n  version: 1\n  kind: Table\n  columns: []\npluginVersion: 1.0.0\nfilters:\n  and:\n    - kind == "financeBudget"\n    - file.path.startsWith("${root}/Budgets/")\nviews:\n  - type: table\n    name: Monthly budgets\n    order:\n      - category\n      - monthlyLimit\n      - file.name\n    sort:\n      - property: category\n        direction: ASC\n`;
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

function setInlineField(line: string, key: string, value: string): string {
  const pattern = new RegExp(`\\s*\\[${key}::\\s*[^\\]]*\\]`, "g");
  const without = line.replace(pattern, "");
  return value ? `${without} [${key}:: ${inlineValue(value)}]` : without;
}
