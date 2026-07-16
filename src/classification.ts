import type { FinanceRule } from "./types";

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

export function classifyTransaction(transaction: ClassifiableTransaction, rules: FinanceRule[]): ClassificationResult {
  const rule = rules.filter((candidate) => candidate.enabled).sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
    .find((candidate) => ruleMatches(candidate, transaction));
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
