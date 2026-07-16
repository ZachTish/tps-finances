export function createLocalId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replace(/-/g, "")}`;
}

export function providerIdentityKey(scope: string, providerId: string): string {
  return `${scope}:${providerId}`;
}
