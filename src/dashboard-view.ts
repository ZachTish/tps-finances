import { ItemView, Menu, Notice, Platform, WorkspaceLeaf, setIcon } from "obsidian";
import { renderBudgetView, type BudgetViewState } from "./budget-view";
import type { BudgetBucket } from "./flex-budget";
import { accountSummaries } from "./finance-summary";
import type { FinanceAccount, FinanceBudget, FinanceHolding, PlaidSetupState } from "./types";

export const TPS_FINANCES_VIEW_TYPE = "tps-finances";

export interface DashboardTransaction {
  financeId: string;
  manual?: boolean;
  transferAccount?: string;
  date: string;
  name: string;
  account: string;
  accountPath: string;
  accountSearchText: string;
  amount: number;
  currency: string;
  pending: boolean;
  category: string;
  categoryOverride: string;
  providerCategory: string;
  categorySource: "manual" | "rule" | "provider" | "uncategorized";
  merchant: string;
  tags: string[];
  manualTags: string[];
  ruleId: string;
  subtype: string;
  type: "transaction" | "investmentTransaction";
  investmentType?: string;
  sourcePath: string;
  sourceLine: number;
}

export interface BudgetProgress {
  id: string;
  name: string;
  category: string;
  monthlyLimit: number;
  spent: number;
}

export interface DashboardModel {
  accounts: FinanceAccount[];
  holdings: FinanceHolding[];
  transactions: DashboardTransaction[];
  lastSyncAt: string;
  connectedItems: number;
  plaidSetupState: PlaidSetupState;
  relayMessage?: string;
  budgets: BudgetProgress[];
  budgetEntries?: FinanceBudget[];
}

interface FinancesViewPlugin {
  settings?: {recordMode: string};
  getDashboardModel(): Promise<DashboardModel>;
  canConnectPlaid?(): boolean;
  connectPlaid(): Promise<void>;
  syncAll(reason: string): Promise<void>;
  openTransactionSource(transaction: DashboardTransaction): Promise<void>;
  editTransactionClassification(transaction: DashboardTransaction): void;
  addManualAccount(kind: "cash" | "asset"): void;
  addCashTransaction(): Promise<void>;
  updateAssetValue(account: FinanceAccount): void;
  addCategorizationRule(): void;
  addMonthlyBudget(bucket?: BudgetBucket, currency?: string): void;
  editMonthlyBudget(budget: FinanceBudget): void;
  openFinanceBase(name: "Rules" | "Budgets"): Promise<void>;
  setAccountTransactionLogTarget(account: FinanceAccount, target: "default" | "daily-note" | "account-note"): Promise<void>;
}

export class TPSFinancesView extends ItemView {
  private renderRequested = false;
  private renderPromise: Promise<void> | null = null;
  private closed = false;
  private route: "overview" | "budget" = "overview";
  private readonly budgetState: BudgetViewState = {month:`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`,currency:"USD",expanded:new Set()};

  async showBudget(): Promise<void> { this.route="budget"; await this.render(); }

  constructor(leaf: WorkspaceLeaf, private readonly plugin: FinancesViewPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TPS_FINANCES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "TPS Finances";
  }

  getIcon(): string {
    return "landmark";
  }

  async onOpen(): Promise<void> {
    this.closed = false;
    this.contentEl.addClass("tps-finances-view");
    await this.render();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.renderRequested = false;
  }

  render(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.renderRequested = true;
    if (!this.renderPromise) {
      this.renderPromise = Promise.resolve().then(() => this.drainRenderRequests());
    }
    return this.renderPromise;
  }

