export type PlaidEnvironment = "sandbox" | "development" | "production";
export type TransactionLogTarget = "daily-note" | "account-note";

export interface TPSFinancesSettings {
  financeFolder: string;
  plaidEnvironment: PlaidEnvironment;
  plaidClientIdSecret: string;
  plaidSecretSecret: string;
  oauthRedirectUri: string;
  transactionHistoryDays: number;
  transactionLogTarget: TransactionLogTarget;
  enableLogging: boolean;
}

export const DEFAULT_SETTINGS: TPSFinancesSettings = {
  financeFolder: "Finances",
  plaidEnvironment: "sandbox",
  plaidClientIdSecret: "tps-finances-plaid-client-id",
  plaidSecretSecret: "tps-finances-plaid-secret",
  oauthRedirectUri: "",
  transactionHistoryDays: 730,
  transactionLogTarget: "daily-note",
  enableLogging: false,
};

export interface DeviceItemState {
  localItemId: string;
  providerItemId: string;
  accessToken: string;
  institutionName: string;
  cursor: string;
  lastSyncAt: string;
  lastInvestmentTransactionSyncAt: string;
  environment: PlaidEnvironment;
  plaidClientIdSecretName?: string;
  plaidSecretName: string;
}

export interface DeviceState {
  plaidUserId: string;
  items: DeviceItemState[];
  providerIdentityMap: Record<string, string>;
}

export interface FinanceAccount {
  financeAccountId: string;
  providerAccountId: string;
  localItemId: string;
  institutionName: string;
  name: string;
  officialName: string;
  mask: string;
  type: string;
  subtype: string;
  currency: string;
  available: number | null;
  current: number | null;
  limit: number | null;
  path?: string;
  transactionLogTarget?: TransactionLogTarget | "default";
  effectiveTransactionLogTarget?: TransactionLogTarget;
}

export interface FinanceTransaction {
  financeId: string;
  providerTransactionId: string;
  financeAccountId: string;
  date: string;
  authorizedDate: string;
  name: string;
  merchantName: string;
  amount: number;
  currency: string;
  pending: boolean;
  category: string;
  categoryDetail: string;
  subtype: string;
  kind: "transaction" | "investmentTransaction";
  securityId?: string;
  quantity?: number | null;
  price?: number | null;
  fees?: number | null;
  investmentType?: string;
}

export interface FinanceHolding {
  financeAccountId: string;
  securityId: string;
  name: string;
  ticker: string;
  type: string;
  quantity: number;
  price: number;
  value: number;
  costBasis: number | null;
  currency: string;
  asOf?: string;
  stale?: boolean;
}

export interface FinanceSnapshot {
  accounts: FinanceAccount[];
  holdings: FinanceHolding[];
  transactions: FinanceTransaction[];
  lastSyncAt: string;
}

export interface FinanceRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  accountContains: string;
  nameContains: string;
  merchantContains: string;
  minAmount: number | null;
  maxAmount: number | null;
  category: string;
  tags: string[];
}

export interface FinanceBudget {
  id: string;
  name: string;
  category: string;
  monthlyLimit: number;
}

export interface PlaidCredentials {
  clientId: string;
  secret: string;
}

export type PlaidSetupState = "missing-credentials" | "conflicting-credentials" | "ready";

export interface PlaidSetupStatus {
  state: PlaidSetupState;
  clientIdConfigured: boolean;
  secretConfigured: boolean;
  connectedItems: number;
}

export interface PlaidLinkResult {
  publicToken: string;
  institutionName: string;
}

export interface TransactionSyncPatch {
  added: FinanceTransaction[];
  modified: FinanceTransaction[];
  removedProviderIds: string[];
  nextCursor: string;
}

export type OptionalPlaidResult<T> =
  | { status: "ok"; value: T }
  | { status: "pending" | "unavailable"; code: string; requestId: string };
