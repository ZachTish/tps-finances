import { Notice, Platform, Plugin, TFile, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import { DashboardModel, DashboardTransaction, TPSFinancesView, TPS_FINANCES_VIEW_TYPE } from "./dashboard-view";
import { classifyTransaction, normalizeTags } from "./classification";
import { normalizeDeviceItems } from "./device-state";
import { FinanceStore } from "./finance-store";
import { FinanceBudgetModal, FinanceRuleModal, TransactionClassificationModal } from "./finance-modals";
import { createLocalId } from "./identity";
import { applyInvestmentTransactionResult, holdingsForSnapshot, investmentDateRange } from "./investment-sync";
import * as logger from "./logger";
import { PlaidClient } from "./plaid-client";
import { inspectPlaidCredentials, readPlaidCredentials } from "./plaid-credentials";
import { openLocalPlaidLink } from "./plaid-link";
import { TPSFinancesSettingTab } from "./settings";
import { CoalescedSnapshotWriter, reconcilePersistedSnapshot } from "./settings-persistence";
import {
  DEFAULT_SETTINGS,
  DeviceItemState,
  DeviceState,
  FinanceAccount,
  FinanceHolding,
  PlaidCredentials,
  PlaidSetupStatus,
  TPSFinancesSettings,
  TransactionLogTarget,
} from "./types";

const DEVICE_STATE_SECRET = "tps-finances-device-state";
type OptionalInvestmentWarning = {
  institution: string;
  operation: "history" | "holdings";
  status: "pending" | "unavailable";
  code: string;
  preserved: number;
};

export default class TPSFinancesPlugin extends Plugin {
  settings: TPSFinancesSettings = { ...DEFAULT_SETTINGS };
  private deviceState: DeviceState = emptyDeviceState();
  private syncing = false;
  private unregisterGcmAction: (() => void) | null = null;
  private transactionRouteOverrides = new Map<string, TransactionLogTarget>();
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
    this.deviceState = this.loadDeviceState();
    this.registerView(TPS_FINANCES_VIEW_TYPE, (leaf) => new TPSFinancesView(leaf, this));
    this.addSettingTab(new TPSFinancesSettingTab(this.app, this));
    this.addRibbonIcon("landmark", "Open TPS Finances", () => void this.openDashboard());
    this.addCommand({ id: "open-finances", name: "Open finances", callback: () => void this.openDashboard() });
    this.addCommand({ id: "connect-plaid", name: "Connect an institution with Plaid", callback: () => this.runConnectPlaid("command") });
    this.addCommand({ id: "sync-finances", name: "Sync accounts and transactions", callback: () => this.runSync("command") });
    this.addCommand({ id: "add-categorization-rule", name: "Add categorization rule", callback: () => this.addCategorizationRule() });
    this.addCommand({ id: "add-monthly-budget", name: "Add monthly budget", callback: () => this.addMonthlyBudget() });
    this.registerGcmIntegration();
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      const root = normalizePath(this.settings.financeFolder);
      if (file.path.startsWith(`${root}/Rules/`) || file.path.startsWith(`${root}/Budgets/`) || file.path.startsWith(`${root}/Accounts/`)) void this.refreshDashboard();
    }));
    (this as any).api = {
      openDashboard: () => this.openDashboard(),
      sync: (reason = "api") => this.syncAll(reason),
      getDashboardModel: () => this.getDashboardModel(),
      renderHomeSummary: (container: HTMLElement) => this.renderHomeSummary(container),
      getTransactionsBasePath: () => normalizePath(`${this.settings.financeFolder}/Transactions.base`),
      getDailyNotePathForIsoDate: (isoDate: string) => this.getDailyNotePathForIsoDate(isoDate),
    };
    this.app.workspace.onLayoutReady(() => void this.prepareFinanceStorage());
    logger.flow("Lifecycle", "load", {
      environment: this.settings.plaidEnvironment,
      connectedItems: this.deviceState.items.length,
      financeFolder: this.settings.financeFolder,
    });
  }

  async onunload(): Promise<void> {
    this.unregisterGcmAction?.();
    this.unregisterGcmAction = null;
    this.app.workspace.detachLeavesOfType(TPS_FINANCES_VIEW_TYPE);
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    logger.setLoggingEnabled(this.settings.enableLogging);
    if (!this.settingsWriter) throw new Error("TPS Finances settings persistence is not ready.");
    await this.settingsWriter.save(this.settings);
  }

  async setDefaultTransactionLogTarget(target: TransactionLogTarget): Promise<void> {
    this.settings.transactionLogTarget = target;
    await this.saveSettings();
    await this.rerouteFinanceTransactions("default-changed");
  }

  async setAccountTransactionLogTarget(account: FinanceAccount, target: TransactionLogTarget | "default"): Promise<void> {
    const file = account.path ? this.app.vault.getAbstractFileByPath(account.path) : this.findAccountFileById(account.financeAccountId);
    if (!(file instanceof TFile)) throw new Error("The account note could not be found.");
    await this.processFinanceFrontmatter(file, (frontmatter) => {
      if (target === "default") delete frontmatter.transactionLogTarget;
      else frontmatter.transactionLogTarget = target;
    });
    logger.flow("Storage", "account-route-updated", { route: target });
    const key = file.path.replace(/\.md$/i, "");
    this.transactionRouteOverrides.set(key, target === "default" ? this.settings.transactionLogTarget : target);
    try {
      await this.rerouteFinanceTransactions("account-changed");
    } finally {
      this.transactionRouteOverrides.delete(key);
    }
  }

  getConnectedItems(): DeviceItemState[] {
    return this.deviceState.items.map((item) => ({ ...item, accessToken: "" }));
  }

  getPlaidSetupStatus(): PlaidSetupStatus {
    return inspectPlaidCredentials(
      this.settings.plaidClientIdSecret,
      this.settings.plaidSecretSecret,
      (name) => this.app.secretStorage.getSecret(name),
      this.deviceState.items.length,
    );
  }

  runConnectPlaid(source: "command" | "settings"): Promise<void> {
    return this.runUserAction("Connect", source, () => this.connectPlaid());
  }

  runSync(reason: string): Promise<void> {
    return this.runUserAction("Sync", reason, () => this.syncAll(reason));
  }

  async openDashboard(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(TPS_FINANCES_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: TPS_FINANCES_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async connectPlaid(): Promise<void> {
    if (!Platform.isDesktopApp) throw new Error("TPS Finances Plaid authentication currently requires the desktop app.");
    try {
      const credentials = this.getPlaidCredentials();
      const client = new PlaidClient(this.settings.plaidEnvironment, credentials);
      logger.flow("Connect", "start", { environment: this.settings.plaidEnvironment, credentialStatus: "ready" });
      const linkToken = await client.createLinkToken(this.deviceState.plaidUserId, this.settings.transactionHistoryDays, this.settings.oauthRedirectUri);
      const result = await openLocalPlaidLink(linkToken);
      const exchange = await client.exchangePublicToken(result.publicToken);
      const item: DeviceItemState = {
        localItemId: createLocalId("finance-item"),
        providerItemId: exchange.itemId,
        accessToken: exchange.accessToken,
        institutionName: result.institutionName,
        cursor: "",
        lastSyncAt: "",
        lastInvestmentTransactionSyncAt: "",
        environment: this.settings.plaidEnvironment,
        plaidClientIdSecretName: this.settings.plaidClientIdSecret,
        plaidSecretName: this.settings.plaidSecretSecret,
      };
      this.deviceState.items.push(item);
      this.saveDeviceState();
      logger.flow("Connect", "done", { institution: item.institutionName, connectedItems: this.deviceState.items.length });
      new Notice(`${item.institutionName} connected. Syncing finances…`);
      await this.syncAll("connect");
    } catch (error) {
      logger.failure("Connect", "failed", error, { environment: this.settings.plaidEnvironment });
      throw error;
    }
  }

  async disconnectItem(localItemId: string): Promise<void> {
    const item = this.deviceState.items.find((candidate) => candidate.localItemId === localItemId);
    if (!item) return;
    const client = new PlaidClient(item.environment, this.getPlaidCredentials(item.plaidSecretName, item.plaidClientIdSecretName || this.settings.plaidClientIdSecret));
    logger.flow("Disconnect", "start", { institution: item.institutionName });
    try {
      await client.removeItem(item.accessToken);
      this.deviceState.items = this.deviceState.items.filter((candidate) => candidate.localItemId !== localItemId);
      this.saveDeviceState();
      logger.flow("Disconnect", "done", { institution: item.institutionName, connectedItems: this.deviceState.items.length });
      new Notice(`${item.institutionName} disconnected from Plaid.`);
      await this.refreshDashboard();
    } catch (error) {
      logger.failure("Disconnect", "failed", error, { institution: item.institutionName });
      throw error;
    }
  }

  async syncAll(reason: string): Promise<void> {
    if (this.syncing) {
      new Notice("TPS Finances is already syncing.");
      return;
    }
    if (!this.deviceState.items.length) {
      new Notice("Connect an institution before syncing TPS Finances.");
      return;
    }
    this.syncing = true;
    const started = Date.now();
    const store = this.createStore();
    const allAccounts: FinanceAccount[] = [];
    const allHoldings: FinanceHolding[] = [];
    const failures: Array<{ institution: string; error: unknown }> = [];
    const optionalWarnings: OptionalInvestmentWarning[] = [];
    let transactionChanges = 0;
    logger.flow("Sync", "start", { reason, itemCount: this.deviceState.items.length });
    try {
      await store.ensureStructure();
      await this.migrateLegacyTransactions(store);
      const previousAccounts = await this.readAccountsFromVault();
      const previousHoldings = await this.readLatestSnapshot(previousAccounts);
      for (const item of this.deviceState.items) {
        try {
          const client = new PlaidClient(item.environment, this.getPlaidCredentials(item.plaidSecretName, item.plaidClientIdSecretName || this.settings.plaidClientIdSecret));
          const accounts = await client.getAccounts(item, this.deviceState);
          const accountPaths = await store.upsertAccounts(accounts);
          const patch = await client.syncTransactions(item, this.deviceState);
          this.saveDeviceState();
          const applied = await store.applyTransactions(patch.added, patch.modified, patch.removedProviderIds, this.deviceState, accountPaths);
          item.cursor = patch.nextCursor;
          item.lastSyncAt = new Date().toISOString();
          this.saveDeviceState();
          allAccounts.push(...accounts);
          transactionChanges += applied.added + applied.modified + applied.removed;

          const range = investmentDateRange(item.lastInvestmentTransactionSyncAt, this.settings.transactionHistoryDays);
          const investmentResult = await client.getInvestmentTransactions(item, this.deviceState, range.start, range.end);
          if (investmentResult.status === "ok") this.saveDeviceState();
          const investmentApplied = await applyInvestmentTransactionResult(
            investmentResult,
            item.lastInvestmentTransactionSyncAt,
            new Date().toISOString(),
            (transactions) => store.replaceInvestmentTransactions(transactions, accountPaths),
          );
          if (investmentResult.status === "ok") {
            item.lastInvestmentTransactionSyncAt = investmentApplied.watermark;
            this.saveDeviceState();
          } else {
            optionalWarnings.push({
              institution: item.institutionName,
              operation: "history",
              status: investmentResult.status,
              code: investmentResult.code,
              preserved: 0,
            });
          }
          transactionChanges += investmentApplied.count;

          const holdingsResult = await client.getHoldings(item, this.deviceState);
          if (holdingsResult.status === "ok") this.saveDeviceState();
          const holdings = holdingsForSnapshot(
            holdingsResult,
            new Set(accounts.map((account) => account.financeAccountId)),
            previousHoldings,
          );
          allHoldings.push(...holdings.holdings);
          if (holdingsResult.status !== "ok") {
            optionalWarnings.push({
              institution: item.institutionName,
              operation: "holdings",
              status: holdingsResult.status,
              code: holdingsResult.code,
              preserved: holdings.preserved,
            });
          }
          logger.flow("Sync", "item:done", {
            institution: item.institutionName,
            accounts: accounts.length,
            holdings: holdings.holdings.length,
            holdingsState: holdingsResult.status,
            preservedHoldings: holdings.preserved,
            added: applied.added,
            modified: applied.modified,
            removed: applied.removed,
            investmentTransactions: investmentApplied.count,
            investmentTransactionsState: investmentResult.status,
          });
        } catch (error) {
          failures.push({ institution: item.institutionName, error });
          logger.failure("Sync", "item:failed", error, { institution: item.institutionName });
        }
      }
      if (!failures.length && (allAccounts.length || allHoldings.length)) {
        await store.writeSnapshot(allAccounts, allHoldings, new Map(await this.accountPathEntries()), new Date());
      }
      await this.refreshDashboard();
      logger.flow("Sync", "done", {
        reason,
        durationMs: Date.now() - started,
        successfulItems: this.deviceState.items.length - failures.length,
        failedItems: failures.length,
        accounts: allAccounts.length,
        holdings: allHoldings.length,
        transactionChanges,
        optionalInvestmentWarnings: optionalWarnings.length,
      });
      if (failures.length) {
        const first = failures[0];
        const more = failures.length > 1 ? ` (${failures.length - 1} more institution${failures.length === 2 ? "" : "s"} failed)` : "";
        const optional = optionalWarnings.length ? ` ${optionalInvestmentWarningSummary(optionalWarnings)}` : "";
        new Notice(`TPS Finances could not sync ${first.institution}: ${userFacingError(first.error)}${more}.${optional}`, 12000);
      }
      else {
        const summary = `TPS Finances synced ${allAccounts.length} accounts and ${transactionChanges} transaction changes.`;
        new Notice(optionalWarnings.length ? `${summary} ${optionalInvestmentWarningSummary(optionalWarnings)}` : summary, optionalWarnings.length ? 12000 : 5000);
      }
    } catch (error) {
      logger.failure("Sync", "failed", error, { reason });
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  async getDashboardModel(): Promise<DashboardModel> {
    const accounts = await this.readAccountsFromVault();
    const holdings = await this.readLatestSnapshot(accounts);
    const store = this.createStore();
    const transactionRecords = await store.readTransactionRecords();
    const rules = store.readRules();
    const accountLabels = this.accountLabelsByPath();
    const transactions = transactionRecords.map((record) => parseDashboardTransaction(record.line, record.path, record.lineNumber)).filter((value): value is DashboardTransaction => value !== null)
      .map((transaction) => {
        const accountLabel = accountLabels.get(transaction.accountPath);
        const resolved = accountLabel ? { ...transaction, account: accountLabel.display, accountSearchText: accountLabel.search } : transaction;
        const classification = classifyTransaction(resolved, rules);
        return { ...resolved, category: classification.category, tags: classification.tags, categorySource: classification.source, ruleId: classification.ruleId };
      }).sort((left, right) => right.date.localeCompare(left.date));
    const month = localDate(new Date()).slice(0, 7);
    const budgets = store.readBudgets().map((budget) => ({
      ...budget,
      spent: -transactions.filter((transaction) => transaction.date.startsWith(month)
        && transaction.amount < 0
        && isSpendingTransaction(transaction)
        && normalizedCategory(transaction.category) === normalizedCategory(budget.category))
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    }));
    const lastSyncAt = this.deviceState.items.map((item) => item.lastSyncAt).filter(Boolean).sort().at(-1) || "";
    return {
      accounts,
      holdings,
      transactions,
      budgets,
      lastSyncAt,
      connectedItems: this.deviceState.items.length,
      plaidSetupState: this.getPlaidSetupStatus().state,
    };
  }

  addCategorizationRule(): void {
    new FinanceRuleModal(this.app, async (input) => {
      const store = this.createStore();
      await store.ensureStructure();
      await store.createRule({ ...input, id: createLocalId("finance-rule") });
      logger.flow("Classification", "rule-created", { hasCategory: Boolean(input.category), tagCount: input.tags.length, priority: input.priority });
      new Notice("Categorization rule created. Existing transactions were re-evaluated.");
      await this.refreshDashboard();
    }).open();
  }

  addMonthlyBudget(): void {
    new FinanceBudgetModal(this.app, async (input) => {
      const store = this.createStore();
      await store.ensureStructure();
      await store.createBudget({ ...input, id: createLocalId("finance-budget") });
      logger.flow("Budget", "created");
      new Notice("Monthly budget created.");
      await this.refreshDashboard();
    }).open();
  }

  editTransactionClassification(transaction: DashboardTransaction): void {
    new TransactionClassificationModal(this.app, transaction, async (category, tags) => {
      const updated = await this.createStore().updateTransactionMetadata(transaction.financeId, category, tags);
      if (!updated) throw new Error("The transaction could not be found in its daily note.");
      logger.flow("Classification", "transaction-updated", { source: category ? "manual" : "automatic", tagCount: tags.length });
      new Notice(category || tags.length ? "Transaction classification saved." : "Transaction returned to automatic classification.");
      await this.refreshDashboard();
    }).open();
  }

  async openFinanceBase(name: "Rules" | "Budgets"): Promise<void> {
    const path = normalizePath(`${this.settings.financeFolder}/${name}.base`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`${name}.base could not be found.`);
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
  }

  async renderHomeSummary(container: HTMLElement): Promise<void> {
    const model = await this.getDashboardModel();
    container.empty();
    container.addClass("tps-finances-home-summary");
    if (!model.connectedItems && !model.accounts.length) {
      const text = model.plaidSetupState === "conflicting-credentials"
        ? "Plaid setup needs attention: choose separate client ID and environment secrets in TPS Finances settings."
        : model.plaidSetupState === "ready"
          ? "Plaid credentials are ready. Connect an institution to see your financial snapshot."
          : "Add Plaid credentials in TPS Finances settings, then connect an institution.";
      container.createDiv({ cls: "tps-finances-home-empty", text });
    } else if (model.connectedItems && !model.accounts.length) {
      container.createDiv({ cls: "tps-finances-home-empty", text: "Plaid is connected, but no account snapshot has synced yet. Open Finances and run Sync to see the provider error." });
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
    const editor = (leaf.view as any)?.editor;
    if (editor) {
      editor.setCursor({ line: transaction.sourceLine, ch: 0 });
      editor.scrollIntoView?.({ from: { line: transaction.sourceLine, ch: 0 }, to: { line: transaction.sourceLine + 1, ch: 0 } }, true);
      editor.focus?.();
    }
  }

  private getPlaidCredentials(
    secretName = this.settings.plaidSecretSecret,
    clientIdSecretName = this.settings.plaidClientIdSecret,
  ): PlaidCredentials {
    return readPlaidCredentials(clientIdSecretName, secretName, (name) => this.app.secretStorage.getSecret(name));
  }

  private async runUserAction(scope: string, trigger: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      new Notice(`TPS Finances ${scope.toLocaleLowerCase()} failed: ${userFacingError(error)}`, 12000);
      logger.failure(scope, "user-action-failed", error, { trigger });
    }
  }

  private createStore(): FinanceStore {
    return new FinanceStore(
      this.app,
      normalizePath(this.settings.financeFolder),
      (file, mutator) => this.processFinanceFrontmatter(file, mutator),
      (isoDate) => this.ensureFinanceDailyNote(isoDate),
      (context) => this.resolveFinanceTransactionTarget(context.date, context.accountPath),
    );
  }

  private async rerouteFinanceTransactions(reason: string): Promise<void> {
    const result = await this.createStore().rerouteTransactions();
    logger.flow("Storage", "transactions-rerouted", { reason, ...result });
    if (result.moved) new Notice(`Moved ${result.moved} transaction${result.moved === 1 ? "" : "s"} to the selected log location.`);
    await this.refreshDashboard();
  }

  private async resolveFinanceTransactionTarget(date: string, accountPath: string): Promise<TFile> {
    const normalizedAccountPath = normalizePath(accountPath.replace(/\.md$/i, ""));
    const immediateOverride = this.transactionRouteOverrides.get(normalizedAccountPath);
    const accountFile = this.app.vault.getAbstractFileByPath(`${normalizedAccountPath}.md`);
    const frontmatter = accountFile instanceof TFile ? this.app.metadataCache.getFileCache(accountFile)?.frontmatter || {} : {};
    const override = frontmatter.transactionLogTarget === "account-note" || frontmatter.transactionLogTarget === "daily-note"
      ? frontmatter.transactionLogTarget as TransactionLogTarget
      : null;
    const target = immediateOverride || override || this.settings.transactionLogTarget;
    if (target === "account-note" && accountFile instanceof TFile) return accountFile;
    return this.ensureFinanceDailyNote(date);
  }

  private async prepareFinanceStorage(): Promise<void> {
    await this.ensureFinanceStructure();
    await this.migrateLegacyTransactions(this.createStore());
  }

  private async migrateLegacyTransactions(store: FinanceStore): Promise<void> {
    try {
      const result = await store.migrateLegacyTransactionLedgers();
      if (result.moved || result.skipped) logger.flow("Storage", "daily-note-migration", result);
      if (result.moved) new Notice(`Moved ${result.moved} finance transaction${result.moved === 1 ? "" : "s"} into daily notes.`);
    } catch (error) {
      logger.failure("Storage", "daily-note-migration-failed", error);
      throw error;
    }
  }

  private async ensureFinanceDailyNote(isoDate: string): Promise<TFile> {
    const gcmApi = this.getGcmApi();
    if (typeof gcmApi?.dailyNotes?.ensureForIsoDate === "function") {
      const file = await gcmApi.dailyNotes.ensureForIsoDate(isoDate);
      if (file instanceof TFile) return file;
    }
    const path = this.getDailyNotePathForIsoDate(isoDate);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder) await this.ensureFolderPath(folder);
    return this.app.vault.create(path, "");
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

  private async ensureFolderPath(path: string): Promise<void> {
    let current = "";
    for (const part of normalizePath(path).split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private async ensureFinanceStructure(): Promise<void> {
    try {
      await this.createStore().ensureStructure();
      logger.flow("Storage", "structure-ready", { folder: this.settings.financeFolder });
    } catch (error) {
      logger.failure("Storage", "structure-failed", error, { folder: this.settings.financeFolder });
    }
  }

  private async processFinanceFrontmatter(file: TFile, mutator: (frontmatter: Record<string, unknown>) => void): Promise<unknown> {
    const gcmApi = this.getGcmApi();
    if (typeof gcmApi?.frontmatter?.process === "function") return gcmApi.frontmatter.process(file, mutator);
    if (typeof gcmApi?.processFrontmatter === "function") return gcmApi.processFrontmatter(file, mutator);
    return this.app.fileManager.processFrontMatter(file, mutator);
  }

  private getGcmApi(): any {
    return (this.app as any)?.plugins?.getPlugin?.("tps-global-context-menu")?.api || null;
  }

  private registerGcmIntegration(): void {
    const gcmApi = this.getGcmApi();
    if (typeof gcmApi?.externalActions?.register !== "function") return;
    this.unregisterGcmAction = gcmApi.externalActions.register({
      id: "open-finances",
      pluginId: "tps-finances",
      order: 35,
      icon: "landmark",
      label: "Open finances",
      title: "Open the TPS Finances dashboard",
      isVisible: ({ file }: { file: TFile }) => {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        const root = `${normalizePath(this.settings.financeFolder)}/`;
        return String(frontmatter.kind || "") === "account" || file.path.startsWith(root);
      },
      onClick: () => this.openDashboard(),
    });
  }

  private loadDeviceState(): DeviceState {
    const stored = this.app.secretStorage.getSecret(DEVICE_STATE_SECRET);
    if (!stored) return emptyDeviceState();
    try {
      const parsed = JSON.parse(stored) as Partial<DeviceState>;
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      const normalized = normalizeDeviceItems(rawItems, this.settings.plaidClientIdSecret, this.settings.plaidSecretSecret);
      if (normalized.skipped) logger.warn("DeviceState", "invalid-items-skipped", { skippedItems: normalized.skipped });
      const state = {
        plaidUserId: String(parsed.plaidUserId || createLocalId("finance-user")),
        items: normalized.items,
        providerIdentityMap: parsed.providerIdentityMap && typeof parsed.providerIdentityMap === "object" ? { ...parsed.providerIdentityMap } : {},
      };
      if (normalized.migratedClientIdItems) {
        try {
          this.app.secretStorage.setSecret(DEVICE_STATE_SECRET, JSON.stringify(state));
          logger.flow("DeviceState", "legacy-client-id-references-migrated", { migratedItems: normalized.migratedClientIdItems });
        } catch (error) {
          logger.failure("DeviceState", "legacy-client-id-migration-persist-failed", new Error("Could not persist the migrated device state in SecretStorage."), {
            migratedItems: normalized.migratedClientIdItems,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }
      return state;
    } catch (error) {
      logger.failure("DeviceState", "parse-failed", error);
      return emptyDeviceState();
    }
  }

  private saveDeviceState(): void {
    this.app.secretStorage.setSecret(DEVICE_STATE_SECRET, JSON.stringify(this.deviceState));
  }

  private async refreshDashboard(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(TPS_FINANCES_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof TPSFinancesView) await view.render();
    }
  }

  private async readAccountsFromVault(): Promise<FinanceAccount[]> {
    const prefix = normalizePath(`${this.settings.financeFolder}/Accounts/`);
    const snapshot = await this.readSnapshotBalanceMap();
    const accounts: FinanceAccount[] = [];
    for (const file of this.app.vault.getMarkdownFiles().filter((candidate) => candidate.path.startsWith(prefix))) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const id = String(frontmatter.financeAccountId || "");
      if (!id) continue;
      const balance = snapshot.get(file.path.replace(/\.md$/i, ""));
      accounts.push({
        financeAccountId: id,
        providerAccountId: "",
        localItemId: "",
        institutionName: String(frontmatter.institution || ""),
        name: String(frontmatter.accountName || frontmatter.title || file.basename),
        officialName: "",
        mask: String(frontmatter.accountMask || ""),
        type: String(frontmatter.accountType || ""),
        subtype: String(frontmatter.accountSubtype || ""),
        currency: String(frontmatter.currency || balance?.currency || "USD"),
        available: balance?.available ?? null,
        current: balance?.balance ?? null,
        limit: null,
        path: file.path,
        transactionLogTarget: frontmatter.transactionLogTarget === "account-note" || frontmatter.transactionLogTarget === "daily-note" ? frontmatter.transactionLogTarget : "default",
        effectiveTransactionLogTarget: frontmatter.transactionLogTarget === "account-note" || frontmatter.transactionLogTarget === "daily-note"
          ? frontmatter.transactionLogTarget
          : this.settings.transactionLogTarget,
      });
    }
    return accounts.sort((left, right) => accountSortRank(left.type) - accountSortRank(right.type)
      || left.institutionName.localeCompare(right.institutionName)
      || left.name.localeCompare(right.name));
  }

  private async readLatestSnapshot(accounts: FinanceAccount[]): Promise<FinanceHolding[]> {
    const file = this.latestSnapshotFile();
    if (!file) return [];
    const content = await this.app.vault.cachedRead(file);
    const snapshotDate = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.date || file.basename);
    const pathToId = new Map<string, string>();
    for (const accountFile of this.accountFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(accountFile)?.frontmatter || {};
      pathToId.set(accountFile.path.replace(/\.md$/i, ""), String(frontmatter.financeAccountId || ""));
    }
    const accountCurrency = new Map(accounts.map((account) => [account.financeAccountId, account.currency]));
    return content.split("\n").filter((line) => line.includes("[type:: holdingSnapshot]")).map((line) => {
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
        asOf: field(line, "asOf") || snapshotDate,
        stale: field(line, "stale") === "true",
      };
    });
  }

  private async readSnapshotBalanceMap(): Promise<Map<string, { balance: number | null; available: number | null; currency: string }>> {
    const map = new Map<string, { balance: number | null; available: number | null; currency: string }>();
    const file = this.latestSnapshotFile();
    if (!file) return map;
    const content = await this.app.vault.cachedRead(file);
    for (const line of content.split("\n").filter((entry) => entry.includes("[type:: balanceSnapshot]"))) {
      map.set(wikilinkTarget(field(line, "account")), {
        balance: optionalNumberField(line, "balance"),
        available: optionalNumberField(line, "available"),
        currency: field(line, "currency") || "USD",
      });
    }
    return map;
  }

  private latestSnapshotFile(): TFile | null {
    const prefix = normalizePath(`${this.settings.financeFolder}/Snapshots/`);
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix)).sort((left, right) => {
      const leftDate = String(this.app.metadataCache.getFileCache(left)?.frontmatter?.date || "");
      const rightDate = String(this.app.metadataCache.getFileCache(right)?.frontmatter?.date || "");
      return rightDate.localeCompare(leftDate) || right.path.localeCompare(left.path);
    })[0] || null;
  }

  private accountFiles(): TFile[] {
    const prefix = normalizePath(`${this.settings.financeFolder}/Accounts/`);
    return this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(prefix));
  }

  private findAccountFileById(financeAccountId: string): TFile | null {
    return this.accountFiles().find((file) => String(this.app.metadataCache.getFileCache(file)?.frontmatter?.financeAccountId || "") === financeAccountId) || null;
  }

  private accountLabelsByPath(): Map<string, { display: string; search: string }> {
    return new Map(this.accountFiles().map((file) => {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const institution = String(frontmatter.institution || "");
      const name = String(frontmatter.accountName || frontmatter.title || file.basename);
      const mask = String(frontmatter.accountMask || "");
      return [file.path.replace(/\.md$/i, ""), {
        display: `${name}${mask ? ` •${mask}` : ""}`,
        search: [institution, name, mask, file.basename].filter(Boolean).join(" "),
      }];
    }));
  }

  private async accountPathEntries(): Promise<Array<[string, string]>> {
    return this.accountFiles().map((file) => {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      return [String(frontmatter.financeAccountId || ""), file.path] as [string, string];
    }).filter(([id]) => Boolean(id));
  }
}

function normalizeSettings(value: unknown): TPSFinancesSettings {
  const source = value && typeof value === "object" ? value as Partial<TPSFinancesSettings> : {};
  return {
    financeFolder: normalizePath(String(source.financeFolder || DEFAULT_SETTINGS.financeFolder)).replace(/^\/+|\/+$/g, "") || DEFAULT_SETTINGS.financeFolder,
    plaidEnvironment: source.plaidEnvironment === "development" || source.plaidEnvironment === "production" ? source.plaidEnvironment : "sandbox",
    plaidClientIdSecret: String(source.plaidClientIdSecret || DEFAULT_SETTINGS.plaidClientIdSecret).trim() || DEFAULT_SETTINGS.plaidClientIdSecret,
    plaidSecretSecret: String(source.plaidSecretSecret || DEFAULT_SETTINGS.plaidSecretSecret).trim() || DEFAULT_SETTINGS.plaidSecretSecret,
    oauthRedirectUri: String(source.oauthRedirectUri || "").trim(),
    transactionHistoryDays: Math.max(30, Math.min(730, Number(source.transactionHistoryDays) || DEFAULT_SETTINGS.transactionHistoryDays)),
    transactionLogTarget: source.transactionLogTarget === "account-note" ? "account-note" : "daily-note",
    enableLogging: source.enableLogging === true,
  };
}

function emptyDeviceState(): DeviceState {
  return { plaidUserId: createLocalId("finance-user"), items: [], providerIdentityMap: {} };
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
    subtype: field(line, "subtype"),
    type: field(line, "type") === "investmentTransaction" ? "investmentTransaction" : "transaction",
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

function normalizedCategory(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_]+/g, "-");
}

function userFacingError(error: unknown): string {
  const message = logger.summarizeError(error).replace(/^[A-Za-z]+Error:\s*/, "").trim() || "Unknown error";
  return message.length > 320 ? `${message.slice(0, 317)}…` : message;
}

function optionalInvestmentWarningSummary(warnings: OptionalInvestmentWarning[]): string {
  const first = warnings[0];
  const more = warnings.length > 1 ? ` ${warnings.length - 1} more optional Investments request${warnings.length === 2 ? "" : "s"} will also retry.` : "";
  const preserved = warnings.reduce((sum, warning) => sum + warning.preserved, 0);
  const retained = preserved ? ` Retained ${preserved} last-known holding${preserved === 1 ? "" : "s"} with its original as-of date.` : "";
  const retry = first.operation === "history"
    ? "it will retry without advancing its history watermark"
    : "it will retry without treating the missing response as an authoritative empty result";
  return `Investments ${first.operation} for ${first.institution} is ${first.status} (${first.code}); ${retry}.${retained}${more}`;
}
