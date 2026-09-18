import type { FinanceAccount, FinanceBudget } from "./types";
import type { DashboardTransaction } from "./dashboard-view";

export type BudgetBucket = NonNullable<FinanceBudget["bucket"]>;
export const BUDGET_BUCKETS: Record<BudgetBucket, string> = {
  income: "Income", fixed: "Fixed expenses", flex: "Flexible spending", savings: "Savings", category: "Category limit",
};
const normalized = (value: string): string => value.trim().toLocaleLowerCase();
export const accountLinkPath = (value: string): string => value.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].replace(/\.md$/i, "");
export const budgetCurrency = (budget: FinanceBudget): string => (budget.currency || "USD").trim().toUpperCase();
export const budgetBucket = (budget: FinanceBudget): BudgetBucket => budget.bucket || "category";
export const moneyRound = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
export function budgetInputError(budget: FinanceBudget): string {
  if (!budget.name.trim()) return "Enter a name.";
  if (!Number.isFinite(budget.monthlyLimit) || budget.monthlyLimit < 0) return "Enter a monthly amount of zero or more.";
  if (!Object.prototype.hasOwnProperty.call(BUDGET_BUCKETS, budgetBucket(budget))) return "Choose a budget section.";
  if (!/^[A-Z]{3}$/.test(budgetCurrency(budget))) return "Enter a three-letter currency code.";
  if (["fixed", "category"].includes(budgetBucket(budget)) && !budget.category.trim()) return "Choose a category to match.";
  if (budgetBucket(budget) === "savings" && !budget.accounts?.length) return "Choose at least one savings or investment account.";
  return "";
}
export function budgetOverlapError(budget: FinanceBudget, others: readonly FinanceBudget[]): string {
  const bucket = budgetBucket(budget), category = normalized(budget.category);
  for (const other of others) {
    if (other.id === budget.id || budgetCurrency(other) !== budgetCurrency(budget)) continue;
    if (bucket === "flex" && budgetBucket(other) === "flex") return "There is already a flexible spending allowance for this currency. Edit it instead.";
    if (["fixed", "income"].includes(bucket) && bucket === budgetBucket(other) && category && category === normalized(other.category)) return "That category already has a target in this section.";
    if (bucket === "savings" && budgetBucket(other) === "savings" && budget.accounts?.some(path => other.accounts?.map(accountLinkPath).includes(accountLinkPath(path)))) return "An account can belong to only one savings target per currency.";
  }
  return "";
}
export interface BudgetRow {
  budget: FinanceBudget;
  actual: number | null;
  transactions: DashboardTransaction[];
  amounts: Map<string, number>;
  error?: string;
}
export interface FlexBudgetModel {
  month: string;
  currency: string;
  rows: Record<BudgetBucket, BudgetRow[]>;
  planned: Record<BudgetBucket, number>;
  actual: { income: number; fixed: number; flex: number; savings: number };
  unallocated: number;
  flexRemaining: number;
  pendingCount: number;
  uncategorizedCount: number;
  review: DashboardTransaction[];
  errors: string[];
  flexTransactions: DashboardTransaction[];
}