  private async drainRenderRequests(): Promise<void> {
    try {
      while (!this.closed && this.renderRequested) {
        this.renderRequested = false;
        try {
          const model = await this.plugin.getDashboardModel();
          if (this.closed || this.renderRequested) continue;
          const scroll = this.contentEl.scrollTop;
          const focused = this.contentEl.ownerDocument?.activeElement;
          const focusKey = focused?.getAttribute("data-budget-focus");
          this.contentEl.empty();
          const root = this.contentEl.createDiv({ cls: `tps-finances-root${this.route === "budget" ? " tps-finances-root--budget" : ""}` });
          this.renderHeader(root, model);
          const navigation = root.createDiv({cls:"tps-finances-view-routes",attr:{"aria-label":"Finance pages"}});
          for (const [route,label] of [["overview","Overview"],["budget","Budget"]] as const) {
            const button=navigation.createEl("button",{type:"button",text:label,attr:{"aria-pressed":String(this.route===route),"data-budget-focus":route}});
            button.addEventListener("click",()=>{this.route=route;void this.render();});
          }
          if (model.relayMessage) root.createDiv({cls:"tps-finances-status",text:model.relayMessage});
          if (this.route === "budget") {
            renderBudgetView(root,model,this.budgetState,{
              render:()=>void this.render(),add:(bucket,currency)=>this.plugin.addMonthlyBudget(bucket,currency),
              edit:budget=>this.plugin.editMonthlyBudget(budget),open:transaction=>void this.runAction(()=>this.plugin.openTransactionSource(transaction)),
            });
          } else if (!model.connectedItems && !model.accounts.length) this.renderWelcome(root, model.plaidSetupState);
          else {
            if (model.connectedItems && !model.accounts.length) {
              root.createDiv({
                cls: "tps-finances-status is-warning",
                text: "Plaid is connected, but no account snapshot has synced yet. Run Sync; any provider or credential error will be shown here in Obsidian.",
              });
            }
            const staleHoldings = model.holdings.filter((holding) => holding.stale);
            if (staleHoldings.length) {
              const oldest = staleHoldings.map((holding) => holding.asOf || "").filter(Boolean).sort()[0] || "an earlier sync";
              root.createDiv({
                cls: "tps-finances-status is-warning",
                text: `Investment values include ${staleHoldings.length} last-known holding${staleHoldings.length === 1 ? "" : "s"} as of ${oldest}; core accounts and Transactions are current, and Investments will retry on the next sync.`,
              });
            }
            this.renderSummary(root, model);
            this.renderAccounts(root, model.accounts);
            this.renderHoldings(root, model.holdings);
            this.renderTransactions(root, model.transactions);
          }
          if(focusKey) Array.from(this.contentEl.querySelectorAll<HTMLElement>("[data-budget-focus]")).find(element=>element.getAttribute("data-budget-focus")===focusKey)?.focus({preventScroll:true});
          this.contentEl.scrollTop=scroll;
        } catch (error) {
          if (this.closed || this.renderRequested) continue;
          this.contentEl.empty();
          this.contentEl.createDiv({ cls: "tps-finances-error", text: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      this.renderPromise = null;
    }
  }

  private renderHeader(root: HTMLElement, model: DashboardModel): void {
    const header = root.createDiv({ cls: "tps-finances-header" });
    const title = header.createDiv({ cls: "tps-finances-title" });
    title.createEl("h1", { text: "Finances" });
    title.createEl("small", { text: model.lastSyncAt ? `Updated ${friendlyTime(model.lastSyncAt)}` : "Not synced yet" });
    const actions = header.createDiv({ cls: "tps-finances-actions" });
    const add = actionButton("plus", "Add", () => {
      const menu = new Menu();
      menu.addItem(item => item.setTitle("Cash account").setIcon("wallet").onClick(() => this.plugin.addManualAccount("cash")));
      menu.addItem(item => item.setTitle("Cash transaction").setIcon("receipt-text").onClick(() => void this.runAction(() => this.plugin.addCashTransaction())));
      menu.addItem(item => item.setTitle("Resale asset").setIcon("house").onClick(() => this.plugin.addManualAccount("asset")));
      const rect = add.getBoundingClientRect();
      menu.showAtPosition({x: rect.left, y: rect.bottom});
    });
    actions.appendChild(add);
    actions.appendChild(actionButton("wand-sparkles", "Rule", () => this.plugin.addCategorizationRule()));
    const connect = actionButton("link", "Connect", () => void this.runAction(() => this.plugin.connectPlaid()));
    connect.disabled = this.plugin.canConnectPlaid ? !this.plugin.canConnectPlaid() : !Platform.isDesktopApp || Platform.isMobile;
    if (connect.disabled) connect.title = "Pair with the finance Controller in TPS Controller settings";
    actions.appendChild(connect);
    actions.appendChild(actionButton("refresh-cw", "Sync", () => void this.runAction(() => this.plugin.syncAll("dashboard"))));
  }

  private renderWelcome(root: HTMLElement, setupState: PlaidSetupState): void {
    const welcome = root.createDiv({ cls: "tps-finances-welcome" });
    const icon = welcome.createDiv({ cls: "tps-finances-welcome-icon" });
    setIcon(icon, "landmark");
    welcome.createEl("h2", { text: "Add cash or assets, or connect an institution" });
    const detail = this.plugin.canConnectPlaid?.() && (!Platform.isDesktopApp || Platform.isMobile)
      ? "Connect through your paired Controller. Bank sign-in opens in your browser."
      : (!Platform.isDesktopApp || Platform.isMobile)
      ? "Add cash accounts and transactions here, or connect Plaid on desktop and sync the finance notes with your vault."
      : setupState === "conflicting-credentials"
      ? "Plaid client ID and Plaid secret currently use the same Obsidian secret. Select two different secrets in TPS Controller settings before connecting."
      : setupState === "ready"
        ? "Plaid credentials are ready. Connect an institution to begin syncing accounts and transactions."
        : "Add separate Plaid client ID and environment secrets in TPS Controller settings, then connect an institution.";
    welcome.createEl("p", { text: detail });
    const connect = actionButton("link", "Connect with Plaid", () => void this.runAction(() => this.plugin.connectPlaid()), true);
    connect.disabled = this.plugin.canConnectPlaid ? !this.plugin.canConnectPlaid() : !Platform.isDesktopApp || Platform.isMobile;
    welcome.appendChild(connect);
  }

  private renderSummary(root: HTMLElement, model: DashboardModel): void {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    for (const summary of accountSummaries(model.accounts, model.holdings)) {
      const grid = root.createDiv({ cls: "tps-finances-summary" });
      metric(grid, "Net worth", summary.netWorth, "wallet-cards", summary.currency);
      metric(grid, "Cash", summary.cash, "banknote", summary.currency);
      metric(grid, "Investments", summary.investments, "chart-no-axes-combined", summary.currency);
      if (summary.assets) metric(grid, "Resale assets", summary.assets, "house", summary.currency);
      metric(grid, "Debt", summary.debt, "credit-card", summary.currency);
      const transactions = model.transactions.filter(t => t.currency === summary.currency && t.date.startsWith(month));
      metric(grid, "Spent this month", -transactions.filter(t => isSpendingTransaction(t)).reduce((n,t) => n+t.amount,0), "arrow-up-right", summary.currency);
      metric(grid, "Income this month", transactions.filter(t => t.amount > 0 && t.type === "transaction" && t.subtype === "income").reduce((n,t) => n+t.amount,0), "arrow-down-left", summary.currency);
    }
  }

  private renderAccounts(root: HTMLElement, accounts: FinanceAccount[]): void {
    const section = sectionEl(root, "Accounts", "landmark");
    const grid = section.createDiv({ cls: "tps-finances-account-grid" });
    for (const account of accounts) {
      const card = grid.createDiv({ cls: "tps-finances-account-card" });
      card.createEl("small", { text: account.institutionName });
      card.createEl("strong", { text: `${account.name}${account.mask ? ` •${account.mask}` : ""}` });
      card.createDiv({ cls: "tps-finances-account-balance", text: money(account.current || 0, account.currency) });
      card.createEl("span", { text: [account.type, account.subtype].filter(Boolean).join(" · ") });
      if (account.manual) {
        card.createEl("small", {text: account.type === "other" ? `Valued ${account.valuationDate || "—"}` : "Opening balance + cash transactions"});
        card.appendChild(actionButton("file", "Open note", () => { if (account.path) void this.app.workspace.openLinkText(account.path, ""); }));
        if (account.type === "other") card.appendChild(actionButton("pencil", "Update value", () => this.plugin.updateAssetValue(account)));
        continue;
      }
      if (this.plugin.settings?.recordMode === "atomic-note") {
        card.createEl("small", {text:"Atomic notes"});
        continue;
      }
      const route = card.createEl("button", {
        cls: "tps-finances-account-route",
        attr: { type: "button", title: "Choose where this account's transactions are logged" },
      });
      const routeIcon = route.createSpan();
      setIcon(routeIcon, account.effectiveTransactionLogTarget === "account-note" ? "landmark" : "calendar-days");
      route.createSpan({ text: account.effectiveTransactionLogTarget === "account-note" ? "Account note" : "Daily notes" });
      if (account.transactionLogTarget === "default") route.createEl("small", { text: "Default" });
      route.addEventListener("click", (event) => this.showAccountRouteMenu(event, account));
    }
    if (!accounts.length) grid.createDiv({ cls: "tps-finances-empty", text: "No account snapshots yet." });
  }

  private showAccountRouteMenu(event: MouseEvent, account: FinanceAccount): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(`Use default (${account.effectiveTransactionLogTarget === "account-note" ? "account note" : "daily notes"})`).setIcon("rotate-ccw")
      .setChecked(account.transactionLogTarget === "default").onClick(() => void this.runAction(() => this.plugin.setAccountTransactionLogTarget(account, "default"))));
    menu.addItem((item) => item.setTitle("Daily notes").setIcon("calendar-days")
      .setChecked(account.transactionLogTarget === "daily-note").onClick(() => void this.runAction(() => this.plugin.setAccountTransactionLogTarget(account, "daily-note"))));
    menu.addItem((item) => item.setTitle("This account note").setIcon("landmark")
      .setChecked(account.transactionLogTarget === "account-note").onClick(() => void this.runAction(() => this.plugin.setAccountTransactionLogTarget(account, "account-note"))));
    menu.showAtMouseEvent(event);
  }

  private renderHoldings(root: HTMLElement, holdings: FinanceHolding[]): void {
    if (!holdings.length) return;
    const section = sectionEl(root, "Investments", "chart-no-axes-combined");
    const list = section.createDiv({ cls: "tps-finances-list" });
    for (const holding of holdings.slice().sort((a, b) => b.value - a.value)) {
      const row = list.createDiv({ cls: "tps-finances-row" });
      const main = row.createDiv({ cls: "tps-finances-row-main" });
      main.createEl("strong", { text: holding.ticker || holding.name });
      main.createEl("small", { text: [
        `${trimNumber(holding.quantity)} shares`,
        money(holding.price, holding.currency),
        holding.stale ? `Last known as of ${holding.asOf || "an earlier sync"}` : "",
      ].filter(Boolean).join(" · ") });
      row.createDiv({ cls: "tps-finances-row-amount", text: money(holding.value, holding.currency) });
    }
  }

  private renderTransactions(root: HTMLElement, transactions: DashboardTransaction[]): void {
    const section = sectionEl(root, "Recent transactions", "receipt-text");
    const list = section.createDiv({ cls: "tps-finances-list" });
    for (const transaction of transactions.slice(0, 80)) {
      const row = list.createDiv({ cls: "tps-finances-row tps-finances-row--clickable" });
      row.tabIndex = 0;
      row.setAttr("role", "button");
      row.setAttr("aria-label", `Open ${transaction.name} at its transaction log source`);
      row.addEventListener("click", () => void this.plugin.openTransactionSource(transaction));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void this.plugin.openTransactionSource(transaction);
        }
      });
      const main = row.createDiv({ cls: "tps-finances-row-main" });
      const name = main.createDiv({ cls: "tps-finances-transaction-name" });
      name.createEl("strong", { text: transaction.name });
      if (transaction.pending) name.createEl("span", { cls: "tps-finances-pending", text: "Pending" });
      main.createEl("small", { text: [transaction.date, transaction.account, humanCategory(transaction.subtype), humanCategory(transaction.category), ...transaction.tags].filter(Boolean).join(" · ") });
      const amount = row.createDiv({ cls: `tps-finances-row-amount ${transaction.amount >= 0 ? "is-positive" : "is-negative"}` });
      amount.setText(money(transaction.amount, transaction.currency, true));
      const edit = row.createEl("button", { cls: "tps-finances-classify-button", attr: { type: "button", "aria-label": `Categorize ${transaction.name}`, title: "Categorize and tag" } });
      setIcon(edit, "tag");
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        this.plugin.editTransactionClassification(transaction);
      });
    }
    if (!transactions.length) list.createDiv({ cls: "tps-finances-empty", text: "No transactions have been synced yet." });
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
}

