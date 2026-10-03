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

type KindDefinition = { parentKind: string; key: string; value: string } | { tag: string }
  | { kindList: { key: string; value: string } } | { scalar: { key: string; value: string } };
interface KindCodec {
  version?: number;
  encode(fields: Fields, existing?: Fields): Fields;
  decode(fields: Fields, expectedKind?: string): Fields;
  definition(kind: string): KindDefinition | null;
  readDefinitions?(kind: string): KindDefinition[];
  matches?(fields: Fields, kind: string): boolean;
  propertyKey?(id: string): string | null;
}

export class FinanceProperties {
  readonly names: FinancePropertyNames;
  constructor(names?: Partial<FinancePropertyNames>, private readonly kinds?: KindCodec) {
    this.names = normalizePropertyNames(names);
    if (kinds?.version === 2) {
      const scheduled = kinds.propertyKey?.("scheduled");
      const kind = kinds.propertyKey?.("kind");
      if (scheduled && (FINANCE_PROPERTY_KEYS.some(key => key !== "date" && (key.toLowerCase() === scheduled.toLowerCase()
        || (this.names.keys[key] || key).toLowerCase() === scheduled.toLowerCase()))
        || kind?.toLowerCase() === scheduled.toLowerCase())) {
        throw new Error(`Scheduled property “${scheduled}” conflicts with a Finance field or record classification. Configure a different key in Global Context Menu.`);
      }
      if (kind && FINANCE_PROPERTY_KEYS.some(key => key !== "kind" && (key.toLowerCase() === kind.toLowerCase()
        || (this.names.keys[key] || key).toLowerCase() === kind.toLowerCase()))) {
        throw new Error(`Record classification property “${kind}” conflicts with a Finance field. Configure a different key in Global Context Menu.`);
      }
    }
  }
  key(canonical: string): string {
    if (canonical === "date" && this.kinds?.version === 2) return this.kinds.propertyKey?.("scheduled") || this.names.keys.date || "date";
    return this.names.keys[canonical] || canonical;
  }
  get customized(): boolean { return Boolean(this.kinds || Object.keys(this.names.keys).length); }

  read(raw: Fields = {}): Fields {
    const fields = {...raw};
    // GCM owns classification and the scheduled key in its v2 contract. Keep
    // Finance's saved kind/date names as read-only aliases during this rollout.
    const typeValue = raw[this.names.keys.type || "type"];
    const expectedKind = typeof typeValue === "string" ? typeValue : undefined;
    const decodedKind = this.kinds?.version === 2 ? this.kinds.decode(raw, expectedKind).kind : undefined;
    for (const canonical of FINANCE_PROPERTY_KEYS) {
      delete fields[canonical];
      delete fields[this.key(canonical)];
    }
    for (const canonical of FINANCE_PROPERTY_KEYS) {
      if (canonical === "kind" && this.kinds?.version === 2) continue;
      const key = this.key(canonical);
      if (own(raw, key)) fields[canonical] = raw[key];
    }
    if (this.kinds?.version === 2) {
      const oldKind = raw[this.names.keys.kind || "kind"];
      if (typeof decodedKind === "string") fields.kind = decodedKind;
      else if (typeof oldKind === "string") fields.kind = oldKind;
      else if (Array.isArray(decodedKind)) fields.kind = decodedKind;
      const primary = typeof fields.kind === "string" ? this.kinds.definition(fields.kind) : null;
      if (primary && "kindList" in primary && primary.kindList.key !== "kind") delete fields[primary.kindList.key];
      const scheduledKey = this.key("date");
      if (fields.date === undefined || fields.date === null || fields.date === "") {
        for (const legacyKey of new Set([this.names.keys.date || "date", "date"])) {
          if (legacyKey !== scheduledKey && own(raw, legacyKey) && raw[legacyKey] !== undefined && raw[legacyKey] !== null && raw[legacyKey] !== "") {
            fields.date = raw[legacyKey];
            break;
          }
        }
      }
      return fields;
    }
    return this.kinds ? this.kinds.decode(fields) : fields;
  }

  write(fields: Fields, existing?: Fields): Fields {
    if (this.kinds?.version === 2 && own(fields, "date") && !this.kinds.propertyKey?.("scheduled")) {
      throw new Error("Configure the Scheduled custom-property key in Global Context Menu before writing Finance dates.");
    }
    const raw: Fields = {};
    for (const [canonical, value] of Object.entries(this.kinds ? this.kinds.encode(fields, existing) : fields)) {
      const key = canonical === "kind" && this.kinds?.version === 2 ? canonical : this.key(canonical);
      if (own(raw, key)) throw new Error(`Finance property collision: ${key}.`);
      raw[key] = value;
    }
    return raw;
  }