export function buildFlexBudget(
  budgets: readonly FinanceBudget[], transactions: readonly DashboardTransaction[], accounts: readonly FinanceAccount[], month: string, currency: string,
): FlexBudgetModel {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Choose a valid budget month.");
  const model: FlexBudgetModel = {
    month, currency, rows: {income:[], fixed:[], flex:[], savings:[], category:[]},
    planned: {income:0, fixed:0, flex:0, savings:0, category:0}, actual: {income:0, fixed:0, flex:0, savings:0},
    unallocated:0, flexRemaining:0, pendingCount:0, uncategorizedCount:0, review:[], errors:[], flexTransactions:[],
  };
  const accountMap = new Map(accounts.filter(a=>a.path).map(a=>[accountLinkPath(a.path!), a]));
  const current = budgets.filter(b=>budgetCurrency(b)===currency || !/^[A-Z]{3}$/.test(budgetCurrency(b)));
  const ids = new Set<string>();
  for (const budget of current) {
    const bucket = budgetBucket(budget);
    let error = budgetInputError(budget) || budgetOverlapError(budget, current);
    if (ids.has(budget.id)) error = "Duplicate budget identity. Resolve the duplicate notes.";
    ids.add(budget.id);
    if (bucket === "savings" && !error) {
      for (const path of budget.accounts || []) {
        const account = accountMap.get(accountLinkPath(path));
        if (!account || account.currency !== currency || !["depository", "investment", "brokerage"].includes(account.type)) {
          error = "Choose existing savings or investment accounts in this currency."; break;
        }
      }
    }
    const row: BudgetRow = {budget,actual:bucket === "income" && !budget.category.trim() ? null : 0,transactions:[],amounts:new Map(),error};
    if (error) model.errors.push(`${budget.name}: ${error}`);
    (model.rows[bucket] || model.rows.category).push(row);
    if (!error) model.planned[bucket] += budget.monthlyLimit;
  }
  const validRows = (bucket: BudgetBucket): BudgetRow[] => model.rows[bucket].filter(row=>!row.error);
  const fixed = new Map(validRows("fixed").map(row=>[normalized(row.budget.category),row]));
  const income = new Map(validRows("income").filter(row=>row.budget.category.trim()).map(row=>[normalized(row.budget.category),row]));
  const savings = new Map(validRows("savings").flatMap(row=>(row.budget.accounts || []).map(path=>[accountLinkPath(path),row] as const)));
  const categoryRows = new Map<string, BudgetRow[]>();
  for (const row of validRows("category")) {
    const key = normalized(row.budget.category);
    categoryRows.set(key,[...(categoryRows.get(key)||[]),row]);
  }
  const seen = new Set<string>();
  for (const transaction of transactions) {
    if ((transaction.currency || "USD") !== currency || !transaction.date.startsWith(`${month}-`)) continue;
    if (!Number.isFinite(transaction.amount) || seen.has(transaction.financeId)) {
      model.errors.push("Invalid or duplicate transaction identity in the selected month."); continue;
    }
    seen.add(transaction.financeId);
    const category = normalized(transaction.category);
    const add = (row: BudgetRow | undefined, amount: number): void => {
      if (row) { row.actual = (row.actual || 0) + amount; row.amounts.set(transaction.financeId,(row.amounts.get(transaction.financeId)||0)+amount); if (!row.transactions.includes(transaction)) row.transactions.push(transaction); }
    };
    if (transaction.type === "transaction" && transaction.subtype === "income") {
      model.actual.income += transaction.amount;
      add(income.get(category),transaction.amount);
    } else if (transaction.type === "transaction" && ["purchase","payment","fee","cash-advance","refund"].includes(transaction.subtype)) {
      const spent = -transaction.amount;
      const row = fixed.get(category);
      if (row) {model.actual.fixed += spent;add(row,spent);}
      else {model.actual.flex += spent;model.flexTransactions.push(transaction);}
      for (const row of categoryRows.get(category)||[]) add(row,spent);
      if (!category || category === "uncategorized") model.uncategorizedCount++;
    } else if (transaction.type === "transaction" && !["transfer-in","transfer-out"].includes(transaction.subtype)) {
      model.review.push(transaction);
    }
    if (transaction.pending) {model.pendingCount++;continue;} // Contributions count only posted movements.
    const source = accountLinkPath(transaction.accountPath);
    const contribution = savingsContribution(transaction);
    if (contribution === null) {
      if (savings.has(source)) model.review.push(transaction);
    } else if (contribution !== 0) {
      add(savings.get(source),contribution);
      // Manual cash transfers store both legs in one note. Bank-owned counterparts
      // use their own imported leg, avoiding a manual/imported double count.
      if (transaction.manual && transaction.transferAccount) {
        const target = accountLinkPath(transaction.transferAccount);
        const counterpart = accountMap.get(target);
        if (counterpart?.manual && counterpart.subtype === "cash") add(savings.get(target),-contribution);
      }
    }
  }
  for (const row of validRows("savings")) model.actual.savings += row.actual || 0;
  for (const row of validRows("flex")) {row.actual=model.actual.flex;row.transactions=model.flexTransactions;row.amounts=new Map(model.flexTransactions.map(t=>[t.financeId,-t.amount]));}
  for (const key of Object.keys(model.planned) as BudgetBucket[]) {
    model.planned[key] = moneyRound(model.planned[key]);
    for (const row of model.rows[key]) if(row.actual!==null)row.actual=moneyRound(row.actual);
  }
  for (const key of Object.keys(model.actual) as Array<keyof FlexBudgetModel["actual"]>) model.actual[key]=moneyRound(model.actual[key]);
  model.unallocated=moneyRound(model.planned.income-model.planned.fixed-model.planned.flex-model.planned.savings);
  model.flexRemaining=moneyRound(model.planned.flex-model.actual.flex);
  return model;
}

/** Normalized amounts are positive for cash in, negative for cash out. */
export function savingsContribution(t: DashboardTransaction): number | null {
  if (t.type === "transaction") return ["transfer-in","transfer-out"].includes(t.subtype) ? t.amount : 0;
  if (t.subtype === "contribution" && t.investmentType === "buy") return Math.abs(t.amount);
  if (["contribution","deposit","withdrawal"].includes(t.subtype)) {
    if (!t.investmentType && t.subtype === "contribution" && t.amount < 0) return null;
    if (!t.investmentType || ["cash","transfer"].includes(t.investmentType)) return t.amount;
  }
  return 0; // Trading, distributions, interest, dividends and valuation changes aren't contributions.
}
