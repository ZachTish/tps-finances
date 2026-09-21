import { FinanceAccount, FinanceTransaction } from './types';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function object(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Wallet record.');
    return value as Record<string, any>;
}
function text(value: unknown, optional = false): string {
    if (typeof value !== 'string' || value.length > 500 || (!optional && !value.trim()) || /[\p{Cc}]/u.test(value)) throw new Error('Invalid Wallet text.');
    return value;
}
function identifier(value: unknown): string { if (!uuid(value)) throw new Error('Invalid Wallet identity.'); return value; }
function currency(value: unknown): string { if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) throw new Error('Invalid Wallet currency.'); return value; }
function date(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Invalid Wallet transaction date.');
    return value;
}
function amount(value: unknown, nullable = false): number | null {
    // Swift's synthesized Codable omits nil optional balances.
    if (nullable && (value === null || value === undefined)) return null;
    if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(value)) throw new Error('Invalid Wallet amount.');
    const result = Number(value);
    if (!Number.isFinite(result)) throw new Error('Invalid Wallet amount.');
    return result;
}
export const walletAccountID = (id: string) => `wallet_account_${identifier(id)}`;
export const walletTransactionID = (id: string) => `wallet_transaction_${identifier(id)}`;
export const walletProviderID = (id: string) => `financekit:${identifier(id)}`;
/** Validate the entire transfer before the caller creates or changes a note. */
export function parseWalletParts(parts: unknown[]): { accounts: FinanceAccount[]; transactions: FinanceTransaction[]; removed: string[] } {
    if (!Array.isArray(parts) || !parts.length || parts.length > 128) throw new Error('Invalid Wallet transfer.');
    const accounts = new Map<string, FinanceAccount>();
    const transactions = new Map<string, FinanceTransaction>();
    const removed = new Set<string>();
    for (const raw of parts) {
        const part = object(raw);
        if (part.version !== 1 || !Array.isArray(part.accounts) || !Array.isArray(part.transactions) || !Array.isArray(part.deletedTransactions) || part.accounts.length > 100 || part.transactions.length + part.deletedTransactions.length > 200) throw new Error('Invalid Wallet transfer part.');
        for (const value of part.accounts) {
            const a = object(value), id = identifier(a.id), kind = a.kind;
            if (kind !== 'asset' && kind !== 'liability') throw new Error('Unknown Wallet account type.');
            const account: FinanceAccount = {
                financeAccountId: walletAccountID(id), providerAccountId: walletProviderID(id), localItemId: 'financekit',
                institutionName: text(a.institution), name: text(a.name), officialName: text(a.name), mask: '',
                type: kind === 'liability' ? 'credit' : 'depository', subtype: '', currency: currency(a.currency),
                current: amount(a.current, true), available: amount(a.available, true), limit: amount(a.limit, true),
            };
            if (accounts.has(account.financeAccountId)) throw new Error('Duplicate Wallet account.');
            if (accounts.size >= 100) throw new Error('Wallet transfer has too many accounts.');
            accounts.set(account.financeAccountId, account);
        }
        for (const value of part.transactions) {
            const t = object(value), id = identifier(t.id), accountID = walletAccountID(identifier(t.accountID));
            const money = amount(t.amount)!;
            if (money < 0 || !['credit','debit'].includes(t.direction) || !['authorized','memo','pending','booked','rejected'].includes(t.status)) throw new Error('Invalid Wallet transaction direction or status.');
            const provider = walletProviderID(id);
            if (t.status === 'rejected') { removed.add(provider); transactions.delete(id); continue; }
            const transaction: FinanceTransaction = {
                financeId: walletTransactionID(id), providerTransactionId: provider, financeAccountId: accountID,
                date: date(t.date), authorizedDate: '', name: text(t.description), merchantName: text(t.merchant, true),
                // TPS normalizes Plaid to negative outflows and positive inflows.
                amount: t.direction === 'debit' ? -money : money, currency: currency(t.currency), pending: t.status !== 'booked',
                category: '', categoryDetail: '', subtype: walletSubtype(text(t.transactionType, true), t.direction), kind: 'transaction',
            };
            removed.delete(provider); transactions.set(id, transaction);
        }
        for (const id of part.deletedTransactions) { const valid = identifier(id); transactions.delete(valid); removed.add(walletProviderID(valid)); }
    }
    for (const transaction of transactions.values()) if (!accounts.has(transaction.financeAccountId)) throw new Error('Wallet transaction has no authorized account.');
    return {accounts: [...accounts.values()], transactions: [...transactions.values()], removed: [...removed]};
}

function walletSubtype(type: string, direction: string): string {
    if (type === 'transfer') return direction === 'credit' ? 'transfer-in' : 'transfer-out';
    if (type === 'pointOfSale') return direction === 'credit' ? 'refund' : 'purchase';
    if (type === 'refund') return 'refund';
    if (type === 'fee') return 'fee';
    if (['directDeposit', 'interest', 'dividend'].includes(type) && direction === 'credit') return 'income';
    if (['billPayment', 'directDebit', 'standingOrder'].includes(type) && direction === 'debit') return 'payment';
    return 'unknown'; // Deposits, adjustments and unidentified movements require review, not guessed income.
}
