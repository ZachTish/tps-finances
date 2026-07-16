import { requestUrl } from "obsidian";
import { createLocalId, providerIdentityKey } from "./identity";
import * as logger from "./logger";
import type {
  DeviceItemState,
  DeviceState,
  FinanceAccount,
  FinanceHolding,
  FinanceTransaction,
  OptionalPlaidResult,
  PlaidCredentials,
  PlaidEnvironment,
  TransactionSyncPatch,
} from "./types";

const PLAID_HOSTS: Record<PlaidEnvironment, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};
const PLAID_API_VERSION = "2020-09-14";

export class PlaidApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly requestId: string,
  ) {
    super(`${code}: ${message}${requestId ? ` (Plaid request ${requestId})` : ""}`);
    this.name = "PlaidApiError";
  }
}

export class PlaidClient {
  constructor(
    private readonly environment: PlaidEnvironment,
    private readonly credentials: PlaidCredentials,
  ) {}

  async createLinkToken(userId: string, daysRequested: number, redirectUri: string): Promise<string> {
    const body: Record<string, unknown> = {
      client_name: "TPS Finances",
      country_codes: ["US"],
      language: "en",
      user: { client_user_id: userId },
      products: ["transactions"],
      optional_products: ["investments"],
      transactions: { days_requested: Math.max(30, Math.min(730, daysRequested)) },
    };
    if (redirectUri.trim()) body.redirect_uri = redirectUri.trim();
    const response = await this.post("/link/token/create", body);
    const linkToken = String(response.link_token || "");
    if (!linkToken) throw new Error("Plaid did not return a Link token.");
    return linkToken;
  }