  mutate(raw: Fields, update: (fields: Fields) => void): void {
    const before = this.read(raw), fields = {...before};
    update(fields);
    const next = this.write(fields, raw);
    // Unconfigured properties, including old names left after declining migration,
    // remain untouched. Only fields exposed to the mutator can be changed.
    for (const key of Object.keys(this.write(before, raw))) if (!own(next, key)) delete raw[key];
    if (this.kinds?.version === 2) {
      const tagsKey = this.key("tags");
      if (own(before, "tags") && !own(next, tagsKey)) delete raw[tagsKey];
      const scheduledKey = this.key("date");
      if (own(next, scheduledKey)) {
        for (const oldKey of new Set([this.names.keys.date || "date", "date"])) {
          if (oldKey !== scheduledKey && own(raw, oldKey) && raw[oldKey] === before.date) delete raw[oldKey];
        }
      }
    }
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
    if (this.kinds?.version === 2 && !this.kinds.propertyKey?.("scheduled")) {
      throw new Error("Configure the Scheduled custom-property key in Global Context Menu before creating Finance Bases.");
    }
    const definition = parseYaml(content);
    const expression = (text: string): string => {
      const classified = text.replace(/(?<![\w.])(?:note\.)?kind\s*(==|!=)\s*(["'])([^"']+)\2/g, (all, operator, quote, kind) => {
      const mapping = this.kinds?.definition(kind);
      if (!mapping) return all;
      const expression = (definition: KindDefinition): string => "tag" in definition
        ? `file.hasTag(${JSON.stringify(definition.tag)})`
        : "kindList" in definition
          ? `list(note[${JSON.stringify(definition.kindList.key)}]).contains(${JSON.stringify(definition.kindList.value)})`
          : "scalar" in definition
            ? `note[${JSON.stringify(definition.scalar.key)}] == ${JSON.stringify(definition.scalar.value)}`
          : `(kind == ${JSON.stringify(definition.parentKind)} && note[${JSON.stringify(definition.key)}] == ${JSON.stringify(definition.value)})`;
      const matches = this.kinds?.version === 2
        ? (this.kinds.readDefinitions?.(kind) || [mapping]).map(expression)
        : [expression(mapping)];
      const match = this.kinds?.version === 2 ? `(${[...new Set(matches)].join(" || ")})` : matches[0];
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
    version: api.version,
    propertyKey: id => api.propertyKey?.(id) || null,
    definition: kind => api.definition(canonical[kind] || kind),
    readDefinitions: kind => api.readDefinitions?.(canonical[kind] || kind) || [],
    matches: (fields, kind) => api.matches?.(fields, canonical[kind] || kind) || false,
    encode: (fields, existing) => {
      const kind = canonical[fields.kind] || fields.kind;
      if (api.version === 2 && typeof kind === "string"
        && ["account", "holding", "ledger", "finance-transaction", "investment-transaction", "finance-rule", "finance-budget"].includes(kind)
        && !api.definition(kind)) throw new Error(`Configure the ${kind} record classification in Global Context Menu before writing Finance notes.`);
      return api.encode(api.definition(kind) ? { ...fields, kind } : fields, existing);
    },
    decode: (fields, expectedKind) => {
      const hint = expectedKind && (canonical[expectedKind] || (api.definition(expectedKind) ? expectedKind : undefined));
      let decoded: Fields;
      try {
        decoded = api.decode(fields, hint);
      } catch (error) {
        // Older investment transactions can carry the ordinary transaction's
        // former tag. Their type distinguishes the two records, but only when
        // GCM now maps both to the same configured kind-list value. A present
        // kind list remains authoritative and must not be silently overridden.
        const primary = hint && api.definition(hint);
        let legacy: Fields | undefined;
        try { legacy = api.decode(fields); } catch { /* Keep the original mismatch. */ }
        const previous = typeof legacy?.kind === "string" && original[legacy.kind] ? api.definition(legacy.kind) : null;
        if (api.version !== 2 || !hint || !original[hint] || !primary || !("kindList" in primary)) throw error;
        const listKeys = Object.keys(fields).filter(key => key.toLowerCase() === primary.kindList.key.toLowerCase());
        if (listKeys.length > 1) throw error;
        const list = listKeys.length ? fields[listKeys[0]] : undefined;
        const sharedLegacy = list === undefined && previous && "kindList" in previous
          && primary.kindList.key.toLowerCase() === previous.kindList.key.toLowerCase()
          && primary.kindList.value.toLowerCase() === previous.kindList.value.toLowerCase();
        const sharedCurrent = Array.isArray(list)
          && list.some(value => typeof value === "string" && value.toLowerCase() === primary.kindList.value.toLowerCase())
          && api.matches?.(fields, hint) === true;
        if (!sharedLegacy && !sharedCurrent) throw error;
        decoded = { ...fields, kind: hint };
      }
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