function actionButton(iconName: string, label: string, action: () => void, primary = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.className = primary ? "tps-finances-button is-primary" : "tps-finances-button";
  const icon = document.createElement("span");
  setIcon(icon, iconName);
  button.append(icon, document.createTextNode(label));
  button.addEventListener("click", action);
  return button;
}

function metric(parent: HTMLElement, label: string, value: number, iconName: string, currency = "USD"): void {
  const card = parent.createDiv({ cls: "tps-finances-metric" });
  const icon = card.createDiv({ cls: "tps-finances-metric-icon" });
  setIcon(icon, iconName);
  card.createEl("small", { text: label });
  card.createEl("strong", { text: money(value, currency) });
}

function sectionEl(parent: HTMLElement, title: string, iconName: string): HTMLElement {
  const section = parent.createEl("section", { cls: "tps-finances-section" });
  const heading = section.createEl("h2");
  const icon = heading.createSpan();
  setIcon(icon, iconName);
  heading.createSpan({ text: title });
  return section;
}

function money(value: number, currency = "USD", sign = false): string {
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2, signDisplay: sign ? "always" : "auto" });
  return formatter.format(value);
}

function trimNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

function friendlyTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function humanCategory(value: string): string {
  return value ? value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()) : "";
}

function isSpendingTransaction(transaction: DashboardTransaction): boolean {
  return transaction.type === "transaction" && ["purchase", "payment", "fee", "cash-advance", "refund"].includes(transaction.subtype);
}