  async exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
    const response = await this.post("/item/public_token/exchange", { public_token: publicToken });
    const accessToken = String(response.access_token || "");
    const itemId = String(response.item_id || "");
    if (!accessToken || !itemId) throw new Error("Plaid did not return an Item access token.");
    return { accessToken, itemId };
  }

  async removeItem(accessToken: string): Promise<void> {
    await this.post("/item/remove", { access_token: accessToken });
  }

  async getAccounts(item: DeviceItemState, state: DeviceState): Promise<FinanceAccount[]> {
    const response = await this.post("/accounts/get", { access_token: item.accessToken });
    return asArray(response.accounts).map((account) => normalizeAccount(account, item, state));
  }

  async syncTransactions(item: DeviceItemState, state: DeviceState): Promise<TransactionSyncPatch> {
    const originalCursor = item.cursor || "";
    let cursor = originalCursor;
    const added: FinanceTransaction[] = [];
    const modified: FinanceTransaction[] = [];
    const removedProviderIds: string[] = [];

    for (let page = 0; page < 100; page += 1) {
      let response: any;
      try {
        response = await this.post("/transactions/sync", {
          access_token: item.accessToken,
          cursor: cursor || undefined,
          count: 500,
        });
      } catch (error) {
        if (String(error).includes("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") && cursor !== originalCursor) {
          cursor = originalCursor;
          added.length = 0;
          modified.length = 0;
          removedProviderIds.length = 0;
          page = -1;
          continue;
        }
        throw error;
      }

      for (const transaction of asArray(response.added)) added.push(normalizeTransaction(transaction, state));
      for (const transaction of asArray(response.modified)) modified.push(normalizeTransaction(transaction, state));
      for (const removed of asArray(response.removed)) {
        const id = String(removed.transaction_id || "");
        if (id) removedProviderIds.push(id);
      }
      cursor = String(response.next_cursor || cursor);
      if (!response.has_more) return { added, modified, removedProviderIds, nextCursor: cursor };
    }
    throw new Error("Plaid transaction sync exceeded 100 pages.");
  }

  async getHoldings(item: DeviceItemState, state: DeviceState): Promise<OptionalPlaidResult<FinanceHolding[]>> {
    try {
      const response = await this.post("/investments/holdings/get", { access_token: item.accessToken });
      const securities = new Map(asArray(response.securities).map((security) => [String(security.security_id || ""), security]));
      return { status: "ok", value: asArray(response.holdings).map((holding) => normalizeHolding(holding, securities, state)) };
    } catch (error) {
      return optionalPlaidFailure("holdings", error);
    }
  }

  async getInvestmentTransactions(item: DeviceItemState, state: DeviceState, startDate: string, endDate: string): Promise<OptionalPlaidResult<FinanceTransaction[]>> {
    try {
      const transactions: FinanceTransaction[] = [];
      for (let page = 0; page < 100; page += 1) {
        const response = await this.post("/investments/transactions/get", {
          access_token: item.accessToken,
          start_date: startDate,
          end_date: endDate,
          options: { count: 500, offset: page * 500 },
        });
        const batch = asArray(response.investment_transactions);
        transactions.push(...batch.map((transaction) => normalizeInvestmentTransaction(transaction, state)));
        const total = Number(response.total_investment_transactions || transactions.length);
        if (transactions.length >= total || batch.length < 500) return { status: "ok", value: transactions };
      }
      throw new Error("Plaid investment transaction sync exceeded 100 pages.");
    } catch (error) {
      return optionalPlaidFailure("transactions", error);
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    const response = await requestUrl({
      url: `${PLAID_HOSTS[this.environment]}${path}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PLAID-CLIENT-ID": this.credentials.clientId,
        "PLAID-SECRET": this.credentials.secret,
        "Plaid-Version": PLAID_API_VERSION,
      },
      body: JSON.stringify(body),
      throw: false,
    });
    const payload = response.json || {};
    if (response.status < 200 || response.status >= 300) {
      const code = String(payload.error_code || `HTTP_${response.status}`);
      const message = String(payload.error_message || payload.display_message || "Plaid request failed");
      throw new PlaidApiError(code, message, response.status, String(payload.request_id || ""));
    }
    return payload;
  }
}

function normalizeAccount(account: any, item: DeviceItemState, state: DeviceState): FinanceAccount {
  const type = String(account.type || "");
  return {
    financeAccountId: localIdentity(state, "account", String(account.account_id || "")),
    providerAccountId: String(account.account_id || ""),
    localItemId: item.localItemId,
    institutionName: item.institutionName,
    name: String(account.name || account.official_name || "Account"),
    officialName: String(account.official_name || ""),
    mask: String(account.mask || ""),
    type,
    subtype: String(account.subtype || ""),
    currency: String(account.balances?.iso_currency_code || account.balances?.unofficial_currency_code || "USD"),
    available: isLiabilityType(type) ? null : nullableNumber(account.balances?.available),
    current: normalizeCurrentBalance(type, account.balances?.current),
    limit: nullableNumber(account.balances?.limit),
  };
}

function normalizeTransaction(transaction: any, state: DeviceState): FinanceTransaction {
  return {
    financeId: localIdentity(state, "transaction", String(transaction.transaction_id || "")),
    providerTransactionId: String(transaction.transaction_id || ""),
    financeAccountId: localIdentity(state, "account", String(transaction.account_id || "")),
    date: String(transaction.date || transaction.authorized_date || ""),
    authorizedDate: String(transaction.authorized_date || ""),
    name: String(transaction.name || transaction.merchant_name || "Transaction"),
    merchantName: String(transaction.merchant_name || ""),
    amount: -numberOrZero(transaction.amount),
    currency: String(transaction.iso_currency_code || transaction.unofficial_currency_code || "USD"),
    pending: transaction.pending === true,
    category: String(transaction.personal_finance_category?.primary || "").toLowerCase(),
    categoryDetail: String(transaction.personal_finance_category?.detailed || "").toLowerCase(),
    subtype: ordinaryTransactionSubtype(transaction),
    kind: "transaction",
  };
}

function normalizeInvestmentTransaction(transaction: any, state: DeviceState): FinanceTransaction {
  const providerId = String(transaction.investment_transaction_id || "");
  return {
    financeId: localIdentity(state, "investment-transaction", providerId),
    providerTransactionId: providerId,
    financeAccountId: localIdentity(state, "account", String(transaction.account_id || "")),
    date: String(transaction.date || ""),
    authorizedDate: "",
    name: String(transaction.name || transaction.subtype || transaction.type || "Investment transaction"),
    merchantName: "",
    amount: -numberOrZero(transaction.amount),
    currency: String(transaction.iso_currency_code || transaction.unofficial_currency_code || "USD"),
    pending: false,
    category: "investments",
    categoryDetail: String(transaction.subtype || transaction.type || "").toLowerCase(),
    subtype: String(transaction.subtype || transaction.type || "investment").toLowerCase(),
    kind: "investmentTransaction",
    securityId: String(transaction.security_id || ""),
    quantity: nullableNumber(transaction.quantity),
    price: nullableNumber(transaction.price),
    fees: nullableNumber(transaction.fees),
    investmentType: String(transaction.type || ""),
  };
}

function ordinaryTransactionSubtype(transaction: any): string {
  const primary = String(transaction.personal_finance_category?.primary || "").toLowerCase();
  const detailed = String(transaction.personal_finance_category?.detailed || "").toLowerCase();
  if (primary === "income") return "income";
  if (primary === "transfer_in") return "transfer-in";
  if (primary === "transfer_out") return "transfer-out";
  if (primary === "loan_payments") return "payment";
  if (primary === "bank_fees") return "fee";
  if (primary === "cash_advance") return "cash-advance";
  if (detailed.includes("refund")) return "refund";
  return "purchase";
}

function normalizeHolding(holding: any, securities: Map<string, any>, state: DeviceState): FinanceHolding {
  const providerSecurityId = String(holding.security_id || "");
  const security = securities.get(providerSecurityId) || {};
  return {
    financeAccountId: localIdentity(state, "account", String(holding.account_id || "")),
    securityId: localIdentity(state, "security", providerSecurityId),
    name: String(security.name || security.ticker_symbol || "Security"),
    ticker: String(security.ticker_symbol || ""),
    type: String(security.type || ""),
    quantity: numberOrZero(holding.quantity),
    price: numberOrZero(holding.institution_price),
    value: numberOrZero(holding.institution_value),
    costBasis: nullableNumber(holding.cost_basis),
    currency: String(holding.iso_currency_code || holding.unofficial_currency_code || "USD"),
  };
}

function localIdentity(state: DeviceState, scope: string, providerId: string): string {
  if (!providerId) return createLocalId(`finance-${scope}`);
  const key = providerIdentityKey(scope, providerId);
  const existing = state.providerIdentityMap[key];
  if (existing) return existing;
  const created = createLocalId(`finance-${scope}`);
  state.providerIdentityMap[key] = created;
  return created;
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalPlaidFailure<T>(operation: "holdings" | "transactions", error: unknown): OptionalPlaidResult<T> {
  const code = error instanceof PlaidApiError ? error.code : "REQUEST_FAILED";
  const requestId = error instanceof PlaidApiError ? error.requestId : "";
  const status = !(error instanceof PlaidApiError)
    || /PRODUCT_NOT_READY|INSTITUTION_DOWN|INSTITUTION_NOT_RESPONDING|INTERNAL_SERVER_ERROR|PLANNED_MAINTENANCE|RATE_LIMIT_EXCEEDED/.test(code)
    ? "pending"
    : "unavailable";
  logger.operationalWarning("Plaid", "optional-investments-not-observed", { operation, status, code, requestId });
  return { status, code, requestId };
}

function normalizeCurrentBalance(type: string, value: unknown): number | null {
  const current = nullableNumber(value);
  if (current == null) return null;
  return isLiabilityType(type) ? -Math.abs(current) : current;
}

function isLiabilityType(type: string): boolean {
  return type === "credit" || type === "loan";
}
