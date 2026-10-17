type Fields = Record<string, any>;

// Provider-owned optional fields only. Never remove amounts, pending=false,
// identifiers, user properties, or a populated investment value (including zero).
export const OPTIONAL_TRANSACTION_PROPERTIES = [
  "authorizedDate", "merchant", "providerCategoryDetail", "subtype",
  "securityId", "quantity", "price", "fees", "investmentType",
] as const;

export function emptyTransactionProperties(fields: Fields): string[] {
  return OPTIONAL_TRANSACTION_PROPERTIES.filter(key =>
    Object.prototype.hasOwnProperty.call(fields, key) &&
    (fields[key] == null || (typeof fields[key] === "string" && !fields[key].trim())));
}
