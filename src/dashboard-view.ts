import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type { FinanceAccount, FinanceHolding, PlaidSetupState } from "./types";

export const TPS_FINANCES_VIEW_TYPE = "tps-finances";

export interface DashboardTransaction {
  financeId: string;
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
  budgets: BudgetProgress[];
}

interface FinancesViewPlugin {
  getDashboardModel(): Promise<DashboardModel>;
  connectPlaid(): Promise<void>;
  syncAll(reason: string): Promise<void>;
  openTransactionSource(transaction: DashboardTransaction): Promise<void>;
  editTransactionClassification(transaction: DashboardTransaction): void;
  addCategorizationRule(): void;
  addMonthlyBudget(): void;
  openFinanceBase(name: "Rules" | "Budgets"): Promise<void>;
  setAccountTransactionLogTarget(account: FinanceAccount, target: "default" | "daily-note" | "account-note"): Promise<void>;
}

export class TPSFinancesView extends ItemView {
  private rendering = false;

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
    this.contentEl.addClass("tps-finances-view");
    await this.render();
  }

  async render(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    try {
      const model = await this.plugin.getDashboardModel();
      this.contentEl.empty();
      const root = this.contentEl.createDiv({ cls: "tps-finances-root" });
      this.renderHeader(root, model);
      if (!model.connectedItems && !model.accounts.length) this.renderWelcome(root, model.plaidSetupState);
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
        this.renderBudgets(root, model.budgets);
        this.renderAccounts(root, model.accounts);
        this.renderHoldings(root, model.holdings);
        this.renderTransactions(root, model.transactions);
      }
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: "tps-finances-error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      this.rendering = false;
    }
  }

  private renderHeader(root: HTMLElement, model: DashboardModel): void {
    const header = root.createDiv({ cls: "tps-finances-header" });
    const title = header.createDiv({ cls: "tps-finances-title" });
    title.createEl("h1", { text: "Finances" });
    title.createEl("small", { text: model.lastSyncAt ? `Updated ${friendlyTime(model.lastSyncAt)}` : "Not synced yet" });
    const actions = header.createDiv({ cls: "tps-finances-actions" });
    actions.appendChild(actionButton("wand-sparkles", "Rule", () => this.plugin.addCategorizationRule()));
    actions.appendChild(actionButton("gauge", "Budget", () => this.plugin.addMonthlyBudget()));
    actions.appendChild(actionButton("link", "Connect", () => void this.runAction(() => this.plugin.connectPlaid())));
    actions.appendChild(actionButton("refresh-cw", "Sync", () => void this.runAction(() => this.plugin.syncAll("dashboard"))));
  }

  private renderBudgets(root: HTMLElement, budgets: BudgetProgress[]): void {
    if (!budgets.length) return;
    const section = sectionEl(root, "Monthly budgets", "gauge");
    const headingActions = section.querySelector("h2")?.createSpan({ cls: "tps-finances-section-actions" });
    const manage = headingActions?.createEl("button", { text: "Manage", attr: { type: "button" } });
    manage?.addEventListener("click", () => void this.plugin.openFinanceBase("Budgets"));
    const grid = section.createDiv({ cls: "tps-finances-budget-grid" });
    for (const budget of budgets) {
      const ratio = budget.monthlyLimit > 0 ? budget.spent / budget.monthlyLimit : 0;
      const card = grid.createDiv({ cls: `tps-finances-budget${ratio > 1 ? " is-over" : ratio >= 0.8 ? " is-close" : ""}` });
      const label = card.createDiv({ cls: "tps-finances-budget-label" });
      label.createEl("strong", { text: humanCategory(budget.category) });
      label.createEl("span", { text: `${money(budget.spent)} of ${money(budget.monthlyLimit)}` });
      const track = card.createDiv({ cls: "tps-finances-budget-track" });
      track.createDiv({ cls: "tps-finances-budget-fill", attr: { style: `width: ${Math.min(100, Math.max(0, ratio * 100))}%` } });
      card.createEl("small", { text: ratio > 1 ? `${money(budget.spent - budget.monthlyLimit)} over` : `${money(budget.monthlyLimit - budget.spent)} remaining` });
    }
  }

  private renderWelcome(root: HTMLElement, setupState: PlaidSetupState): void {
    const welcome = root.createDiv({ cls: "tps-finances-welcome" });
    const icon = welcome.createDiv({ cls: "tps-finances-welcome-icon" });
    setIcon(icon, "landmark");
    welcome.createEl("h2", { text: "Connect your financial accounts" });
    const detail = setupState === "conflicting-credentials"
      ? "Plaid client ID and Plaid secret currently use the same Obsidian secret. Select two different secrets in TPS Finances settings before connecting."
      : setupState === "ready"
        ? "Plaid credentials are ready. Connect an institution to begin syncing accounts and normalized daily-note transaction logs."
        : "Add separate Plaid client ID and environment secrets in TPS Finances settings, then connect an institution.";
    welcome.createEl("p", { text: detail });
    welcome.appendChild(actionButton("link", "Connect with Plaid", () => void this.runAction(() => this.plugin.connectPlaid()), true));
  }

  private renderSummary(root: HTMLElement, model: DashboardModel): void {
    const investmentAccountIds = new Set(model.holdings.map((holding) => holding.financeAccountId));
    const cash = model.accounts
      .filter((account) => !investmentAccountIds.has(account.financeAccountId) && account.current != null)
      .reduce((total, account) => total + (account.current || 0), 0);
    const investments = model.holdings.reduce((total, holding) => total + holding.value, 0);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthTransactions = model.transactions.filter((transaction) => transaction.date.startsWith(monthKey));
    const spending = -monthTransactions.filter((transaction) => transaction.amount < 0 && isSpendingTransaction(transaction)).reduce((total, transaction) => total + transaction.amount, 0);
    const income = monthTransactions.filter((transaction) => transaction.amount > 0 && transaction.type === "transaction" && transaction.subtype === "income").reduce((total, transaction) => total + transaction.amount, 0);
    const grid = root.createDiv({ cls: "tps-finances-summary" });
    metric(grid, "Net worth", cash + investments, "wallet-cards");
    metric(grid, "Cash", cash, "banknote");
    metric(grid, "Investments", investments, "chart-no-axes-combined");
    metric(grid, "Spent this month", spending, "arrow-up-right");
    metric(grid, "Income this month", income, "arrow-down-left");
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
      await this.render();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
}

function actionButton(iconName: string, label: string, action: () => void, primary = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = primary ? "tps-finances-button is-primary" : "tps-finances-button";
  const icon = document.createElement("span");
  setIcon(icon, iconName);
  button.append(icon, document.createTextNode(label));
  button.addEventListener("click", action);
  return button;
}

function metric(parent: HTMLElement, label: string, value: number, iconName: string): void {
  const card = parent.createDiv({ cls: "tps-finances-metric" });
  const icon = card.createDiv({ cls: "tps-finances-metric-icon" });
  setIcon(icon, iconName);
  card.createEl("small", { text: label });
  card.createEl("strong", { text: money(value, "USD") });
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
  return transaction.type === "transaction" && ["purchase", "payment", "fee", "cash-advance"].includes(transaction.subtype);
}
