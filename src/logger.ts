const PREFIX = "[TPS Finances]";
let enabled = false;

export function setLoggingEnabled(value: boolean): void {
  enabled = value;
}

export function flow(scope: string, event: string, data: Record<string, unknown> = {}): void {
  if (enabled) console.info(`${PREFIX} [${scope}] ${event}`, data);
}

export function warn(scope: string, event: string, data: Record<string, unknown> = {}): void {
  if (enabled) console.warn(`${PREFIX} [${scope}] ${event}`, data);
}

export function operationalWarning(scope: string, event: string, data: Record<string, unknown> = {}): void {
  console.warn(`${PREFIX} [${scope}] ${event}`, data);
}

export function failure(scope: string, event: string, error: unknown, data: Record<string, unknown> = {}): void {
  console.error(`${PREFIX} [${scope}] ${event}`, { ...data, error: summarizeError(error) });
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error ?? "Unknown error");
}
