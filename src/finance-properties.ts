import { App, TFile, parseYaml, stringifyYaml } from "obsidian";

type Fields = Record<string, any>;
export interface FinancePropertyNames { keys: Record<string, string>; }
export const PROPERTY_GROUPS: Record<string, readonly string[]> = {
  "Common": ["kind", "type", "title", "date", "currency", "tags", "financeSource"],
  "Transactions": ["authorizedDate", "account", "amount", "pending", "merchant", "providerName", "providerTitle", "providerCategory", "providerCategoryDetail", "categoryOverride", "subtype", "investmentType", "transferAccount", "linkedTransaction", "migrationSource"],
  "Accounts & assets": ["institution", "accountName", "accountType", "accountSubtype", "accountMask", "current", "available", "limit", "openingBalance", "valuationDate", "purchaseTransaction", "liabilityAccount", "transactionLogTarget"],
  "Holdings": ["name", "ticker", "holdingType", "quantity", "price", "fees", "value", "costBasis", "asOf", "stale", "active"],
  "Rules & budgets": ["enabled", "priority", "accountContains", "nameContains", "merchantContains", "minAmount", "maxAmount", "category", "monthlyLimit", "bucket", "accounts"],
};
export const FINANCE_PROPERTY_KEYS = Object.values(PROPERTY_GROUPS).flat();
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const reserved = new Set(["__proto__", "constructor", "prototype", "position", "file", "tpsId", "financeId", "financeAccountId", "financeBudgetId", "financeRuleId", "securityId"]);

