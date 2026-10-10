import { App, TFile, parseYaml, stringifyYaml } from "obsidian";

type Fields = Record<string, any>;
const RECORD_TYPE_FOR_KIND: Record<string, string> = {
  transaction: "transaction",
  investmentTransaction: "investmentTransaction",
  holding: "holding",
};
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
const reserved = new Set(["__proto__", "constructor", "prototype", "position", "file", "id", "tpsId", "financeId", "financeAccountId", "financeBudgetId", "financeRuleId", "securityId"]);

export function normalizePropertyNames(value?: Partial<FinancePropertyNames>): FinancePropertyNames {
  const result: FinancePropertyNames = { keys: {} };
  const owners = new Map<string, string>();
  for (const canonical of FINANCE_PROPERTY_KEYS) {
    const explicit = Boolean(value?.keys && own(value.keys, canonical));
    const key = explicit ? value!.keys![canonical] : canonical;
    if (typeof key !== "string" || !key.trim() || key !== key.trim() || /[\r\n\t\[\]#.:]/.test(key) || [...reserved].some(value => value.toLowerCase() === key.toLowerCase())) {
      throw new Error(`Choose a plain, nonempty property name for ${canonical}.`);
    }
    if ((FINANCE_PROPERTY_KEYS.some(value => value.toLowerCase() === key.toLowerCase() && value !== canonical)) || owners.has(key.toLowerCase())) throw new Error(`Property “${key}” is already used by another finance field.`);
    owners.set(key.toLowerCase(), canonical);
    if (explicit) result.keys[canonical] = key;
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
  constructor(names?: Partial<FinancePropertyNames>, private readonly kinds?: KindCodec,
    readonly identityKey: string | null = null) {
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
    if (identityKey !== null) this.assertIdentityKey(identityKey);
  }
  key(canonical: string): string {
    if (canonical === "date" && this.kinds?.version === 2) return this.kinds.propertyKey?.("scheduled") || this.names.keys.date || "date";
    return this.names.keys[canonical] || canonical;
  }
  get customized(): boolean { return Boolean(this.identityKey || this.kinds || Object.entries(this.names.keys).some(([field, key]) => field !== key)); }

  /** Logical DTO names remain stable; account IDs on other records are foreign keys. */
  ownIdentityKey(fields: Fields): string | null {
    const kind = typeof fields.kind === "string" ? fields.kind : fields.type;
    if (kind === "transaction" || kind === "investmentTransaction") return "financeId";
    if (kind === "account") return "financeAccountId";
    if (kind === "financeRule") return "financeRuleId";
    if (kind === "financeBudget") return "financeBudgetId";
    return null;
  }

  private identityValue(raw: Fields, key: string): { key: string; value: string } | null {
    const keys = Object.keys(raw).filter(candidate => candidate.toLowerCase() === key.toLowerCase());
    if (keys.length > 1) throw new Error(`Duplicate Finance identity property: ${key}.`);
    if (!keys.length) return null;
    const value = raw[keys[0]];
    if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error(`Invalid Finance identity property: ${key}.`);
    return { key: keys[0], value };
  }

  private readIdentity(fields: Fields, raw: Fields): Fields {
    if (!this.identityKey) return fields;
    const self = this.ownIdentityKey(fields);
    if (!self) return fields;
    const primary = this.identityValue(raw, this.identityKey), legacy = this.identityValue(raw, self);
    if (primary && legacy && primary.value !== legacy.value) throw new Error("Finance record IDs disagree. Resolve the conflict before editing or syncing this note.");
    if (primary) delete fields[primary.key];
    if (legacy) delete fields[legacy.key];
    if (primary || legacy) fields[self] = (primary || legacy)!.value;
    return fields;
  }

  private needsTypeDiscriminator(kind: string): boolean {
    if (kind !== "transaction" && kind !== "investmentTransaction") return false;
    const other = kind === "transaction" ? "investmentTransaction" : "transaction";
    const current = this.kinds?.definition(kind);
    const counterpart = this.kinds?.definition(other);
    return Boolean(current && counterpart && "kindList" in current && "kindList" in counterpart
      && current.kindList.key.toLowerCase() === counterpart.kindList.key.toLowerCase()
      && current.kindList.value.toLowerCase() === counterpart.kindList.value.toLowerCase());
  }

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
      if (!RECORD_TYPE_FOR_KIND[fields.kind] && (raw.financeId || (this.identityKey && raw[this.identityKey])) && this.kinds.matches?.(raw, "transaction")
        && this.kinds.matches?.(raw, "investmentTransaction")) {
        throw new Error("Finance transaction classification is ambiguous. Configure distinct kinds or a discriminator in Global Context Menu.");
      }
      if (typeof fields.kind === "string" && RECORD_TYPE_FOR_KIND[fields.kind]) fields.type = RECORD_TYPE_FOR_KIND[fields.kind];
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
      return this.readIdentity(fields, raw);
    }
    return this.readIdentity(this.kinds ? this.kinds.decode(fields) : fields, raw);
  }

  write(fields: Fields, existing?: Fields): Fields {
    if (this.kinds?.version === 2 && own(fields, "date") && !this.kinds.propertyKey?.("scheduled")) {
      throw new Error("Configure the Scheduled custom-property key in Global Context Menu before writing Finance dates.");
    }
    const raw: Fields = {};
    const source = { ...fields };
    if (this.identityKey) {
      const persisted = existing && this.identityValue(existing, this.identityKey);
      const supplied = this.identityValue(source, this.identityKey);
      if (persisted && supplied && persisted.value !== supplied.value) throw new Error("Finance record identity changed during editing.");
      const self = this.ownIdentityKey(source);
      if (self) {
        const logical = this.identityValue(source, self), primary = this.identityValue(source, this.identityKey);
        if (logical && primary && logical.value !== primary.value) throw new Error("Finance record IDs disagree. Resolve the conflict before writing this note.");
        const legacy = existing && this.identityValue(existing, self);
        if (persisted && legacy && persisted.value !== legacy.value) throw new Error("Finance record IDs disagree. Resolve the conflict before writing this note.");
        const current = persisted || legacy, proposed = logical || primary;
        if (existing && proposed && !current) throw new Error("Finance record identity is missing. An existing note cannot acquire an ID through editing.");
        if (current && proposed && current.value !== proposed.value) throw new Error("Finance record identity changed during editing.");
        if (logical) delete source[logical.key];
        if (primary) delete source[primary.key];
        // Existing-note edits preserve their current identity owner. Only creation
        // writes a primary ID for a legacy logical DTO; explicit adoption is separate.
        if (existing) {
          if (persisted) source[this.identityKey] = persisted.value;
          else if (legacy) source[legacy.key] = legacy.value;
        } else if (proposed) source[this.identityKey] = proposed.value;
      } else if (existing) {
        if (supplied && !persisted) throw new Error("Finance record identity is missing. An existing note cannot acquire an ID through editing.");
        if (persisted) {
          if (supplied) delete source[supplied.key];
          source[persisted.key] = persisted.value;
        }
      }
    }
    if (this.kinds?.version === 2 && typeof source.kind === "string" && RECORD_TYPE_FOR_KIND[source.kind]
      && own(source, "type") && source.type !== RECORD_TYPE_FOR_KIND[source.kind]) {
      throw new Error(`Finance record type conflicts with ${source.kind} classification.`);
    }
    if (this.kinds?.version === 2 && typeof source.kind === "string"
      && RECORD_TYPE_FOR_KIND[source.kind] === source.type && !this.needsTypeDiscriminator(source.kind)) {
      delete source.type;
    }
    for (const [canonical, value] of Object.entries(this.kinds ? this.kinds.encode(source, existing) : source)) {
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
    if (this.identityKey) {
      const self = this.ownIdentityKey(before);
      if (self) {
        const legacy = this.identityValue(raw, self);
        if (legacy && own(next, this.identityKey) && legacy.value === next[this.identityKey]) delete raw[legacy.key];
        const primary = this.identityValue(raw, this.identityKey);
        if (primary && primary.key !== this.identityKey && own(next, this.identityKey)) delete raw[primary.key];
      }
    }
    if (this.kinds?.version === 2) {
      const typeKey = this.key("type");
      if (own(raw, typeKey) && !own(next, typeKey) && raw[typeKey] === before.type
        && typeof before.kind === "string" && RECORD_TYPE_FOR_KIND[before.kind] === before.type) delete raw[typeKey];
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
    const classificationKeys = [this.kinds?.propertyKey?.("kind"), ...["account", "transaction", "investmentTransaction", "holding", "ledger", "financeRule", "financeBudget"].map(kind => {
      const definition = this.kinds?.definition(kind);
      return definition && ("kindList" in definition ? definition.kindList.key : "scalar" in definition ? definition.scalar.key : "key" in definition ? definition.key : null);
    })].filter((value): value is string => typeof value === "string");
    if (!key || key !== key.trim() || /[\r\n\t\[\]#.:]/.test(key)
      || ["__proto__", "constructor", "prototype", "position", "file", "financeId", "financeAccountId", "financeBudgetId", "financeRuleId", "securityId"].some(field => field.toLowerCase() === key.toLowerCase())
      || classificationKeys.some(value => value.toLowerCase() === key.toLowerCase())
      || FINANCE_PROPERTY_KEYS.some(canonical => this.key(canonical).toLowerCase() === key.toLowerCase())) throw new Error(`Finance property “${key}” conflicts with the identity property configured in Global Context Menu.`);
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
    const identityFields = new Set(["financeId", "financeRuleId", "financeBudgetId",
      ...(content.includes('kind == "account"') ? ["financeAccountId"] : [])]);
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
      const match = expression(mapping);
      return operator === '!=' ? `!${match}` : match;
    });
      const identified = this.identityKey ? classified.replace(/(?<![\w.])(?:note\.)?(financeId|financeAccountId|financeRuleId|financeBudgetId)\s*!=\s*null\b/g,
        (predicate, key) => identityFields.has(key)
          ? `(note[${JSON.stringify(this.identityKey)}] != null || note[${JSON.stringify(key)}] != null)` : predicate) : classified;
      return identified.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_][A-Za-z0-9_]*\b/g, (token, offset) => {
      if (this.identityKey && identityFields.has(token) && identified[offset - 1] !== ".") return `note[${JSON.stringify(this.identityKey)}]`;
      if (!FINANCE_PROPERTY_KEYS.includes(token) || identified[offset - 1] === "." || this.key(token) === token) return token;
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
  return new FinanceProperties((app as any).plugins?.plugins?.["tps-finances"]?.settings?.propertyNames,
    financeKindCodec((app as any).plugins?.plugins?.["tps-global-context-menu"]?.api?.frontmatterKinds), financeIdentityKey(app));
}

/** GCM's normalized storage contract, rather than a possibly retired settings format. */
export function financeIdentityKey(app: App): string {
  const gcm = (app as any).plugins?.plugins?.["tps-global-context-menu"];
  if (!gcm) return "id"; // Standalone default; installed GCM owns configuration.
  if (typeof gcm.api?.nativeRecords?.getStorageProfile !== "function") throw new Error("Update and enable TPS Global Context Menu before using Finance record IDs.");
  const profile = gcm.api.nativeRecords.getStorageProfile();
  if (profile?.identityMode !== "property" || typeof profile.identityPropertyKey !== "string") throw new Error("Configure a shared identity property in Global Context Menu before using Finance records.");
  return profile.identityPropertyKey;
}
