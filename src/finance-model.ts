import type { TFile } from "obsidian";
import type { FinanceAccount, FinanceBudget, FinanceHolding } from "./types";

export interface FinanceTransaction {
  financeId: string;
  manual?: boolean;
  transferAccount?: string;
  date: string;
  name: string;
  providerName?: string;
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
  /** Original atomic file, attached non-enumerably to the displayed model row. */
  sourceFile?: TFile;
}

export interface BudgetProgress {
  id: string;
  name: string;
  category: string;
  monthlyLimit: number;
  spent: number;
}

export interface FinanceModel {
  accounts: FinanceAccount[];
  holdings: FinanceHolding[];
  transactions: FinanceTransaction[];
  legacyReviewRequired?: boolean;
  budgets: BudgetProgress[];
  budgetEntries?: FinanceBudget[];
}
