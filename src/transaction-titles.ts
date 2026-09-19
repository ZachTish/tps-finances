import { OPTIONAL_TRANSACTION_PROPERTIES } from "./transaction-properties";

type Fields = Record<string, any>;

/** Use provider-enriched names, without guessing brands or stripping bank details. */
export function transactionTitle(name: string, merchant: string, type: string): string {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  return (type === "transaction" ? clean(merchant) : "") || clean(name)
    || (type === "investmentTransaction" ? "Investment transaction" : "Transaction");
}

/** Re-evaluate against current frontmatter inside the atomic write callback. */
export function providerTransactionFields(incoming: Fields, current: Fields): Fields {
  const { categoryOverride, tags, ...fields } = incoming;
  if (current.financeSource === "manual") throw new Error("Imported transaction conflicts with a manual transaction.");
  const tracked = typeof current.providerTitle === "string";
  const mayUpdate = tracked
    ? current.title === current.providerTitle
    : current.title === incoming.providerName;
  // Unknown legacy titles and user edits stay unchanged until explicitly reviewed.
  if (!mayUpdate) fields.title = current.title;
  return fields;
}

export interface TransactionTitleChange {
  path: string;
  financeId: string;
  before: string;
  after: string;
  date: string;
  signature: string;
  removeFields?: string[];
}

export function titleSignature(fields: Fields): string {
  return JSON.stringify(["financeId", "type", "title", "merchant", "providerName", "providerTitle",
    "financeSource", "account", ...OPTIONAL_TRANSACTION_PROPERTIES].map(key => fields[key] ?? null));
}

export function proposedTransactionTitle(fields: Fields): string | null {
  if (fields.financeSource === "manual" || !["transaction", "investmentTransaction"].includes(fields.type)) return null;
  if (typeof fields.providerTitle === "string" && fields.title !== fields.providerTitle) return null;
  const merchant = typeof fields.merchant === "string" ? fields.merchant.trim() : "";
  const name = typeof fields.title === "string" ? fields.title : "";
  // A missing title can be explicitly recovered from retained provider data.
  // Do not manufacture a generic title when no useful description is available.
  const fallback = name.trim() ? name : typeof fields.providerName === "string" ? fields.providerName : "";
  if (!fallback.trim() && !(fields.type === "transaction" && merchant)) return null;
  const title = transactionTitle(fallback, merchant, fields.type);
  return title !== fields.title ? title : null;
}