export function normalizePropertyNames(value?: Partial<FinancePropertyNames>): FinancePropertyNames {
  const result: FinancePropertyNames = { keys: {} };
  const owners = new Map<string, string>();
  for (const canonical of FINANCE_PROPERTY_KEYS) {
    const key = value?.keys?.[canonical] ?? canonical;
    if (typeof key !== "string" || !key.trim() || key !== key.trim() || /[\r\n\t\[\]#.:]/.test(key) || reserved.has(key)) {
      throw new Error(`Choose a plain, nonempty property name for ${canonical}.`);
    }
    if ((FINANCE_PROPERTY_KEYS.includes(key) && key !== canonical) || owners.has(key)) throw new Error(`Property “${key}” is already used by another finance field.`);
    owners.set(key, canonical);
    if (key !== canonical) result.keys[canonical] = key;
  }
  return result;
}

interface KindCodec { encode(fields: Fields): Fields; decode(fields: Fields): Fields; definition(kind: string): { parentKind: string; key: string; value: string } | { tag: string } | null; }

export class FinanceProperties {
  readonly names: FinancePropertyNames;
  constructor(names?: Partial<FinancePropertyNames>, private readonly kinds?: KindCodec) { this.names = normalizePropertyNames(names); }
  key(canonical: string): string { return this.names.keys[canonical] || canonical; }
  get customized(): boolean { return Boolean(this.kinds || Object.keys(this.names.keys).length); }

  read(raw: Fields = {}): Fields {
    const fields = {...raw};
    // Decode only the currently configured names. Old names are never aliases.
    for (const canonical of FINANCE_PROPERTY_KEYS) {
      delete fields[canonical];
      delete fields[this.key(canonical)];
    }
    for (const canonical of FINANCE_PROPERTY_KEYS) {
      const key = this.key(canonical);
      if (own(raw, key)) fields[canonical] = raw[key];
    }
    return this.kinds ? this.kinds.decode(fields) : fields;
  }

  write(fields: Fields): Fields {
    const raw: Fields = {};
    for (const [canonical, value] of Object.entries(this.kinds ? this.kinds.encode(fields) : fields)) {
      const key = this.key(canonical);
      if (own(raw, key)) throw new Error(`Finance property collision: ${key}.`);
      raw[key] = value;
    }
    return raw;
  }

  mutate(raw: Fields, update: (fields: Fields) => void): void {
    const before = this.read(raw), fields = {...before};
    update(fields);
    const next = this.write(fields);
    // Unconfigured properties, including old names left after declining migration,
    // remain untouched. Only fields exposed to the mutator can be changed.
    for (const key of Object.keys(this.write(before))) if (!own(next, key)) delete raw[key];
    Object.assign(raw, next);
  }

  assertIdentityKey(key: string): void {
    if (FINANCE_PROPERTY_KEYS.some(canonical => this.key(canonical) === key)) throw new Error(`Finance property “${key}” conflicts with the identity property configured in Global Context Menu.`);
  }

  isRecord(raw: Fields): boolean {
    const f = this.read(raw);
    return Boolean(f.financeId || f.financeAccountId || f.financeBudgetId || f.financeRuleId)
      || ["financeRule", "financeBudget"].includes(f.kind)
      || ["financeSnapshot", "financeTransactions", "holding"].includes(f.type);
  }

  cache(app: App, file: TFile): Fields { return this.read(app.metadataCache.getFileCache(file)?.frontmatter || {}); }
  process(app: App, file: TFile, update: (fields: Fields) => void): Promise<void> {
    return app.fileManager.processFrontMatter(file, raw => this.mutate(raw, update));
  }
  note(content: string): string {
    if (!this.customized) return content;
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return content;
    return `---\n${stringifyYaml(this.write(parseYaml(match[1]) || {}))}---\n${content.slice(match[0].length)}`;
  }

  /** Only generated definitions enter here; user-authored Bases are never rewritten. */
  base(content: string): string {
    if (!this.customized) return content;
    const definition = parseYaml(content);
    const expression = (text: string): string => {
      const classified = text.replace(/(?<![\w.])(?:note\.)?kind\s*(==|!=)\s*(["'])([^"']+)\2/g, (all, operator, quote, kind) => {
      const mapping = this.kinds?.definition(kind);
      if (!mapping) return all;
      const match = "tag" in mapping ? `file.hasTag(${JSON.stringify(mapping.tag)})` : `(kind == ${JSON.stringify(mapping.parentKind)} && note[${JSON.stringify(mapping.key)}] == ${JSON.stringify(mapping.value)})`;
      return operator === '!=' ? `!${match}` : match;
    });
      return classified.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_][A-Za-z0-9_]*\b/g, (token, offset) => {
      if (!FINANCE_PROPERTY_KEYS.includes(token) || classified[offset - 1] === "." || this.key(token) === token) return token;
      return `note[${JSON.stringify(this.key(token))}]`;
      });
    };
    const filter = (value: any): any => typeof value === "string" ? expression(value) : Array.isArray(value) ? value.map(filter)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, filter(item)])) : value;
    if (definition.filters) definition.filters = filter(definition.filters);
    for (const view of definition.views || []) {
      if (view.filters) view.filters = filter(view.filters);
      // Atomic-line columns refer to the stable line codec, not note properties.
      if (view.type === "tps-table") continue;
      if (view.order) view.order = view.order.map((key: string) => this.key(key));
      if (view.sort) view.sort = view.sort.map((sort: any) => ({...sort, property: this.key(sort.property)}));
    }
    return stringifyYaml(definition);
  }
}

export function financeKindCodec(api: KindCodec | undefined): KindCodec | undefined {
  if (!api) return undefined;
  const canonical: Record<string, string> = { transaction: 'finance-transaction', investmentTransaction: 'investment-transaction', financeRule: 'finance-rule', financeBudget: 'finance-budget' };
  const original = Object.fromEntries(Object.entries(canonical).map(([from, to]) => [to, from]));
  return {
    definition: kind => api.definition(canonical[kind] || kind),
    encode: fields => {
      const kind = canonical[fields.kind] || fields.kind;
      return api.encode(api.definition(kind) ? { ...fields, kind } : fields);
    },
    decode: fields => {
      const decoded = api.decode(fields);
      return original[decoded.kind] && api.definition(decoded.kind) ? { ...decoded, kind: original[decoded.kind] } : decoded;
    },
  };
}

export function financeProperties(app: App): FinanceProperties {
  if ((app as any).plugins?.plugins?.["tps-finances"]?.settings?.propertyMigration) throw new Error("Resume the property migration in Finances → Properties before using finance records.");
  const properties = new FinanceProperties((app as any).plugins?.plugins?.["tps-finances"]?.settings?.propertyNames, financeKindCodec((app as any).plugins?.plugins?.["tps-global-context-menu"]?.api?.frontmatterKinds));
  properties.assertIdentityKey((app as any).plugins?.plugins?.["tps-global-context-menu"]?.settings?.nativeRecordIdentityPropertyKey || "tpsId");
  return properties;
}
