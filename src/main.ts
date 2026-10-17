import { FinanceConnectionSettings } from "./connection-settings";
import { applyPropertyMigration, previewPropertyMigration, normalizePropertyMigration, previewGeneratedBaseClassificationChange, propertyChanges, remapGeneratedBaseIdentities } from "./property-migration";
import { financeProperties, FinanceProperties, normalizePropertyNames, financeIdentityKey } from "./finance-properties";
import { applyFinanceIdentityMigration, previewFinanceIdentityMigration, FinanceIdentityMigrationPreview } from "./identity-migration";
import { budgetBucket, budgetCurrency, type BudgetBucket } from "./flex-budget";
import type { FinanceBudget } from "./types";
import { financePath, financePrefix, normalizeFinanceFolder } from "./finance-paths";
import { Notice, Platform, Plugin, TAbstractFile, TFile, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import { DashboardModel, DashboardTransaction, TPSFinancesView, TPS_FINANCES_VIEW_TYPE } from "./dashboard-view";
import { calculateMonthlyBudgetProgress, normalizeTags, prepareTransactionClassifier } from "./classification";
import { AtomicFinanceStore } from "./atomic-finance-store";
import { TransactionTitleModal } from "./transaction-title-modal";
import { auditLegacyTransactionMarkers, type TransactionReadSource } from "./finance-store";
import { FinanceBudgetModal, FinanceRuleModal, TransactionClassificationModal } from "./finance-modals";
import { ManualFinanceStore, applyManualCashBalances } from "./manual-finance";
import { ManualAccountModal, CashTransactionModal, AssetValueModal } from "./finance-modals";
import { createLocalId } from "./identity";
import * as logger from "./logger";
import { TPSFinancesSettingTab } from "./settings";
import { CoalescedSnapshotWriter, reconcilePersistedSnapshot } from "./settings-persistence";
import { DashboardFileSnapshot } from "./dashboard-file-snapshot";
import {
  DEFAULT_SETTINGS,
  DeviceItemState,
  DeviceState,
  FinanceAccount,
  FinanceHolding,
  PlaidSetupStatus,
  TPSFinancesSettings,
} from "./types";
type StoredFinanceSnapshot = Readonly<{
  date: string;
  lines: readonly string[];
}>;
type AccountLabel = {
  display: string;
  search: string;
};

export default class TPSFinancesPlugin extends Plugin {
  settings: TPSFinancesSettings = { ...DEFAULT_SETTINGS };
  private syncing = false;
  private unregisterGcmAction: (() => void) | null = null;
  private registeredGcmApi: any = null;
  private settingsWriter: CoalescedSnapshotWriter<TPSFinancesSettings> | null = null;

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.settingsWriter = new CoalescedSnapshotWriter({
      initialSnapshot: this.settings,
      readLatest: () => this.loadData(),
      writeMerged: (value) => this.saveData(value),
      normalize: normalizeSettings,
      reconcile: (requested, persisted) => {
        this.settings = reconcilePersistedSnapshot(this.settings, requested, persisted);
      },
    });
    logger.setLoggingEnabled(this.settings.enableLogging);
    this.registerView(TPS_FINANCES_VIEW_TYPE, (leaf) => new TPSFinancesView(leaf, this));
    const financeSettingsTab = new TPSFinancesSettingTab(this.app, this);
    this.addSettingTab(financeSettingsTab);
    this.addRibbonIcon("landmark", "Open TPS Finances", () => void this.openDashboard());
    this.addCommand({ id: "open-finances", name: "Open finances", callback: () => void this.openDashboard() });
    this.addCommand({ id: "add-categorization-rule", name: "Add categorization rule", callback: () => this.addCategorizationRule() });
    this.addCommand({ id: "open-budget", name: "Open budget", callback: () => void this.openDashboard("budget") });
    this.addCommand({ id: "add-monthly-budget", name: "Add monthly budget", callback: () => this.addMonthlyBudget() });
    this.addCommand({ id: "add-cash-account", name: "Add cash account", callback: () => this.addManualAccount("cash") });
    this.addCommand({ id: "add-resale-asset", name: "Add resale asset", callback: () => this.addManualAccount("asset") });
    this.addCommand({ id: "add-cash-transaction", name: "Log cash transaction", callback: () => void this.runUserAction("Cash", "command", () => this.addCashTransaction()) });
    this.addCommand({ id: "review-transaction-titles", name: "Review transaction titles", callback: () => void this.runUserAction("Titles", "command", () => this.reviewTransactionTitles()) });
    this.addCommand({ id: "review-transaction-records", name: "Review transaction records", callback: () => void this.runUserAction("Titles", "records-command", () => this.reviewTransactionTitles(true)) });
    this.registerEvent((this.app.workspace as any).on("tps:gcm-api-changed", (event: any) => {
      if (event?.sourcePluginId !== "tps-global-context-menu"
        || (event.available !== true && event.available !== false)
        || (event.available && !event.api)) return;
      const identityReady = event.available && event.api !== this.registeredGcmApi
        && typeof event.api.nativeRecords?.getStorageProfile === "function";
      this.registerGcmIntegration(event.available ? event.api : null);
      if (identityReady && this.app.workspace.getLeavesOfType(TPS_FINANCES_VIEW_TYPE).length) void this.refreshDashboard();
    }));
    this.registerGcmIntegration();
    this.registerEvent(this.app.metadataCache.on("changed", (file, data) => {
      if (!this.syncing && !this.settings.propertyMigration) void this.refreshDashboard({ file, data });
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (!this.syncing && !this.settings.propertyMigration) void this.refreshDashboard({ file, deleted: true });
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!this.syncing && !this.settings.propertyMigration) void this.refreshDashboard({ file, oldPath });
    }));
    (this as any).api = {
      connectionSettings: { version: 1, render: (parent: HTMLElement) => {
        const panel = new FinanceConnectionSettings(this.app, this, parent);
        panel.render();
        return () => panel.dispose();
      } },
      openConnectionSettings: () => this.openConnectionSettings(),
      openDashboard: () => this.openDashboard(),
      getDashboardModel: () => this.getDashboardModel(),
      renderHomeSummary: (container: HTMLElement) => this.renderHomeSummary(container),
      getTransactionsBasePath: () => this.getTransactionsBasePath(),
      getDailyNotePathForIsoDate: (isoDate: string) => this.getDailyNotePathForIsoDate(isoDate),
      classificationBases: { version: 1, preview: (change: {recordKind: string;
        from: {tag: string} | {parentKind: string; key: string; value: string} | {kindList: {key: string; value: string}} | {scalar: {key: string; value: string}};
        to: {tag: string} | {parentKind: string; key: string; value: string} | {kindList: {key: string; value: string}} | {scalar: {key: string; value: string}}}) =>
        previewGeneratedBaseClassificationChange(this.app, this.settings.financeFolder, change),
        settingsSignature: () => JSON.stringify([this.settings.financeFolder, this.settings.propertyNames]) },
    };
    logger.flow("Lifecycle", "load", {
      financeFolder: this.settings.financeFolder,
    });
  }

  async onunload(): Promise<void> {
    this.registerGcmIntegration(null);
    this.app.workspace.detachLeavesOfType(TPS_FINANCES_VIEW_TYPE);
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    logger.setLoggingEnabled(this.settings.enableLogging);
    if (!this.settingsWriter) throw new Error("TPS Finances settings persistence is not ready.");
    await this.settingsWriter.save(this.settings);
  }

  private async reconcileStoredTransactionMode(): Promise<void> {
    // The settings writer shares one promise across coalesced saves. A later
    // setting can fail after this mode has already reached disk.
    let persisted: TPSFinancesSettings;
    try { persisted = normalizeSettings(await this.loadData()); }
    catch (error) {
      this.settings.legacyTransactionDiscovery = "discover";
      logger.failure("Storage", "transaction-mode-readback-failed", error);
      throw new Error("Could not verify saved finance storage settings. Reload TPS Finances before using finance records.");
    }
    this.settings.recordMode = persisted.recordMode;
    this.settings.legacyTransactionDiscovery = persisted.legacyTransactionDiscovery;
  }

  private assertPropertyMigrationComplete(): void {
    if (this.settings.propertyMigration) throw new Error("Resume the property migration in Finances → Properties before using finance records.");
  }

  legacyReviewRequired(): boolean {
    return this.settings.recordMode === "atomic-line" || this.settings.legacyTransactionDiscovery === "discover";
  }

  async previewFinanceIdentityConsolidation(): Promise<FinanceIdentityMigrationPreview> {
    this.assertPropertyMigrationComplete();
    if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
    return previewFinanceIdentityMigration(this.app);
  }

  async consolidateFinanceIdentities(preview: FinanceIdentityMigrationPreview): Promise<number> {
    this.assertPropertyMigrationComplete();
    if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
    this.syncing = true;
    try {
      const updated = await applyFinanceIdentityMigration(this.app, preview);
      await remapGeneratedBaseIdentities(this.app, this.settings.financeFolder, preview.bases);
      logger.flow("Properties", "identities-consolidated", { updated, inspected: preview.inspected });
      await this.refreshDashboard();
      return updated;
    } finally { this.syncing = false; }
  }

  private assertLegacyReviewComplete(): void {
    if (this.legacyReviewRequired()) throw new Error("Review older inline transactions in Finances → Data & storage before adding or syncing transactions.");
  }

  async changePropertyNames(from: FinanceProperties, to: FinanceProperties, migrate: boolean): Promise<void> {
    this.assertPropertyMigrationComplete();
    if (this.syncing) throw new Error("Wait for the current finance sync to finish.");
    if (JSON.stringify(normalizePropertyNames(this.settings.propertyNames)) !== JSON.stringify(from.names)) throw new Error("Property settings changed. Reopen Properties and try again.");
    to.assertIdentityKey(financeIdentityKey(this.app));
    this.syncing = true;
    try {
      if (!propertyChanges(from, to).length) {
        this.settings.propertyNames = to.names;
        try { await this.saveSettings(); }
        catch (error) {
          try { this.settings.propertyNames = normalizeSettings(await this.loadData()).propertyNames; }
          catch { this.settings.propertyNames = from.names; throw new Error("Could not verify saved finance property names. Reload TPS Finances before using finance records."); }
          throw error;
        }
        logger.flow("Properties", "names-saved", { migrated: 0 });
        return;
      }
      const {journal, conflicts} = await previewPropertyMigration(this.app, from, to, this.settings.financeFolder);
      if (migrate && conflicts.length) throw new Error(conflicts[0]);
      if (!migrate) journal.notes = [];
      this.settings.propertyMigration = journal;
      try { await this.saveSettings(); }
      catch (error) { this.settings.propertyMigration = null; throw error; }
      await this.finishPropertyMigration();
    } finally { this.syncing = false; }
    await this.refreshDashboard();
  }

  async resumePropertyMigration(): Promise<void> {
    if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
    this.syncing = true;
    try { await this.finishPropertyMigration(); }
    finally { this.syncing = false; }
    await this.refreshDashboard();
  }

  private async finishPropertyMigration(): Promise<void> {
    const journal = this.settings.propertyMigration;
    if (!journal) return;
    new FinanceProperties(journal.to).assertIdentityKey(financeIdentityKey(this.app));
    await applyPropertyMigration(this.app, journal);
    this.settings.propertyNames = journal.to;
    this.settings.propertyMigration = null;
    try { await this.saveSettings(); }
    catch (error) {
      this.settings.propertyNames = journal.from;
      this.settings.propertyMigration = journal;
      throw error;
    }
    logger.flow("Properties", "names-saved", {migrated: journal.notes.length});
  }

  async setFinanceFolder(value: string): Promise<void> {
    this.assertPropertyMigrationComplete();
    if (this.syncing) throw new Error("Wait for the current finance sync to finish before changing its folder.");
    this.settings.financeFolder = normalizeFinanceFolder(value);
    await this.saveSettings();
    await this.refreshDashboard();
    logger.flow("Storage", "destination-saved", { root: this.settings.financeFolder === "" });
  }

  openConnectionSettings(): void {
    new Notice('Bank and Wallet importing are retired in this plugin. Configure imports in TishOS; existing notes remain available.');
  }

  async openDashboard(page?: "budget"): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(TPS_FINANCES_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: TPS_FINANCES_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (page === "budget" && leaf.view instanceof TPSFinancesView) await leaf.view.showBudget();
  }

  async getDashboardModel(sourcePaths?: Set<string>, source: TransactionReadSource = "source"): Promise<DashboardModel> {
    const files = new DashboardFileSnapshot(this.app, sourcePaths);
    const snapshot = await this.readLatestSnapshotDocument(sourcePaths, files);
    const accountLabels = new Map<string, AccountLabel>();
    const accounts = this.readAccountsFromVault(snapshot, accountLabels, sourcePaths, files);
    const holdings = this.parseSnapshotHoldings(snapshot, accounts, sourcePaths, files);
    const store = this.createStore();
    const transactionRecords = await store.readTransactionRecords(source, files);
    if (sourcePaths) for (const record of transactionRecords) sourcePaths.add(record.path);
    const rules = store.readRules(sourcePaths, files);
    const classifyForDashboard = prepareTransactionClassifier(rules);
    const transactions: DashboardTransaction[] = [];
    for (const record of transactionRecords) {
      const transaction = parseDashboardTransaction(record.line, record.path, record.lineNumber);
      if (!transaction) continue;
      const accountLabel = accountLabels.get(transaction.accountPath);
      const resolved = accountLabel ? { ...transaction, account: accountLabel.display, accountSearchText: accountLabel.search } : transaction;
      const classification = classifyForDashboard(resolved);
      const row = { ...resolved, category: classification.category, tags: classification.tags, categorySource: classification.source, ruleId: classification.ruleId };
      if (record.sourceFile) Object.defineProperty(row, "sourceFile", { value: record.sourceFile });
      transactions.push(row);
    }
    transactions.sort((left, right) => right.date.localeCompare(left.date));
    applyManualCashBalances(accounts, transactions);
    const month = localDate(new Date()).slice(0, 7);
    const budgetEntries = await store.readBudgetEntries(sourcePaths, source, files);
    const budgets = calculateMonthlyBudgetProgress(budgetEntries.filter(budget=>budgetBucket(budget)==="category" && budgetCurrency(budget)==="USD"), transactions, month);
    return {
      accounts,
      holdings,
      transactions,
      budgets,
      budgetEntries,
      legacyReviewRequired: this.legacyReviewRequired(),
    };
  }

  addManualAccount(kind: "cash" | "asset"): void {
    new ManualAccountModal(this.app, kind, async input => {
      if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
      const file = await new ManualFinanceStore(this.app, this.settings.financeFolder).createAccount(input);
      logger.flow("Manual", "account-created", {kind});
      await this.app.workspace.getLeaf("tab").openFile(file);
      await this.refreshDashboard();
    }).open();
  }

  async addCashTransaction(): Promise<void> {
    this.assertLegacyReviewComplete();
    financeProperties(this.app);
    // The form needs account choices, not transaction balances or a dashboard.
    const accounts = this.readAccountsFromVault(await this.readLatestSnapshotDocument());
    if (!accounts.some(a => a.manual && a.type === "depository" && a.subtype === "cash")) {
      new Notice("Create a cash account first using Add → Cash account.");
      return;
    }
    new CashTransactionModal(this.app, accounts, async input => {
      if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
      this.assertLegacyReviewComplete();
      await new ManualFinanceStore(this.app, this.settings.financeFolder).createCashEntry(input);
      logger.flow("Manual", "cash-entry-created", {kind: input.kind});
      new Notice("Cash transaction recorded.");
      await this.refreshDashboard();
    }).open();
  }

  updateAssetValue(account: FinanceAccount): void {
    new AssetValueModal(this.app, account, async (value, date) => {
      if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
      await new ManualFinanceStore(this.app, this.settings.financeFolder).updateValue(account.path || "", value, date);
      logger.flow("Manual", "asset-value-updated");
      await this.refreshDashboard();
    }).open();
  }

  addCategorizationRule(): void {
    new FinanceRuleModal(this.app, async (input) => {
      if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
      const store = this.createStore();
      await store.ensureStructure();
      await store.createRule({ ...input, id: createLocalId("finance-rule") });
      logger.flow("Classification", "rule-created", { hasCategory: Boolean(input.category), tagCount: input.tags.length, priority: input.priority });
      new Notice("Categorization rule created. Existing transactions were re-evaluated.");
      await this.refreshDashboard();
    }).open();
  }

  addMonthlyBudget(bucket: BudgetBucket = "income", currency = "USD"): void {
    void this.openBudgetEditor({id:createLocalId("finance-budget"),name:bucket==="flex"?"Flexible spending":"",category:"",monthlyLimit:NaN,bucket,currency});
  }

  editMonthlyBudget(budget: FinanceBudget): void { void this.openBudgetEditor(budget); }

  private budgetSave: Promise<unknown> = Promise.resolve();
  private async openBudgetEditor(budget: FinanceBudget): Promise<void> {
    try {
      const model = await this.getDashboardModel();
      const current = budget.sourcePath
        ? model.budgetEntries?.find(entry => entry.sourcePath === budget.sourcePath && entry.id === budget.id)
        : budget;
      if (!current) throw new Error("The budget note changed or was removed. Reopen the dashboard and try again.");
      const categories=Array.from(new Set(model.transactions.map(transaction=>transaction.category).filter(Boolean))).sort();
      new FinanceBudgetModal(this.app,current,model.accounts,categories,async input=>{
        const save=this.budgetSave.catch(()=>{}).then(async()=>{
          if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
          const store=this.createStore();
          await store.ensureStructure();
          await store.saveBudgetEntry(input,current.sourcePath?current:undefined);
          logger.flow("Budget",current.sourcePath?"updated":"created",{bucket:budgetBucket(input),currency:budgetCurrency(input)});
        });
        this.budgetSave=save;
        await save;
        await this.refreshDashboard();
      }).open();
    } catch(error) { new Notice(`Could not open budget: ${error instanceof Error?error.message:String(error)}`); }
  }

  editTransactionClassification(transaction: DashboardTransaction): void {
    const financeId = transaction.financeId;
    const renderedFile = transaction.sourceFile;
    const sourcePath = transaction.sourcePath;
    const selectedFile = renderedFile instanceof TFile && sourcePath ? this.app.vault.getAbstractFileByPath(sourcePath) : null;
    const renderedTarget = renderedFile instanceof TFile && sourcePath
      ? { path: sourcePath, file: selectedFile === renderedFile ? renderedFile : null,
          type: transaction.type, categoryOverride: transaction.categoryOverride || "", tags: [...(transaction.manualTags || [])] }
      : null;
    new TransactionClassificationModal(this.app, transaction, async (category, tags) => {
      if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
      const store = this.createStore();
      const updated = renderedTarget
        ? await store.updateTransactionMetadata(financeId, category, tags, renderedTarget)
        : await store.updateTransactionMetadata(financeId, category, tags);
      if (!updated) throw new Error("The transaction could not be found.");
      logger.flow("Classification", "transaction-updated", { source: category ? "manual" : "automatic", tagCount: tags.length });
      new Notice(category || tags.length ? "Transaction classification saved." : "Transaction returned to automatic classification.");
      await this.refreshDashboard();
    }).open();
  }

  private getTransactionsBasePath(): string {
    const alternate = financePath(this.settings.financeFolder, "", "Transactions (Atomic notes).base");
    return this.app.vault.getAbstractFileByPath(alternate)
      ? alternate
      : financePath(this.settings.financeFolder, "", "Transactions.base");
  }

  async openFinanceBase(name: "Rules" | "Budgets" | "Transactions"): Promise<void> {
    const path = name === "Transactions" ? this.getTransactionsBasePath() : financePath(this.settings.financeFolder, "", `${name}.base`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`${name}.base could not be found.`);
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
  }

  async renderHomeSummary(container: HTMLElement): Promise<void> {
    const model = await this.getDashboardModel(undefined, "metadata");
    container.empty();
    container.addClass("tps-finances-home-summary");
    if (!model.accounts.length) {
      container.createDiv({ cls: "tps-finances-home-empty", text: "No accounts found. Add a manual account or import accounts with TishOS." });
    } else {
      const investmentAccountIds = new Set(model.holdings.map((holding) => holding.financeAccountId));
      const cash = model.accounts.filter((account) => !investmentAccountIds.has(account.financeAccountId)).reduce((sum, account) => sum + (account.current || 0), 0);
      const investments = model.holdings.reduce((sum, holding) => sum + holding.value, 0);
      const month = localDate(new Date()).slice(0, 7);
      const spending = -model.transactions.filter((transaction) => transaction.date.startsWith(month) && transaction.amount < 0 && isSpendingTransaction(transaction)).reduce((sum, transaction) => sum + transaction.amount, 0);
      const metrics = container.createDiv({ cls: "tps-finances-home-metrics" });
      homeMetric(metrics, "Net worth", cash + investments);
      homeMetric(metrics, "Investments", investments);
      homeMetric(metrics, "Spent this month", spending);
      if (model.budgets.length) homeMetric(metrics, "Budget remaining", model.budgets.reduce((sum, budget) => sum + budget.monthlyLimit - budget.spent, 0));
      const staleHoldings = model.holdings.filter((holding) => holding.stale);
      if (staleHoldings.length) {
        const oldest = staleHoldings.map((holding) => holding.asOf || "").filter(Boolean).sort()[0] || "an earlier sync";
        container.createDiv({ cls: "tps-finances-home-empty", text: `Investment values include ${staleHoldings.length} last-known holding${staleHoldings.length === 1 ? "" : "s"} as of ${oldest}.` });
      }
    }
    const open = container.createEl("button", { cls: "tps-finances-home-open", attr: { type: "button" } });
    const icon = open.createSpan();
    setIcon(icon, "arrow-up-right");
    open.createSpan({ text: "Open finances" });
    open.addEventListener("click", () => this.runUserAction("Open", "home", () => this.openDashboard()));
  }

  async openTransactionSource(transaction: DashboardTransaction): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(transaction.sourcePath);
    if (!(file instanceof TFile)) throw new Error("The transaction ledger could not be found.");
    const gcmApi = this.getGcmApi();
    const leaf = gcmApi?.openFileInLeaf
      ? await gcmApi.openFileInLeaf(file, false, () => this.app.workspace.getLeaf(false), { revealLeaf: true, active: true, reuseLeafIfNoExisting: true })
      : this.app.workspace.getLeaf(false);
    if (!gcmApi?.openFileInLeaf) await leaf.openFile(file);
  }

  private async runUserAction(scope: string, trigger: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      new Notice(`TPS Finances ${scope.toLocaleLowerCase()} failed: ${userFacingError(error)}`, 12000);
      logger.failure(scope, "user-action-failed", error, { trigger });
    }
  }

  private createStore(): AtomicFinanceStore {
    this.assertPropertyMigrationComplete();
    return new AtomicFinanceStore(this.app, this.settings.financeFolder);
  }

  async reviewTransactionTitles(includeEmptyProperties = false): Promise<void> {
    const store = new AtomicFinanceStore(this.app, this.settings.financeFolder);
    new TransactionTitleModal(this.app, await store.reviewTransactionTitles(includeEmptyProperties), store, () => this.refreshDashboard(), includeEmptyProperties).open();
  }

  async reviewLegacyTransactionMarkers(): Promise<{ markers: number; firstPath: string }> {
    this.assertPropertyMigrationComplete();
    if (this.syncing) throw new Error("Wait for the current finance operation to finish.");
    this.syncing = true;
    try {
      const audit = await auditLegacyTransactionMarkers(this.app);
      logger.flow("Storage", "legacy-inline-reviewed", { markers: audit.markers, clear: audit.markers === 0 });
      if (audit.markers === 0 && this.legacyReviewRequired()) {
        this.settings.recordMode = "atomic-note";
        this.settings.legacyTransactionDiscovery = "atomic-only";
        try { await this.saveSettings(); }
        catch (error) {
          await this.reconcileStoredTransactionMode();
          if (!this.legacyReviewRequired()) await this.refreshDashboard();
          throw error;
        }
        await this.refreshDashboard();
      }
      return audit;
    } finally { this.syncing = false; }
  }

  async migrateAtomicTransactions(): Promise<void> {
    if (this.syncing) throw new Error("Wait for the current sync to finish.");
    this.syncing = true;
    try {
      const result = await this.createStore().migrateLegacyTransactionLedgers();
      new Notice(`Converted ${result.moved} transactions; ${result.skipped} need review.`);
      await this.refreshDashboard();
    } finally { this.syncing = false; }
  }

  private getDailyNotePathForIsoDate(isoDate: string): string {
    const gcmApi = this.getGcmApi();
    if (typeof gcmApi?.dailyNotes?.pathForIsoDate === "function") return normalizePath(gcmApi.dailyNotes.pathForIsoDate(isoDate));
    const options = (this.app as any)?.internalPlugins?.plugins?.["daily-notes"]?.instance?.options || {};
    const format = String(options.format || "YYYY-MM-DD");
    const folder = normalizePath(String(options.folder || "")).replace(/^\/+|\/+$/g, "");
    const parsed = (window as any).moment(isoDate, "YYYY-MM-DD", true);
    const basename = parsed.isValid() ? parsed.format(format) : isoDate;
    return normalizePath(folder ? `${folder}/${basename}.md` : `${basename}.md`);
  }

  private getGcmApi(): any {
    return (this.app as any)?.plugins?.getPlugin?.("tps-global-context-menu")?.api || null;
  }

  private registerGcmIntegration(gcmApi: any = this.getGcmApi()): void {
    if (gcmApi === this.registeredGcmApi) return;
    const unregister = this.unregisterGcmAction;
    this.unregisterGcmAction = null;
    this.registeredGcmApi = null;
    unregister?.();
    if (typeof gcmApi?.externalActions?.register !== "function") return;
    this.unregisterGcmAction = gcmApi.externalActions.register({
      id: "open-finances",
      pluginId: "tps-finances",
      order: 35,
      icon: "landmark",
      label: "Open finances",
      title: "Open the TPS Finances dashboard",
      isVisible: ({ file }: { file: TFile }) => {
        const root = financePrefix(this.settings.financeFolder);
        return this.isFinanceRecord(file) || Boolean(root && file.path.startsWith(root));
      },
      onClick: () => this.openDashboard(),
    });
    this.registeredGcmApi = gcmApi;
  }

  private async refreshDashboard(change?: { file: TAbstractFile; oldPath?: string; data?: string; deleted?: boolean }): Promise<void> {
    const isFolder = change && !(change.file instanceof TFile);
    if (change && !isFolder && ![change.file.path, change.oldPath || ""].some(path => /\.md$/i.test(path))) return;
    for (const leaf of this.app.workspace.getLeavesOfType(TPS_FINANCES_VIEW_TYPE)) {
      const view = leaf.view;
      if (!(view instanceof TPSFinancesView)) continue;
      if (change && !view.dependsOnSource(change.file.path, isFolder)
        && !(change.oldPath && view.dependsOnSource(change.oldPath, isFolder))
        && (change.deleted || !this.dashboardChangeMayIntroduceRecord(change.file, change.data))) continue;
      await view.render();
    }
  }

  private dashboardChangeMayIntroduceRecord(file: TAbstractFile, data?: string): boolean {
    if (file instanceof TFile) {
      const fm = financeProperties(this.app).cache(this.app, file);
      if (fm.financeAccountId || fm.financeId || fm.financeRuleId || fm.financeBudgetId
        || ["account", "financeRule", "financeBudget"].includes(fm.kind)
        || ["holding", "financeSnapshot"].includes(fm.type)) return true;
    }
    if (!this.settings.financeFolder) return false;
    return ["Accounts", "Transactions", "Rules", "Budgets", "Holdings", "Snapshots"].some(section => {
      const prefix = financePrefix(this.settings.financeFolder, section);
      return file.path.startsWith(prefix) || (!(file instanceof TFile)
        && (file.path === prefix.slice(0, -1) || prefix.startsWith(`${file.path}/`)));
    });
  }

  private readAccountsFromVault(
    snapshot: StoredFinanceSnapshot | null,
    accountLabels?: Map<string, AccountLabel>,
    sourcePaths?: Set<string>,
    files?: DashboardFileSnapshot,
  ): FinanceAccount[] {
    const prefix = financePrefix(this.settings.financeFolder, "Accounts");
    const balances = this.parseSnapshotBalanceMap(snapshot?.lines || []);
    const accounts: FinanceAccount[] = [];
    for (const file of files?.files ?? this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const frontmatter = files?.fields(file) ?? financeProperties(this.app).cache(this.app, file) ?? {};
      if (!this.settings.financeFolder && frontmatter.kind !== "account") continue;
      sourcePaths?.add(file.path);
      if (accountLabels) {
        const institution = String(frontmatter.institution || "");
        const name = String(frontmatter.title || frontmatter.accountName || file.basename);
        const mask = String(frontmatter.accountMask || "");
        accountLabels.set(file.path.replace(/\.md$/i, ""), {
          display: `${name}${mask && !name.endsWith(`•${mask}`) ? ` •${mask}` : ""}`,
          search: [institution, name, frontmatter.accountName, mask, file.basename].filter(Boolean).join(" "),
        });
      }
      const id = String(frontmatter.financeAccountId || "");
      if (!id) continue;
      const balance = balances.get(file.path.replace(/\.md$/i, ""));
      accounts.push({
        financeAccountId: id,
        providerAccountId: "",
        localItemId: "",
        institutionName: String(frontmatter.institution || ""),
        name: String(frontmatter.title || frontmatter.accountName || file.basename),
        officialName: "",
        mask: String(frontmatter.accountMask || ""),
        type: String(frontmatter.accountType || ""),
        subtype: String(frontmatter.accountSubtype || ""),
        currency: String(frontmatter.currency || balance?.currency || "USD"),
        available: "available" in frontmatter ? atomicNumber(frontmatter.available) : balance?.available ?? null,
        current: "current" in frontmatter ? atomicNumber(frontmatter.current) : balance?.balance ?? null,
        limit: atomicNumber(frontmatter.limit),
        manual: frontmatter.financeSource === "manual",
        openingBalance: "openingBalance" in frontmatter ? Number(frontmatter.openingBalance) : undefined,
        valuationDate: String(frontmatter.valuationDate || ""),
        path: file.path,
      });
    }
    return accounts.sort((left, right) => accountSortRank(left.type) - accountSortRank(right.type)
      || left.institutionName.localeCompare(right.institutionName)
      || left.name.localeCompare(right.name));
  }

  private parseSnapshotHoldings(snapshot: StoredFinanceSnapshot | null, accounts: FinanceAccount[], sourcePaths?: Set<string>, files?: DashboardFileSnapshot): FinanceHolding[] {
    const pathToId = new Map<string, string>();
    for (const account of accounts) {
      if (account.path) pathToId.set(account.path.replace(/\.md$/i, ""), account.financeAccountId);
    }
    const notes=(files?.files ?? this.app.vault.getMarkdownFiles()).filter(file=>file.path.startsWith(financePrefix(this.settings.financeFolder, "Holdings")))
      .map(file => {
        const fm = files?.fields(file) ?? financeProperties(this.app).cache(this.app, file) ?? {};
        if (fm.type === "holding") sourcePaths?.add(file.path);
        return fm;
      }).filter(fm=>fm.type==="holding");
    if(notes.length) return notes.filter(fm=>fm.active===true).map(fm=>({
      financeAccountId:fm.account ? pathToId.get(wikilinkTarget(String(fm.account)).replace(/\.md$/i, "")) || "" : String(fm.financeAccountId || ""),securityId:String(fm.securityId),name:String(fm.name||""),ticker:String(fm.ticker||""),type:String(fm.holdingType||""),quantity:Number(fm.quantity)||0,price:Number(fm.price)||0,value:Number(fm.value)||0,costBasis:atomicNumber(fm.costBasis),currency:String(fm.currency||"USD"),asOf:String(fm.asOf||""),stale:fm.stale===true
    }));

    if (!snapshot) return [];
    const accountCurrency = new Map(accounts.map((account) => [account.financeAccountId, account.currency]));
    return snapshot.lines.filter((line) => line.includes("[type:: holdingSnapshot]")).map((line) => {
      const accountPath = wikilinkTarget(field(line, "account"));
      const financeAccountId = pathToId.get(accountPath) || "";
      return {
        financeAccountId,
        securityId: field(line, "securityId"),
        name: line.replace(/^-\s*/, "").split(" [type::")[0].trim(),
        ticker: line.replace(/^-\s*/, "").split(" [type::")[0].trim(),
        type: "",
        quantity: numberField(line, "quantity"),
        price: numberField(line, "price"),
        value: numberField(line, "value"),
        costBasis: optionalNumberField(line, "costBasis"),
        currency: field(line, "currency") || accountCurrency.get(financeAccountId) || "USD",
        asOf: field(line, "asOf") || snapshot.date,
        stale: field(line, "stale") === "true",
      };
    });
  }

  private async readLatestSnapshotDocument(sourcePaths?: Set<string>, files?: DashboardFileSnapshot): Promise<StoredFinanceSnapshot | null> {
    const file = this.latestSnapshotFile(files);
    if (!file) return null;
    sourcePaths?.add(file.path);
    const date = String((files?.fields(file) ?? financeProperties(this.app).cache(this.app, file))?.date || file.basename);
    const content = await this.app.vault.cachedRead(file);
    return {
      date,
      lines: content.split("\n"),
    };
  }

  private parseSnapshotBalanceMap(lines: readonly string[]): Map<string, { balance: number | null; available: number | null; currency: string }> {
    const map = new Map<string, { balance: number | null; available: number | null; currency: string }>();
    for (const line of lines.filter((entry) => entry.includes("[type:: balanceSnapshot]"))) {
      map.set(wikilinkTarget(field(line, "account")), {
        balance: optionalNumberField(line, "balance"),
        available: optionalNumberField(line, "available"),
        currency: field(line, "currency") || "USD",
      });
    }
    return map;
  }

  private latestSnapshotFile(files?: DashboardFileSnapshot): TFile | null {
    const prefix = financePrefix(this.settings.financeFolder, "Snapshots");
    let latest: TFile | null = null;
    let latestDate = "";
    for (const file of files?.files ?? this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = files?.fields(file) ?? financeProperties(this.app).cache(this.app, file);
      if (!this.settings.financeFolder && fm?.type !== "financeSnapshot") continue;
      const date = String(fm?.date || "");
      const dateOrder = date.localeCompare(latestDate);
      if (!latest || dateOrder > 0 || (dateOrder === 0 && file.path.localeCompare(latest.path) > 0)) {
        latest = file;
        latestDate = date;
      }
    }
    return latest;
  }

  private isFinanceRecord(file: TFile): boolean {
    const fm = financeProperties(this.app).cache(this.app, file) || {};
    return Boolean(fm.financeAccountId || fm.financeId || fm.financeRuleId || fm.financeBudgetId || fm.type === "financeSnapshot");
  }

  private accountFiles(): TFile[] {
    const prefix = financePrefix(this.settings.financeFolder, "Accounts");
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix) && Boolean(financeProperties(this.app).cache(this.app, file)?.financeAccountId) && (Boolean(this.settings.financeFolder) || financeProperties(this.app).cache(this.app, file)?.kind === "account"));
  }

  private findAccountFileById(financeAccountId: string): TFile | null {
    return this.accountFiles().find((file) => String(financeProperties(this.app).cache(this.app, file)?.financeAccountId || "") === financeAccountId) || null;
  }

  private async accountPathEntries(): Promise<Array<[string, string]>> {
    return this.accountFiles().map((file) => {
      const frontmatter = financeProperties(this.app).cache(this.app, file) || {};
      return [String(frontmatter.financeAccountId || ""), file.path] as [string, string];
    }).filter(([id]) => Boolean(id));
  }
}

