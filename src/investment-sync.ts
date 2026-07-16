import type { FinanceHolding, FinanceTransaction, OptionalPlaidResult } from "./types";

export function investmentDateRange(lastSuccessfulSyncAt: string, historyDays: number, now = new Date()): { start: string; end: string } {
  const end = new Date(now);
  const start = lastSuccessfulSyncAt ? new Date(lastSuccessfulSyncAt) : new Date(end.getTime() - historyDays * 86400000);
  if (lastSuccessfulSyncAt) start.setDate(start.getDate() - 14);
  return { start: localDate(start), end: localDate(end) };
}

export async function applyInvestmentTransactionResult(
  result: OptionalPlaidResult<FinanceTransaction[]>,
  previousWatermark: string,
  completedAt: string,
  persist: (transactions: FinanceTransaction[]) => Promise<void>,
): Promise<{ watermark: string; count: number }> {
  if (result.status !== "ok") return { watermark: previousWatermark, count: 0 };
  await persist(result.value);
  return { watermark: completedAt, count: result.value.length };
}

export function holdingsForSnapshot(
  result: OptionalPlaidResult<FinanceHolding[]>,
  currentAccountIds: Set<string>,
  previousHoldings: FinanceHolding[],
): { holdings: FinanceHolding[]; preserved: number } {
  if (result.status === "ok") return { holdings: result.value, preserved: 0 };
  const holdings = previousHoldings
    .filter((holding) => currentAccountIds.has(holding.financeAccountId))
    .map((holding) => ({ ...holding, stale: true }));
  return { holdings, preserved: holdings.length };
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
