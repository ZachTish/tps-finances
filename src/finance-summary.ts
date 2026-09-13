import type { FinanceAccount, FinanceHolding } from "./types";

/** Account balances are authoritative. Holdings are a fallback, never an extra asset. */
export function accountSummaries(accounts: readonly FinanceAccount[], holdings: readonly FinanceHolding[]) {
  const summaries = new Map<string, {currency:string;netWorth:number;cash:number;investments:number;debt:number;assets:number}>();
  for (const account of accounts) {
    const currency = account.currency || "USD";
    let summary = summaries.get(currency);
    if (!summary) summaries.set(currency, summary = {currency,netWorth:0,cash:0,investments:0,debt:0,assets:0});
    const investment = account.type === "investment" || account.type === "brokerage";
    const balance = account.current ?? (investment ? holdings.filter(h => h.financeAccountId === account.financeAccountId && h.currency === currency).reduce((n,h) => n+h.value,0) : 0);
    summary.netWorth += balance;
    if (account.type === "credit" || account.type === "loan") summary.debt -= balance;
    else if (investment) summary.investments += balance;
    else if (account.type === "depository") summary.cash += balance;
    else if (account.manual && account.type === "other") summary.assets += balance;
  }
  return [...summaries.values()];
}