function normalizeSettings(value: unknown): TPSFinancesSettings {
  const source = value && typeof value === "object" ? value as Partial<TPSFinancesSettings> : {};
  return {
    propertyNames: normalizePropertyNames(source.propertyNames),
    propertyMigration: normalizePropertyMigration(source.propertyMigration),
    recordMode: source.recordMode === "atomic-line" ? "atomic-line" : "atomic-note",
    legacyTransactionDiscovery: source.recordMode === "atomic-line" || source.legacyTransactionDiscovery === "discover" ? "discover" : "atomic-only",
    financeFolder: normalizeFinanceFolder(source.financeFolder, DEFAULT_SETTINGS.financeFolder),
    plaidEnvironment: source.plaidEnvironment === "development" || source.plaidEnvironment === "production" ? source.plaidEnvironment : "sandbox",
    plaidClientIdSecret: String(source.plaidClientIdSecret || DEFAULT_SETTINGS.plaidClientIdSecret).trim() || DEFAULT_SETTINGS.plaidClientIdSecret,
    plaidSecretSecret: String(source.plaidSecretSecret || DEFAULT_SETTINGS.plaidSecretSecret).trim() || DEFAULT_SETTINGS.plaidSecretSecret,
    oauthRedirectUri: String(source.oauthRedirectUri || "").trim(),
    transactionHistoryDays: Math.max(30, Math.min(730, Number(source.transactionHistoryDays) || DEFAULT_SETTINGS.transactionHistoryDays)),
    enableLogging: source.enableLogging === true,
  };
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDashboardTransaction(line: string, sourcePath: string, sourceLine: number): DashboardTransaction | null {
  const financeId = field(line, "financeId");
  const date = field(line, "date");
  if (!financeId || !date) return null;
  const accountPath = wikilinkTarget(field(line, "account"));
  return {
    financeId,
    manual: field(line, "financeSource") === "manual",
    transferAccount: field(line, "transferAccount"),
    ...(field(line, "providerName") ? { providerName: field(line, "providerName") } : {}),
    date,
    name: line.replace(/^-\s*/, "").split(" [type::")[0].trim(),
    account: accountPath.split("/").at(-1) || "",
    accountPath,
    accountSearchText: accountPath,
    amount: numberField(line, "amount"),
    currency: field(line, "currency") || "USD",
    pending: field(line, "pending") === "true",
    category: field(line, "categoryOverride") || field(line, "providerCategory") || field(line, "category"),
    categoryOverride: field(line, "categoryOverride"),
    providerCategory: field(line, "providerCategory") || field(line, "category"),
    categorySource: field(line, "categoryOverride") ? "manual" : "provider",
    merchant: field(line, "merchant"),
    tags: normalizeTags(field(line, "tags").split(",")),
    manualTags: normalizeTags(field(line, "tags").split(",")),
    ruleId: "",
    subtype: field(line, "providerCategoryDetail").toLowerCase() === "loan_payments_credit_card_payment" ? "transfer-out" : field(line, "subtype"),
    type: field(line, "type") === "investmentTransaction" ? "investmentTransaction" : "transaction",
    investmentType: field(line, "investmentType"),
    sourcePath,
    sourceLine,
  };
}

function field(line: string, key: string): string {
  const match = line.match(new RegExp(`\\[${escapeRegExp(key)}::\\s*(\\[\\[[^\\]]+\\]\\]|[^\\]]*)\\]`));
  return match?.[1]?.trim() || "";
}

function numberField(line: string, key: string): number {
  const value = Number(field(line, key));
  return Number.isFinite(value) ? value : 0;
}

function optionalNumberField(line: string, key: string): number | null {
  const raw = field(line, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function wikilinkTarget(value: string): string {
  const match = value.match(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
  return match?.[1]?.trim() || value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function accountSortRank(type: string): number {
  if (type === "depository") return 0;
  if (type === "credit") return 1;
  if (type === "loan") return 2;
  if (type === "investment") return 3;
  return 4;
}

function homeMetric(parent: HTMLElement, label: string, value: number): void {
  const metric = parent.createDiv({ cls: "tps-finances-home-metric" });
  metric.createEl("small", { text: label });
  metric.createEl("strong", { text: signedMoney(value, "USD", false) });
}

function signedMoney(value: number, currency: string, showSign = true): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
    signDisplay: showSign ? "always" : "auto",
  }).format(value);
}

function isSpendingTransaction(transaction: DashboardTransaction): boolean {
  return transaction.type === "transaction" && ["purchase", "payment", "fee", "cash-advance"].includes(transaction.subtype);
}

function userFacingError(error: unknown): string {
  const message = logger.summarizeError(error).replace(/^[A-Za-z]+Error:\s*/, "").trim() || "Unknown error";
  return message.length > 320 ? `${message.slice(0, 317)}…` : message;
}

function atomicNumber(value: unknown): number | null {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
}
