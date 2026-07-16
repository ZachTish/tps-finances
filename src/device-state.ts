import type { DeviceItemState, PlaidEnvironment } from "./types";

export function normalizeDeviceItems(
  rawItems: unknown[],
  currentClientIdSecretName: string,
  currentEnvironmentSecretName: string,
): { items: DeviceItemState[]; skipped: number; migratedClientIdItems: number } {
  const items: DeviceItemState[] = [];
  let migratedClientIdItems = 0;
  for (const value of rawItems) {
    if (!validItem(value)) continue;
    const existingClientIdSecretName = String(value.plaidClientIdSecretName || "").trim();
    if (!existingClientIdSecretName) migratedClientIdItems += 1;
    items.push({
      ...value,
      environment: normalizedEnvironment(value.environment),
      lastInvestmentTransactionSyncAt: String(value.lastInvestmentTransactionSyncAt || ""),
      plaidClientIdSecretName: existingClientIdSecretName || currentClientIdSecretName,
      plaidSecretName: String(value.plaidSecretName || "").trim() || currentEnvironmentSecretName,
    });
  }
  return { items, skipped: rawItems.length - items.length, migratedClientIdItems };
}

function validItem(value: unknown): value is DeviceItemState {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DeviceItemState>;
  return Boolean(item.localItemId && item.accessToken);
}

function normalizedEnvironment(value: unknown): PlaidEnvironment {
  return value === "development" || value === "production" ? value : "sandbox";
}
