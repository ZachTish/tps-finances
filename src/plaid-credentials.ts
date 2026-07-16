import type { PlaidCredentials, PlaidSetupStatus } from "./types";

type SecretReader = (name: string) => string | null;

export function inspectPlaidCredentials(
  clientIdSecretName: string,
  environmentSecretName: string,
  readSecret: SecretReader,
  connectedItems = 0,
): PlaidSetupStatus {
  const clientId = readTrimmedSecret(clientIdSecretName, readSecret);
  const secret = readTrimmedSecret(environmentSecretName, readSecret);
  const clientIdConfigured = Boolean(clientId);
  const secretConfigured = Boolean(secret);
  const conflicting = Boolean(clientIdSecretName && environmentSecretName && clientIdSecretName === environmentSecretName)
    || Boolean(clientId && secret && clientId === secret);
  return {
    state: conflicting ? "conflicting-credentials" : clientIdConfigured && secretConfigured ? "ready" : "missing-credentials",
    clientIdConfigured,
    secretConfigured,
    connectedItems,
  };
}

export function readPlaidCredentials(
  clientIdSecretName: string,
  environmentSecretName: string,
  readSecret: SecretReader,
): PlaidCredentials {
  const status = inspectPlaidCredentials(clientIdSecretName, environmentSecretName, readSecret);
  if (status.state === "conflicting-credentials") {
    throw new Error("Plaid client ID and Plaid secret must use two different Obsidian secrets. Select or create separate secrets in TPS Finances settings.");
  }
  if (!status.clientIdConfigured && !status.secretConfigured) {
    throw new Error("Add the Plaid client ID and environment secret in TPS Finances settings first.");
  }
  if (!status.clientIdConfigured) {
    throw new Error("The selected Plaid client ID secret is empty or unavailable. Choose a populated client ID secret in TPS Finances settings.");
  }
  if (!status.secretConfigured) {
    throw new Error("The selected Plaid environment secret is empty or unavailable. Choose a populated environment secret in TPS Finances settings.");
  }
  return {
    clientId: readTrimmedSecret(clientIdSecretName, readSecret),
    secret: readTrimmedSecret(environmentSecretName, readSecret),
  };
}

function readTrimmedSecret(name: string, readSecret: SecretReader): string {
  return name ? String(readSecret(name) || "").trim() : "";
}
