import type { FinanceBudget, FinanceRule } from "./types";

export interface ClassifiableTransaction {
  account: string;
  accountSearchText?: string;
  name: string;
  merchant: string;
  amount: number;
  providerCategory: string;
  categoryOverride: string;
  tags: string[];
}

export interface ClassificationResult {
  category: string;
  tags: string[];
  source: "manual" | "rule" | "provider" | "uncategorized";
  ruleId: string;
}

export type PreparedTransactionClassifier = (transaction: ClassifiableTransaction) => ClassificationResult;

export interface BudgetSpendingTransaction {
  date: string;
  amount: number;
  category: string;
  subtype: string;
  type: "transaction" | "investmentTransaction";
}

const SPENDING_TRANSACTION_SUBTYPES = ["purchase", "payment", "fee", "cash-advance"];

export function calculateMonthlyBudgetProgress<T extends FinanceBudget>(
  budgets: readonly T[],
  transactions: readonly BudgetSpendingTransaction[],
  month: string,
): Array<T & { spent: number }> {
  if (!budgets.length) return [];

  const spendingByCategory = new Map<string, number>();
  for (const transaction of transactions) {
    if (!transaction.date.startsWith(month)
      || !(transaction.amount < 0)
      || transaction.type !== "transaction"
      || !SPENDING_TRANSACTION_SUBTYPES.includes(transaction.subtype)) continue;
    const category = normalizedBudgetCategory(transaction.category);
    spendingByCategory.set(category, (spendingByCategory.get(category) ?? 0) + transaction.amount);
  }

  return budgets.map((budget) => ({
    ...budget,
    spent: -(spendingByCategory.get(normalizedBudgetCategory(budget.category)) ?? 0),
  }));
}

export function classifyTransaction(transaction: ClassifiableTransaction, rules: FinanceRule[]): ClassificationResult {
  return classifyWithOrderedRules(transaction, orderedEnabledRules(rules));
}

export function prepareTransactionClassifier(rules: readonly FinanceRule[]): PreparedTransactionClassifier {
  const orderedRules = orderedEnabledRules(rules);
  return (transaction) => classifyWithOrderedRules(transaction, orderedRules);
}

function orderedEnabledRules(rules: readonly FinanceRule[]): FinanceRule[] {
  return rules.filter((candidate) => candidate.enabled)
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
}

function classifyWithOrderedRules(transaction: ClassifiableTransaction, orderedRules: readonly FinanceRule[]): ClassificationResult {
  const rule = orderedRules.find((candidate) => ruleMatches(candidate, transaction));
  const category = transaction.categoryOverride || rule?.category || transaction.providerCategory || "uncategorized";
  const tags = normalizeTags([...transaction.tags, ...(rule?.tags || [])]);
  return {
    category,
    tags,
    source: transaction.categoryOverride ? "manual" : rule?.category ? "rule" : transaction.providerCategory ? "provider" : "uncategorized",
    ruleId: rule?.id || "",
  };
}

export function ruleMatches(rule: FinanceRule, transaction: ClassifiableTransaction): boolean {
  const matchesText = (needle: string, haystack: string) => !needle || haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
  const absoluteAmount = Math.abs(transaction.amount);
  return matchesText(rule.accountContains, transaction.accountSearchText || transaction.account)
    && matchesText(rule.nameContains, transaction.name)
    && matchesText(rule.merchantContains, transaction.merchant)
    && (rule.minAmount == null || absoluteAmount >= rule.minAmount)
    && (rule.maxAmount == null || absoluteAmount <= rule.maxAmount);
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean).map((tag) => `#${tag.replace(/\s+/g, "-")}`))];
}

function normalizedBudgetCategory(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_]+/g, "-");
}
