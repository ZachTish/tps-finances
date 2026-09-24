import { FinanceConnectionSettings } from "./connection-settings";
import { parseWalletParts, walletTransactionID } from "./finance-wallet";
import { applyPropertyMigration, previewPropertyMigration, normalizePropertyMigration } from "./property-migration";
import { financeProperties, FinanceProperties, normalizePropertyNames } from "./finance-properties";
import { budgetBucket, budgetCurrency, type BudgetBucket } from "./flex-budget";
import type { FinanceBudget } from "./types";
import { FinanceRequestModal, getFinanceRelay, LinkSession, LinkResult, RelayItem } from "./finance-relay";
import { financePath, financePrefix, normalizeFinanceFolder } from "./finance-paths";
import { Notice, Platform, Plugin, TFile, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import { DashboardModel, DashboardTransaction, TPSFinancesView, TPS_FINANCES_VIEW_TYPE } from "./dashboard-view";
import { calculateMonthlyBudgetProgress, normalizeTags, prepareTransactionClassifier } from "./classification";
import { normalizeDeviceItems } from "./device-state";
import { AtomicFinanceStore } from "./atomic-finance-store";
import { TransactionTitleModal } from "./transaction-title-modal";
import { FinanceStore } from "./finance-store";
import { FinanceBudgetModal, FinanceRuleModal, TransactionClassificationModal } from "./finance-modals";
import { ManualFinanceStore, applyManualCashBalances } from "./manual-finance";
import { ManualAccountModal, CashTransactionModal, AssetValueModal } from "./finance-modals";
import { createLocalId } from "./identity";
import { applyInvestmentTransactionResult, holdingsForSnapshot, investmentDateRange } from "./investment-sync";
import * as logger from "./logger";
import { PlaidClient } from "./plaid-client";
import { assertLocalPlaidLinkAvailable, openLocalPlaidLink } from "./plaid-link";
import { TPSFinancesSettingTab } from "./settings";
import { CoalescedSnapshotWriter, reconcilePersistedSnapshot } from "./settings-persistence";
import {
  DEFAULT_SETTINGS,
  DeviceItemState,
  DeviceState,
  FinanceAccount,
  FinanceHolding,
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
    const financeSettingsTab = new TPSFinancesSettingTab(this.app, this);
    this.addSettingTab(financeSettingsTab);
    this.addRibbonIcon("landmark", "Open TPS Finances", () => void this.openDashboard());
    this.addCommand({ id: "open-finances", name: "Open finances", callback: () => void this.openDashboard() });
    this.addCommand({ id: "connect-plaid", name: "Connect an institution with Plaid", callback: () => this.runConnectPlaid("command") });
    this.addCommand({ id: "sync-finances", name: "Sync accounts and transactions", callback: () => this.runSync("command") });
    this.addCommand({ id: "add-categorization-rule", name: "Add categorization rule", callback: () => this.addCategorizationRule() });
    this.addCommand({ id: "open-budget", name: "Open budget", callback: () => void this.openDashboard("budget") });
    this.addCommand({ id: "add-monthly-budget", name: "Add monthly budget", callback: () => this.addMonthlyBudget() });
    this.addCommand({ id: "add-cash-account", name: "Add cash account", callback: () => this.addManualAccount("cash") });
    this.addCommand({ id: "add-resale-asset", name: "Add resale asset", callback: () => this.addManualAccount("asset") });
    this.addCommand({ id: "add-cash-transaction", name: "Log cash transaction", callback: () => void this.runUserAction("Cash", "command", () => this.addCashTransaction()) });
    this.addCommand({ id: "review-transaction-titles", name: "Review transaction titles", callback: () => void this.runUserAction("Titles", "command", () => this.reviewTransactionTitles()) });
    this.addCommand({ id: "review-transaction-records", name: "Review transaction records", callback: () => void this.runUserAction("Titles", "records-command", () => this.reviewTransactionTitles(true)) });
    this.registerGcmIntegration();
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (this.syncing || this.settings.propertyMigration) return; // Sync owns the final dashboard refresh.
      const root = financePrefix(this.settings.financeFolder);
      if (file.path.startsWith(root) && this.isFinanceRecord(file)) void this.refreshDashboard();
    }));
    this.registerEvent(this.app.vault.on("delete", file => {
      if (!this.syncing && !this.settings.propertyMigration && file.path.startsWith(financePrefix(this.settings.financeFolder))) void this.refreshDashboard();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      const root = financePrefix(this.settings.financeFolder);
      if (!this.syncing && !this.settings.propertyMigration && (file.path.startsWith(root) || oldPath.startsWith(root))) void this.refreshDashboard();
    }));
    (this as any).api = {
      connectionSettings: { version: 1, render: (parent: HTMLElement) => {
        const panel = new FinanceConnectionSettings(this.app, this, parent);
        panel.render();
        return () => panel.dispose();
      } },
      controllerFinanceBackend: this.createControllerBackend(),
      openConnectionSettings: () => this.openConnectionSettings(),
      openDashboard: () => this.openDashboard(),
      sync: (reason = "api") => this.syncAll(reason),
      getDashboardModel: () => this.getDashboardModel(),
      renderHomeSummary: (container: HTMLElement) => this.renderHomeSummary(container),
      getTransactionsBasePath: () => {
        const alternate=financePath(this.settings.financeFolder, "", "Transactions (Atomic notes).base");
        return this.settings.recordMode === "atomic-note" && this.app.vault.getAbstractFileByPath(alternate) ? alternate : financePath(this.settings.financeFolder, "", "Transactions.base");
      },
      getDailyNotePathForIsoDate: (isoDate: string) => this.getDailyNotePathForIsoDate(isoDate),
    };
    this.app.workspace.onLayoutReady(() => void this.prepareFinanceStorage());
    logger.flow("Lifecycle", "load", {
      environment: this.getPlaidConfiguration().plaidEnvironment,
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

  private assertPropertyMigrationComplete(): void {
    if (this.settings.propertyMigration) throw new Error("Resume the property migration in Finances → Properties before using finance records.");
  }

  async changePropertyNames(from: FinanceProperties, to: FinanceProperties, migrate: boolean): Promise<void> {
    this.assertPropertyMigrationComplete();
    if (this.syncing) throw new Error("Wait for the current finance sync to finish.");
    if (JSON.stringify(normalizePropertyNames(this.settings.propertyNames)) !== JSON.stringify(from.names)) throw new Error("Property settings changed. Reopen Properties and try again.");
    to.assertIdentityKey((this.app as any).plugins?.plugins?.["tps-global-context-menu"]?.settings?.nativeRecordIdentityPropertyKey || "tpsId");
    this.syncing = true;
    try {
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
    new FinanceProperties(journal.to).assertIdentityKey((this.app as any).plugins?.plugins?.["tps-global-context-menu"]?.settings?.nativeRecordIdentityPropertyKey || "tpsId");
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

  getConnectedItems(): RelayItem[] {
    const relay = this.getRelayStatus();
    if (relay?.mode === 'client' || relay && !relay.enabled) return relay.items;
    return this.deviceState.items.map(({localItemId,institutionName,environment,lastSyncAt}) => ({localItemId,institutionName,environment,lastSyncAt}));
  }

  getRelayStatus() {
    try { return getFinanceRelay(this.app)?.getStatus() || null; }
    catch { return {configured:true,mode:'client' as const,enabled:false,online:false,updatedAt:0,lastSyncAt:0,items:[] as RelayItem[],message:'Enable TPS Controller 1.4.0+ and check its finance pairing. Bank requests are paused; saved notes remain available.'}; }
  }
  getRelayOperations() { try { return getFinanceRelay(this.app)?.getOperations() || []; } catch { return []; } }
  canConnectPlaid(): boolean {
    const relay = this.getRelayStatus();
    return relay ? relay.enabled : Platform.isDesktopApp && !Platform.isMobile;
  }
  showFinanceRequest(id: string): void {
    const relay = getFinanceRelay(this.app);
    if (relay) new FinanceRequestModal(this.app, relay, id, () => void this.refreshDashboard()).open();
  }
  private async requestFinance(action: 'connect'|'reconnect'|'sync'|'disconnect', itemId?: string): Promise<boolean> {
    const relay = getFinanceRelay(this.app);
    if (!relay) return false;
    const id = await relay.request(action,itemId);
    this.showFinanceRequest(id);
    return true;
  }
  private createControllerBackend() {
    const assertHost = () => {
      const relay=getFinanceRelay(this.app)?.getConfiguration();
      if (Platform.isMobile || relay?.mode !== 'host' || !relay.enabled || !(this.app as any).plugins?.plugins?.['tps-controller']?.api?.isController()) throw new Error('Only the paired desktop Controller can import bank records.');
      this.loadControllerState();
    };
    return {
      version: 1 as const,
      prepareHost: () => this.loadControllerState(true),
      snapshot: () => { this.loadControllerState(); return ({ready:this.controllerPlaid(false)?.inspect().state==='ready',items:this.deviceState.items.map(({localItemId,institutionName,environment,lastSyncAt})=>({localItemId,institutionName,environment,lastSyncAt}))}); },
      createLink: async (itemId?: string): Promise<LinkSession> => {
        assertHost();
        if (this.settingsWriter) await this.saveSettings();
        const item = itemId ? this.deviceState.items.find(item=>item.localItemId===itemId) : undefined;
        if (itemId && !item) throw new Error('Connection no longer exists.');
        const config = this.getPlaidConfiguration();
        const environment = item?.environment || config.plaidEnvironment;
        const clientRef = item?.plaidClientIdSecretName || config.plaidClientIdSecret;
        const secretRef = item?.plaidSecretName || config.plaidSecretSecret;
        const link = await this.createPlaidClient(environment,secretRef,clientRef).createHostedLink(this.deviceState.plaidUserId,this.settings.transactionHistoryDays,item?.accessToken);
        return {...link,environment,clientRef,secretRef,itemId};
      },
      pollLink: async (session: LinkSession): Promise<LinkResult> => {
        assertHost();
        return this.createPlaidClient(session.environment as any,session.secretRef,session.clientRef).getHostedLinkResult(session.linkToken,!!session.itemId);
      },
      completeLink: async (session: LinkSession, result: LinkResult, requestId: string): Promise<void> => {
        assertHost();
        if (this.deviceState.items.some(item=>item.linkRequestId===requestId)) return;
        if (session.itemId) {
          const item=this.deviceState.items.find(item=>item.localItemId===session.itemId);
          if (!item) throw new Error('Connection no longer exists.');
          item.linkRequestId=requestId;
        } else {
          if (!result.publicToken) throw new Error('Plaid did not return a public token.');
          const exchange=await this.createPlaidClient(session.environment as any,session.secretRef,session.clientRef).exchangePublicToken(result.publicToken);
          this.deviceState.items.push({localItemId:createLocalId('finance-item'),providerItemId:exchange.itemId,accessToken:exchange.accessToken,
            institutionName:result.institutionName||'Institution',cursor:'',lastSyncAt:'',lastInvestmentTransactionSyncAt:'',environment:session.environment as any,
            plaidClientIdSecretName:session.clientRef,plaidSecretName:session.secretRef,linkRequestId:requestId});
        }
        this.saveDeviceState(); // Persist the token and receipt before acknowledging the request or importing notes.
      },
      hasCompleted: (requestId: string) => { assertHost(); return this.deviceState.items.some(item=>item.linkRequestId===requestId); },
      importWallet: async (parts: unknown[]) => {
        assertHost();
        if (this.settingsWriter) await this.saveSettings();
        this.assertPropertyMigrationComplete();
        if (this.syncing) throw new Error('TPS Finances is already syncing.');
        if (this.settings.recordMode !== 'atomic-note') throw new Error('Choose Atomic note storage in Finances before importing Apple Wallet.');
        const batch = parseWalletParts(parts);
        // Wallet account/transaction identities are stable on the one paired iPhone.
        // Never infer removal from a missing account or a limited consent window.
        this.syncing = true;
        try {
          const store = this.createStore();
          await store.ensureStructure();
          const paths = await store.upsertAccounts(batch.accounts);
          const identityMap: Record<string, string> = {};
          for (const transaction of batch.transactions) identityMap[`transaction:${transaction.providerTransactionId}`] = transaction.financeId;
          for (const provider of batch.removed) identityMap[`transaction:${provider}`] = walletTransactionID(provider.slice('financekit:'.length));
          await store.applyTransactions(batch.transactions, [], batch.removed, {plaidUserId: '', items: [], providerIdentityMap: identityMap}, paths);
          logger.flow('Wallet', 'import-complete', {accounts: batch.accounts.length, transactions: batch.transactions.length, removed: batch.removed.length});
        } finally { this.syncing = false; }
        await this.refreshDashboard();
      },
      sync: async () => { assertHost(); if (this.settingsWriter) await this.saveSettings(); await this.syncLocal('controller'); },
      disconnect: async (itemId: string) => { assertHost(); await this.disconnectLocal(itemId); },
    };
  }

  getPlaidSetupStatus(): PlaidSetupStatus {
    const relay=this.getRelayStatus();
    if (relay) return {state:relay.enabled?'ready':'missing-credentials',clientIdConfigured:relay.enabled,secretConfigured:relay.enabled,connectedItems:this.getConnectedItems().length};
    const provider = this.controllerPlaid(false);
    if (!provider) return { state: "missing-credentials", clientIdConfigured: false, secretConfigured: false, connectedItems: this.deviceState.items.length };
    provider.getConfiguration(this.settings);
    return { ...provider.inspect(), connectedItems: this.deviceState.items.length };

  }

  openConnectionSettings(): void {
    const controller = (this.app as any).plugins?.plugins?.["tps-controller"]?.api;
    if (typeof controller?.openConnectionSettings === "function") controller.openConnectionSettings("finance");
    else new Notice("Enable or update TPS Controller to 2.6.0+ to manage connections.");
  }

  runConnectPlaid(source: "command" | "settings"): Promise<void> {
    return this.runUserAction("Connect", source, () => this.connectPlaid());
  }

  runSync(reason: string): Promise<void> {
    return this.runUserAction("Sync", reason, () => this.syncAll(reason));
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

  async connectPlaid(): Promise<void> {
    if (await this.requestFinance('connect')) return;
    assertLocalPlaidLinkAvailable();
    try {
      const config = this.getPlaidConfiguration();
      const client = this.createPlaidClient(config.plaidEnvironment, config.plaidSecretSecret, config.plaidClientIdSecret);
      logger.flow("Connect", "start", { environment: config.plaidEnvironment, credentialStatus: "ready" });
      const linkToken = await client.createLinkToken(this.deviceState.plaidUserId, this.settings.transactionHistoryDays, config.oauthRedirectUri);
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
        environment: config.plaidEnvironment,
        plaidClientIdSecretName: config.plaidClientIdSecret,
        plaidSecretName: config.plaidSecretSecret,
      };
      this.deviceState.items.push(item);
      this.saveDeviceState();
      logger.flow("Connect", "done", { institution: item.institutionName, connectedItems: this.deviceState.items.length });
      new Notice(`${item.institutionName} connected. Syncing finances…`);
      const syncWasAlreadyRunning = this.syncing;
      await this.syncAll("connect");
      if (syncWasAlreadyRunning) await this.refreshDashboard();
    } catch (error) {
      logger.failure("Connect", "failed", error, { environment: this.getPlaidConfiguration().plaidEnvironment });
      throw error;
    }
  }

  async reconnectItem(localItemId: string): Promise<void> {
    if (await this.requestFinance('reconnect',localItemId)) return;
    assertLocalPlaidLinkAvailable();
    if(this.syncing) throw new Error("Wait for the current sync to finish.");
    const item=this.deviceState.items.find(i=>i.localItemId===localItemId);
    if(!item) throw new Error("Connection no longer exists.");
    const client=this.createPlaidClient(item.environment, item.plaidSecretName, item.plaidClientIdSecretName);
    const token=await client.createUpdateLinkToken(this.deviceState.plaidUserId,item.accessToken,this.getPlaidConfiguration().oauthRedirectUri);
    await openLocalPlaidLink(token,true);
    // Update mode retains the existing Item, access token, identities and cursor.
    await this.syncAll("reconnect");
  }

  runReconnectItem(localItemId: string): Promise<void> {
    return this.runUserAction("Reconnect", "settings", () => this.reconnectItem(localItemId));
  }

  async disconnectItem(localItemId: string): Promise<void> {
    if (await this.requestFinance('disconnect',localItemId)) return;
    return this.disconnectLocal(localItemId);
  }

  private async disconnectLocal(localItemId: string): Promise<void> {
    const item = this.deviceState.items.find((candidate) => candidate.localItemId === localItemId);
    if (!item) return;
    const client = this.createPlaidClient(item.environment, item.plaidSecretName, item.plaidClientIdSecretName);
    logger.flow("Disconnect", "start", { institution: item.institutionName });
    try {
      try { await client.removeItem(item.accessToken); }
      catch (error) { if ((error as {code?:string}).code !== 'ITEM_NOT_FOUND') throw error; }
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
    this.assertPropertyMigrationComplete();
    if (await this.requestFinance('sync')) return;
    return this.syncLocal(reason);
  }

  private async syncLocal(reason: string): Promise<void> {
    this.assertPropertyMigrationComplete();
    if (this.syncing) {
      if (reason === "controller") throw new Error("TPS Finances is already syncing. Try again shortly.");
      new Notice("TPS Finances is already syncing.");
      return;
    }
    if (!this.deviceState.items.length) {
      if (reason === "controller") return;
      throw new Error("Connect an institution before syncing TPS Finances.");
    }
    this.syncing = true;
    const started = Date.now();
    const store = this.createStore();
    const timed = async <T>(phase: string, work: () => Promise<T>): Promise<T> => {
      const begin = Date.now();
      let completed = false;
      try {
        const value = await work();
        completed = true;
        return value;
      } finally {
        logger.flow("Sync", "phase", { phase, completed, durationMs: Date.now() - begin });
      }
    };
    const allAccounts: FinanceAccount[] = [];
    const allHoldings: FinanceHolding[] = [];
    const failures: Array<{ institution: string; error: unknown }> = [];
    const optionalWarnings: OptionalInvestmentWarning[] = [];
    let transactionChanges = 0;
    logger.flow("Sync", "start", { reason, itemCount: this.deviceState.items.length });
    try {
      await timed("storage-setup", () => store.ensureStructure());
      await timed("legacy-migration", () => this.migrateLegacyTransactions(store));
      const previousSnapshot = await this.readLatestSnapshotDocument();
      const previousAccounts = this.readAccountsFromVault(previousSnapshot);
      const previousHoldings = this.parseSnapshotHoldings(previousSnapshot, previousAccounts);
      for (const item of this.deviceState.items) {
        try {
          const client = this.createPlaidClient(item.environment, item.plaidSecretName, item.plaidClientIdSecretName);
          const accounts = await timed("accounts-fetch", () => client.getAccounts(item, this.deviceState));
          const accountPaths = await timed("account-notes", () => store.upsertAccounts(accounts));
          const patch = await timed("transactions-fetch", () => client.syncTransactions(item, this.deviceState));
          this.saveDeviceState();
          const applied = await timed("transaction-notes", () => store.applyTransactions(patch.added, patch.modified, patch.removedProviderIds, this.deviceState, accountPaths));
          item.cursor = patch.nextCursor;
          item.lastSyncAt = new Date().toISOString();
          this.saveDeviceState();
          allAccounts.push(...accounts);
          transactionChanges += applied.added + applied.modified + applied.removed;

          const range = investmentDateRange(item.lastInvestmentTransactionSyncAt, this.settings.transactionHistoryDays);
          const investmentResult = await timed("investment-history-fetch", () => client.getInvestmentTransactions(item, this.deviceState, range.start, range.end));
          if (investmentResult.status === "ok") this.saveDeviceState();
          const investmentApplied = await applyInvestmentTransactionResult(
            investmentResult,
            item.lastInvestmentTransactionSyncAt,
            new Date().toISOString(),
            (transactions) => timed("investment-notes", () => store.replaceInvestmentTransactions(transactions, accountPaths)),
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

          const holdingsResult = await timed("holdings-fetch", () => client.getHoldings(item, this.deviceState));
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
        const accountPaths = new Map(await this.accountPathEntries());
        await timed("holding-notes", () => store.writeSnapshot(allAccounts, allHoldings, accountPaths, new Date()));
      }
      await timed("dashboard", () => this.refreshDashboard());
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
        if (reason === "controller") throw first.error;
        new Notice(`TPS Finances could not sync ${first.institution}: ${userFacingError(first.error)}${more}.${optional}`, 12000);
      }
      else {
        const summary = `TPS Finances synced ${allAccounts.length} accounts and ${transactionChanges} transaction changes.`;
        if (reason !== "controller") new Notice(optionalWarnings.length ? `${summary} ${optionalInvestmentWarningSummary(optionalWarnings)}` : summary, optionalWarnings.length ? 12000 : 5000);
      }
    } catch (error) {
      logger.failure("Sync", "failed", error, { reason });
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  async getDashboardModel(): Promise<DashboardModel> {
    const snapshot = await this.readLatestSnapshotDocument();
    const accountLabels = new Map<string, AccountLabel>();
    const accounts = this.readAccountsFromVault(snapshot, accountLabels);
    const holdings = this.parseSnapshotHoldings(snapshot, accounts);
    const store = this.createStore();
    // Manual records are always atomic notes, also when provider logging uses atomic lines.
    const transactionStore = accounts.some(account => account.manual) && this.settings.recordMode === "atomic-line"
      ? new AtomicFinanceStore(this.app, this.settings.financeFolder) : store;
    const transactionRecords = await transactionStore.readTransactionRecords();
    const rules = store.readRules();
    const classifyForDashboard = prepareTransactionClassifier(rules);
    const transactions = transactionRecords.map((record) => parseDashboardTransaction(record.line, record.path, record.lineNumber)).filter((value): value is DashboardTransaction => value !== null)
      .map((transaction) => {
        const accountLabel = accountLabels.get(transaction.accountPath);
        const resolved = accountLabel ? { ...transaction, account: accountLabel.display, accountSearchText: accountLabel.search } : transaction;
        const classification = classifyForDashboard(resolved);
        return { ...resolved, category: classification.category, tags: classification.tags, categorySource: classification.source, ruleId: classification.ruleId };
      }).sort((left, right) => right.date.localeCompare(left.date));
    applyManualCashBalances(accounts, transactions);
    const month = localDate(new Date()).slice(0, 7);
    const budgetEntries = await store.readBudgetEntries();
    const budgets = calculateMonthlyBudgetProgress(budgetEntries.filter(budget=>budgetBucket(budget)==="category" && budgetCurrency(budget)==="USD"), transactions, month);
    const lastSyncAt = this.getConnectedItems().map((item) => item.lastSyncAt).filter(Boolean).sort().at(-1) || "";
    return {
      accounts,
      holdings,
      transactions,
      budgets,
      budgetEntries,
      lastSyncAt,
      connectedItems: this.getConnectedItems().length,
      relayMessage: this.getRelayStatus()?.message,
      plaidSetupState: this.getPlaidSetupStatus().state,
    };
  }

  addManualAccount(kind: "cash" | "asset"): void {
    new ManualAccountModal(this.app, kind, async input => {
      const file = await new ManualFinanceStore(this.app, this.settings.financeFolder).createAccount(input);
      logger.flow("Manual", "account-created", {kind});
      await this.app.workspace.getLeaf("tab").openFile(file);
      await this.refreshDashboard();
    }).open();
  }

  async addCashTransaction(): Promise<void> {
    const model = await this.getDashboardModel();
    if (!model.accounts.some(a => a.manual && a.type === "depository" && a.subtype === "cash")) {
      new Notice("Create a cash account first using Add → Cash account.");
      return;
    }
    new CashTransactionModal(this.app, model.accounts, async input => {
      await new ManualFinanceStore(this.app, this.settings.financeFolder).createCashEntry(input);
      logger.flow("Manual", "cash-entry-created", {kind: input.kind});
      new Notice("Cash transaction recorded.");
      await this.refreshDashboard();
    }).open();
  }

  updateAssetValue(account: FinanceAccount): void {
    new AssetValueModal(this.app, account, async (value, date) => {
      await new ManualFinanceStore(this.app, this.settings.financeFolder).updateValue(account.path || "", value, date);
      logger.flow("Manual", "asset-value-updated");
      await this.refreshDashboard();
    }).open();
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

  addMonthlyBudget(bucket: BudgetBucket = "income", currency = "USD"): void {
    void this.openBudgetEditor({id:createLocalId("finance-budget"),name:bucket==="flex"?"Flexible spending":"",category:"",monthlyLimit:NaN,bucket,currency});
  }

  editMonthlyBudget(budget: FinanceBudget): void { void this.openBudgetEditor(budget); }

  private budgetSave: Promise<unknown> = Promise.resolve();
  private async openBudgetEditor(budget: FinanceBudget): Promise<void> {
    try {
      const model = await this.getDashboardModel();
      const categories=Array.from(new Set(model.transactions.map(transaction=>transaction.category).filter(Boolean))).sort();
      new FinanceBudgetModal(this.app,budget,model.accounts,categories,async input=>{
        const save=this.budgetSave.catch(()=>{}).then(async()=>{
          const store=this.createStore();
          await store.ensureStructure();
          await store.saveBudgetEntry(input,budget.sourcePath?budget:undefined);
          logger.flow("Budget",budget.sourcePath?"updated":"created",{bucket:budgetBucket(input),currency:budgetCurrency(input)});
        });
        this.budgetSave=save;
        await save;
        await this.refreshDashboard();
      }).open();
    } catch(error) { new Notice(`Could not open budget: ${error instanceof Error?error.message:String(error)}`); }
  }

  editTransactionClassification(transaction: DashboardTransaction): void {
    new TransactionClassificationModal(this.app, transaction, async (category, tags) => {
      const store = transaction.manual ? new AtomicFinanceStore(this.app, this.settings.financeFolder) : this.createStore();
      const updated = await store.updateTransactionMetadata(transaction.financeId, category, tags);
      if (!updated) throw new Error("The transaction could not be found in its daily note.");
      logger.flow("Classification", "transaction-updated", { source: category ? "manual" : "automatic", tagCount: tags.length });
      new Notice(category || tags.length ? "Transaction classification saved." : "Transaction returned to automatic classification.");
      await this.refreshDashboard();
    }).open();
  }

  async openFinanceBase(name: "Rules" | "Budgets"): Promise<void> {
    const path = financePath(this.settings.financeFolder, "", `${name}.base`);
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
        ? "Plaid setup needs attention: choose separate client ID and environment secrets in TPS Controller settings."
        : model.plaidSetupState === "ready"
          ? "Plaid credentials are ready. Connect an institution to see your financial snapshot."
          : "Add Plaid credentials in TPS Controller settings, then connect an institution.";
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
    if (this.settings.recordMode === "atomic-note") return;
    const editor = (leaf.view as any)?.editor;
    if (editor) {
      editor.setCursor({ line: transaction.sourceLine, ch: 0 });
      editor.scrollIntoView?.({ from: { line: transaction.sourceLine, ch: 0 }, to: { line: transaction.sourceLine + 1, ch: 0 } }, true);
      editor.focus?.();
    }
  }

  private controllerPlaid(required = true): any {
    const service = (this.app as any).plugins?.plugins?.["tps-controller"]?.api?.plaid;
    if (service?.version === 1 && typeof service.request === "function") return service;
    if (required) throw new Error("Enable or update TPS Controller to use Plaid. Manual finance records remain available.");
    return null;
  }

  getPlaidConfiguration() {
    return this.controllerPlaid(false)?.getConfiguration(this.settings) || this.settings;
  }

  private createPlaidClient(environment: TPSFinancesSettings["plaidEnvironment"], secretRef?: string, clientRef?: string): PlaidClient {
    const provider = this.controllerPlaid();
    provider.getConfiguration(this.settings);
    return new PlaidClient((path, body) => provider.request(environment, path, body, clientRef, secretRef));
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
    this.assertPropertyMigrationComplete();
    if (this.settings.recordMode === "atomic-note") return new AtomicFinanceStore(this.app, this.settings.financeFolder);
    return new FinanceStore(
      this.app,
      this.settings.financeFolder,
      (file, mutator) => this.processFinanceFrontmatter(file, mutator),
      (isoDate) => this.ensureFinanceDailyNote(isoDate),
      (context) => this.resolveFinanceTransactionTarget(context.date, context.accountPath),
    );
  }

  async reviewTransactionTitles(includeEmptyProperties = false): Promise<void> {
    const store = new AtomicFinanceStore(this.app, this.settings.financeFolder);
    new TransactionTitleModal(this.app, await store.reviewTransactionTitles(includeEmptyProperties), store, () => this.refreshDashboard(), includeEmptyProperties).open();
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
    const frontmatter = accountFile instanceof TFile ? financeProperties(this.app).cache(this.app, accountFile) || {} : {};
    const override = frontmatter.transactionLogTarget === "account-note" || frontmatter.transactionLogTarget === "daily-note"
      ? frontmatter.transactionLogTarget as TransactionLogTarget
      : null;
    const target = immediateOverride || override || this.settings.transactionLogTarget;
    if (target === "account-note" && accountFile instanceof TFile) return accountFile;
    return this.ensureFinanceDailyNote(date);
  }

  async setRecordMode(mode: "atomic-note" | "atomic-line"): Promise<void> {
    this.assertPropertyMigrationComplete();
    if(this.syncing)throw new Error("Wait for the current sync to finish.");
    if(mode==="atomic-line")await new AtomicFinanceStore(this.app,this.settings.financeFolder).restoreLineBases();
    this.settings.recordMode=mode;
    await this.saveSettings();
    await this.createStore().ensureStructure();
    await this.refreshDashboard();
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

  private async prepareFinanceStorage(): Promise<void> {
    await this.ensureFinanceStructure();
    if (this.settings.recordMode !== "atomic-note") await this.migrateLegacyTransactions(this.createStore());
  }

  private async migrateLegacyTransactions(store: FinanceStore): Promise<void> {
    try {
      const result = await store.migrateLegacyTransactionLedgers();
      if (this.settings.recordMode === "atomic-note" && result.skipped) throw new Error(`${result.skipped} legacy transactions need review before syncing atomic notes.`);
      if (result.moved || result.skipped) logger.flow("Storage", "daily-note-migration", result);
      if (result.moved) new Notice(`Migrated ${result.moved} finance transaction${result.moved === 1 ? "" : "s"}.`);
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
    if (typeof gcmApi?.frontmatter?.process === "function") return gcmApi.frontmatter.process(file, (raw: Record<string, unknown>) => financeProperties(this.app).mutate(raw, mutator));
    if (typeof gcmApi?.processFrontmatter === "function") return gcmApi.processFrontmatter(file, mutator);
    return financeProperties(this.app).process(this.app, file, mutator);
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
        const root = financePrefix(this.settings.financeFolder);
        return this.isFinanceRecord(file) || Boolean(root && file.path.startsWith(root));
      },
      onClick: () => this.openDashboard(),
    });
  }

  private loadControllerState(allowCreate = false): void {
    const stored=this.app.secretStorage.getSecret(DEVICE_STATE_SECRET);
    if (!stored) {
      if (!allowCreate || this.app.loadLocalStorage?.('tps-finances-controller-state')) throw new Error('Controller bank state is missing. Restore its SecretStorage before continuing.');
      this.saveDeviceState();
    } else {
      const raw=JSON.parse(stored);
      if (!raw.plaidUserId || !Array.isArray(raw.items) || !raw.providerIdentityMap || typeof raw.providerIdentityMap !== 'object'
        || raw.items.some((item: any)=>!item.localItemId || !item.providerItemId || !item.accessToken)) throw new Error('Controller bank state is invalid. Restore its SecretStorage before continuing.');
      this.deviceState=this.loadDeviceState();
    }
    this.app.saveLocalStorage?.('tps-finances-controller-state',true);
  }

  private loadDeviceState(): DeviceState {
    const stored = this.app.secretStorage.getSecret(DEVICE_STATE_SECRET);
    if (!stored) return emptyDeviceState();
    try {
      const parsed = JSON.parse(stored) as Partial<DeviceState>;
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      const normalized = normalizeDeviceItems(rawItems, this.getPlaidConfiguration().plaidClientIdSecret, this.getPlaidConfiguration().plaidSecretSecret);
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

  private readAccountsFromVault(
    snapshot: StoredFinanceSnapshot | null,
    accountLabels?: Map<string, AccountLabel>,
  ): FinanceAccount[] {
    const prefix = financePrefix(this.settings.financeFolder, "Accounts");
    const balances = this.parseSnapshotBalanceMap(snapshot?.lines || []);
    const accounts: FinanceAccount[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const frontmatter = financeProperties(this.app).cache(this.app, file) || {};
      if (!this.settings.financeFolder && frontmatter.kind !== "account") continue;
      if (accountLabels) {
        const institution = String(frontmatter.institution || "");
        const name = String(frontmatter.accountName || frontmatter.title || file.basename);
        const mask = String(frontmatter.accountMask || "");
        accountLabels.set(file.path.replace(/\.md$/i, ""), {
          display: `${name}${mask ? ` •${mask}` : ""}`,
          search: [institution, name, mask, file.basename].filter(Boolean).join(" "),
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
        name: String(frontmatter.accountName || frontmatter.title || file.basename),
        officialName: "",
        mask: String(frontmatter.accountMask || ""),
        type: String(frontmatter.accountType || ""),
        subtype: String(frontmatter.accountSubtype || ""),
        currency: String(frontmatter.currency || balance?.currency || "USD"),
        available: this.settings.recordMode === "atomic-note" && "available" in frontmatter ? atomicNumber(frontmatter.available) : balance?.available ?? null,
        current: (this.settings.recordMode === "atomic-note" || frontmatter.financeSource === "manual") && "current" in frontmatter ? atomicNumber(frontmatter.current) : balance?.balance ?? null,
        limit: this.settings.recordMode === "atomic-note" ? atomicNumber(frontmatter.limit) : null,
        manual: frontmatter.financeSource === "manual",
        openingBalance: "openingBalance" in frontmatter ? Number(frontmatter.openingBalance) : undefined,
        valuationDate: String(frontmatter.valuationDate || ""),
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

  private parseSnapshotHoldings(snapshot: StoredFinanceSnapshot | null, accounts: FinanceAccount[]): FinanceHolding[] {
    if(this.settings.recordMode === "atomic-note") {
      const notes=this.app.vault.getMarkdownFiles().filter(file=>file.path.startsWith(financePrefix(this.settings.financeFolder, "Holdings")))
        .map(file=>financeProperties(this.app).cache(this.app, file)||{}).filter(fm=>fm.type==="holding");
      if(notes.length) return notes.filter(fm=>fm.active===true).map(fm=>({
        financeAccountId:String(fm.financeAccountId),securityId:String(fm.securityId),name:String(fm.name||""),ticker:String(fm.ticker||""),type:String(fm.holdingType||""),quantity:Number(fm.quantity)||0,price:Number(fm.price)||0,value:Number(fm.value)||0,costBasis:atomicNumber(fm.costBasis),currency:String(fm.currency||"USD"),asOf:String(fm.asOf||""),stale:fm.stale===true
      }));
    }

    if (!snapshot) return [];
    const pathToId = new Map<string, string>();
    for (const account of accounts) {
      if (account.path) pathToId.set(account.path.replace(/\.md$/i, ""), account.financeAccountId);
    }
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

  private async readLatestSnapshotDocument(): Promise<StoredFinanceSnapshot | null> {
    const file = this.latestSnapshotFile();
    if (!file) return null;
    const date = String(financeProperties(this.app).cache(this.app, file)?.date || file.basename);
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

  private latestSnapshotFile(): TFile | null {
    const prefix = financePrefix(this.settings.financeFolder, "Snapshots");
    let latest: TFile | null = null;
    let latestDate = "";
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = financeProperties(this.app).cache(this.app, file);
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
    financeFolder: normalizeFinanceFolder(source.financeFolder, DEFAULT_SETTINGS.financeFolder),
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

function atomicNumber(value: unknown): number | null {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
}
