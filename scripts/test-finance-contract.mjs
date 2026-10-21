import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/finance-store.ts", import.meta.url), "utf8");
const atomicStore = readFileSync(new URL("../src/atomic-finance-store.ts", import.meta.url), "utf8");
const financeModals = readFileSync(new URL("../src/finance-modals.ts", import.meta.url), "utf8");
const connections = readFileSync(new URL("../src/connection-settings.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const classificationBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/classification.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const classification = await import(`data:text/javascript;base64,${Buffer.from(classificationBuild.outputFiles[0].text).toString("base64")}`);
const financeStoreBuild = await build({
  entryPoints: [fileURLToPath(new URL("../src/finance-store.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "mock-obsidian-finance-store",
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
        contents: [
          "export class App {}",
          "export class TFile {}",
          "export const normalizePath = (value) => value;",
          "export const parseYaml = value => JSON.parse(value);",
          "export const stringifyYaml = value => JSON.stringify(value) + '\\n';",
        ].join("\n"),
      }));
    },
  }],
});
const financeStoreModule = await import(`data:text/javascript;base64,${Buffer.from(financeStoreBuild.outputFiles[0].text).toString("base64")}`);
const settingsPersistenceBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/settings-persistence.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const settingsPersistence = await import(`data:text/javascript;base64,${Buffer.from(settingsPersistenceBuild.outputFiles[0].text).toString("base64")}`);
const mainActionBuild = await build({
  entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "mock-main-actions",
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "main-action-mock" }));
      builder.onResolve({ filter: /^\.\/plaid-client$/ }, () => ({ path: "plaid-client", namespace: "main-action-mock" }));
      builder.onResolve({ filter: /^\.\/plaid-link$/ }, () => ({ path: "plaid-link", namespace: "main-action-mock" }));
      builder.onLoad({ filter: /.*/, namespace: "main-action-mock" }, (args) => {
        if (args.path === "plaid-client") {
          return {
            contents: [
              "export class PlaidClient {",
              "  async createLinkToken() { return 'link-token'; }",
              "  async exchangePublicToken() { return { accessToken: 'access-token', itemId: 'provider-item' }; }",
              "}",
            ].join("\n"),
          };
        }
        if (args.path === "plaid-link") {
          return { contents: "export function assertLocalPlaidLinkAvailable() {} export async function openLocalPlaidLink() { return { publicToken: 'public-token', institutionName: 'Test Bank' }; }" };
        }
        return {
          contents: [
            "export class Plugin { constructor(app) { this.app = app; } }",
            "export class App {}",
            "export class ButtonComponent {}",
            "export class ItemView { constructor() { this.contentEl = {}; } }",
            "export class Menu {}",
            "export class Modal { open() { globalThis.__tpsOpenedModal = this; } }",
            "export class Notice { constructor(message) { globalThis.__tpsConnectNotices?.push(String(message)); } }",
            "export class PluginSettingTab {}",
            "export class SecretComponent {}",
            "export class Setting {}",
            "export class TFile {}",
            "globalThis.__tpsMainActionTFile = TFile;",
            "export class WorkspaceLeaf {}",
            "export const Platform = { isDesktopApp: true };",
            "export const normalizePath = (value) => value;",
          "export const parseYaml = value => JSON.parse(value);",
          "export const stringifyYaml = value => JSON.stringify(value) + '\\n';",
            "export const requestUrl = async () => ({ status: 200, json: {} });",
            "export const setIcon = () => {};",
          ].join("\n"),
        };
      });
    },
  }],
});
const mainActionModule = await import(`data:text/javascript;base64,${Buffer.from(mainActionBuild.outputFiles[0].text).toString("base64")}`);

function snapshotDashboardPlugin(app) {
  const plugin = new mainActionModule.default(app);
  plugin.settings = { financeFolder: "Finances", transactionLogTarget: "daily-note" };
  plugin.deviceState = { items: [] };
  plugin.createStore = () => ({
    readTransactionRecords: async () => [],
    readRules: () => [],
    readBudgetEntries: async () => [],
  });
  plugin.getPlaidSetupStatus = () => ({ state: "ready" });
  return plugin;
}


test("finance settings use a shallow routed hub with complete controls and actions", () => {
  for (const route of ["Data & storage", "Rules & budgets", "Properties"]) {
    assert.ok(settings.includes(`title: "${route}"`));
  }
  for (const control of [
    "Finance folder",
    "Legacy inline transactions",
    "Debug logging",
  ]) {
    assert.match(settings + connections, new RegExp(`setName\\("${control}"\\)`));
  }
  for (const action of ["Open Budgets Base", "Add rule", "Add budget"]) {
    assert.match(settings + connections, new RegExp(`setButtonText\\("${action}"\\)`));
  }
  assert.match(settings, /setButtonText\("Check old entries"\)/);
  assert.match(settings, /setButtonText\("Convert to transaction notes"\)/);
  assert.doesNotMatch(settings, /setName\("Record format"\)|setName\("Transaction discovery"\)|setName\("Default transaction location"\)/);

  assert.match(settings, /private activeRoute: FinanceSettingsRoute = "data"/);
  assert.match(settings, /"aria-pressed": String\(isActive\)/);
  assert.match(settings, /pageHeading\.focus\(\{ preventScroll: true \}\)/);
  assert.match(settings, /pageHeading\.scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(settings, /activeRouteButton\?\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);
  // The real-tab harness checks the intentional single-depth disclosures.
  assert.doesNotMatch(types, /activeRoute|settingsRoute/);

  assert.match(styles, /\.tps-finances-settings-hub\s*\{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.tps-finances-settings-route:focus-visible/);
  assert.match(styles, /@media \(max-width: 800px\)/);
  assert.match(styles, /\.tps-finances-settings-routes\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.tps-finances-settings-route\s*\{[^}]*height:\s*auto/s);
  assert.match(styles, /\.tps-finances-settings-page > h3\s*\{[^}]*scroll-margin-top:/s);
});

test("finance transactions use whole notes and inline conversion requires an explicit action", () => {
  assert.match(main, /private createStore\(\): AtomicFinanceStore/);
  assert.match(main, /return new AtomicFinanceStore\(this\.app, this\.settings\.financeFolder\)/);
  assert.doesNotMatch(atomicStore, /async applyTransactions\(/);
  assert.match(atomicStore, /async readTransactionRecords\(/);
  assert.doesNotMatch(atomicStore, /legacyDiscovery|readLegacyTransactionRecords\(source\)/);
  assert.match(main, /async migrateAtomicTransactions\(\)/);
  assert.match(atomicStore, /async migrateLegacyTransactionLedgers\(\)/);
  assert.doesNotMatch(main, /migrateLegacyTransactions\(store/);
  assert.match(readme, /Whole-note-only transactions/);
});

test("local classification is ordered, additive, and manual-first", () => {
  const transaction = { account: "Chase Sapphire", name: "WEEKLY SHOP", merchant: "HEB Grocery", amount: -42.12, providerCategory: "general_merchandise", categoryOverride: "", tags: ["#receipt"] };
  const rules = [
    { id: "later", name: "Later", enabled: true, priority: 200, accountContains: "", nameContains: "", merchantContains: "HEB", minAmount: null, maxAmount: null, category: "shopping", tags: ["#store"] },
    { id: "first", name: "Groceries", enabled: true, priority: 10, accountContains: "sapphire", nameContains: "weekly", merchantContains: "grocery", minAmount: 20, maxAmount: 100, category: "groceries", tags: ["food", "#receipt"] },
  ];
  assert.deepEqual(classification.classifyTransaction(transaction, rules), { category: "groceries", tags: ["#receipt", "#food"], source: "rule", ruleId: "first" });
  assert.deepEqual(classification.classifyTransaction({ ...transaction, categoryOverride: "household" }, rules), { category: "household", tags: ["#receipt", "#food"], source: "manual", ruleId: "first" });
});

test("dashboard classification prepares rule ordering once without changing legacy results", () => {
  const rules = [
    { id: "disabled", name: "Disabled", enabled: false, priority: 0, accountContains: "", nameContains: "", merchantContains: "", minAmount: null, maxAmount: null, category: "disabled", tags: ["disabled"] },
    { id: "tag-only-first", name: "Same", enabled: true, priority: 10, accountContains: "primary", nameContains: "", merchantContains: "", minAmount: null, maxAmount: null, category: "", tags: ["tag only"] },
    { id: "same-order-second", name: "Same", enabled: true, priority: 10, accountContains: "primary", nameContains: "", merchantContains: "", minAmount: null, maxAmount: null, category: "must-not-win", tags: ["second"] },
    { id: "groceries", name: "Groceries", enabled: true, priority: 20, accountContains: "", nameContains: "", merchantContains: "market", minAmount: 20, maxAmount: 100, category: "groceries", tags: ["food"] },
    { id: "fallback-account", name: "Fallback account", enabled: true, priority: 30, accountContains: "fallback", nameContains: "", merchantContains: "", minAmount: null, maxAmount: null, category: "account", tags: [] },
  ];
  const transactions = [
    { account: "Primary account", name: "Purchase", merchant: "Vendor", amount: -5, providerCategory: "provider", categoryOverride: "manual", tags: ["existing"] },
    { account: "Primary account", name: "Purchase", merchant: "Vendor", amount: -5, providerCategory: "provider", categoryOverride: "", tags: ["existing"] },
    { account: "Other", name: "Purchase", merchant: "Neighborhood Market", amount: -50, providerCategory: "provider", categoryOverride: "", tags: [] },
    { account: "Fallback account", accountSearchText: "", name: "Purchase", merchant: "Vendor", amount: -5, providerCategory: "", categoryOverride: "", tags: [] },
    { account: "Fallback account", accountSearchText: "Different account", name: "Purchase", merchant: "Vendor", amount: -5, providerCategory: "provider", categoryOverride: "", tags: [] },
    { account: "Other", name: "Purchase", merchant: "Vendor", amount: -5, providerCategory: "", categoryOverride: "", tags: [] },
  ];
  const legacyClassify = (transaction, sourceRules) => {
    const rule = sourceRules.filter((candidate) => candidate.enabled)
      .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
      .find((candidate) => classification.ruleMatches(candidate, transaction));
    return {
      category: transaction.categoryOverride || rule?.category || transaction.providerCategory || "uncategorized",
      tags: classification.normalizeTags([...transaction.tags, ...(rule?.tags || [])]),
      source: transaction.categoryOverride ? "manual" : rule?.category ? "rule" : transaction.providerCategory ? "provider" : "uncategorized",
      ruleId: rule?.id || "",
    };
  };
  const originalRuleOrder = rules.map(({ id }) => id);
  const prepared = classification.prepareTransactionClassifier(rules);

  for (const transaction of transactions) {
    const expected = legacyClassify(transaction, rules);
    assert.deepEqual(classification.classifyTransaction(transaction, rules), expected);
    assert.deepEqual(prepared(transaction), expected);
  }
  assert.deepEqual(rules.map(({ id }) => id), originalRuleOrder, "preparation must not mutate stored rule order");
  assert.deepEqual(prepared(transactions[0]), { category: "manual", tags: ["#existing", "#tag-only"], source: "manual", ruleId: "tag-only-first" });
  assert.deepEqual(prepared(transactions[1]), { category: "provider", tags: ["#existing", "#tag-only"], source: "provider", ruleId: "tag-only-first" });

  const orderingReads = { enabled: 0, priority: 0, name: 0 };
  const trackedRules = rules.map((rule) => {
    const tracked = { ...rule };
    for (const key of Object.keys(orderingReads)) {
      Object.defineProperty(tracked, key, {
        enumerable: true,
        get() {
          orderingReads[key] += 1;
          return rule[key];
        },
      });
    }
    return tracked;
  });
  const trackedClassifier = classification.prepareTransactionClassifier(trackedRules);
  const readsAfterPreparation = { ...orderingReads };
  for (let index = 0; index < 100; index += 1) trackedClassifier(transactions[index % transactions.length]);
  assert.deepEqual(orderingReads, readsAfterPreparation, "transaction classification must not repeat rule filtering or sorting");
  assert.equal(readsAfterPreparation.enabled, rules.length);

  const dashboardModelStart = main.indexOf("async getDashboardModel");
  const dashboardModelImplementation = main.slice(dashboardModelStart, main.indexOf("addCategorizationRule", dashboardModelStart));
  assert.match(dashboardModelImplementation, /const classifyForDashboard = prepareTransactionClassifier\(rules\)/);
  assert.match(dashboardModelImplementation, /const classification = classifyForDashboard\(resolved\)/);
  assert.doesNotMatch(dashboardModelImplementation, /classifyTransaction\(resolved, rules\)/);
});

test("monthly budget aggregation is equivalent across boundaries, categories, and numeric edge cases", () => {
  const month = "2026-07";
  const budgets = [
    { id: "groceries", name: "Groceries", category: " Groceries ", monthlyLimit: 500 },
    { id: "groceries-duplicate", name: "Groceries duplicate", category: "groceries", monthlyLimit: 250 },
    { id: "dining", name: "Dining", category: "dining out", monthlyLimit: 100 },
    { id: "empty", name: "Blank category", category: "   ", monthlyLimit: 50 },
    { id: "uncategorized", name: "Uncategorized", category: "uncategorized", monthlyLimit: 75 },
    { id: "runtime-coercion", name: "Runtime coercion", category: "runtime", monthlyLimit: 10 },
    { id: "travel", name: "Travel", category: "travel", monthlyLimit: 300 },
  ];
  const transaction = (overrides = {}) => ({
    date: "2026-07-15",
    amount: -1,
    category: "groceries",
    type: "transaction",
    subtype: "purchase",
    ...overrides,
  });
  const transactions = [
    transaction({ amount: -12.25 }),
    transaction({ amount: -7.75 }),
    transaction({ date: "2026-07invalid", amount: -3 }),
    transaction({ date: "2026-07", amount: -1 }),
    transaction({ date: "2026-08-01", amount: -100 }),
    transaction({ amount: 25 }),
    transaction({ amount: -0 }),
    transaction({ amount: Number.NaN }),
    transaction({ amount: -80, type: "investmentTransaction" }),
    transaction({ amount: -60, subtype: "transfer" }),
    transaction({ amount: -9.5, category: "DINING_OUT" }),
    transaction({ amount: -0.5, category: " dining   out ", subtype: "fee" }),
    transaction({ amount: -4, category: "" }),
    transaction({ amount: -6, category: " \t" }),
    transaction({ amount: -11, category: "uncategorized" }),
    transaction({ amount: "-4", category: "runtime" }),
  ];
  const normalizeCategory = (value) => value.trim().toLocaleLowerCase().replace(/[\s_]+/g, "-");
  const legacyBudgetProgress = budgets.map((budget) => ({
    ...budget,
    spent: -transactions.filter((item) => item.date.startsWith(month)
      && (item.amount < 0 || item.amount > 0)
      && item.type === "transaction"
      && ["purchase", "payment", "fee", "cash-advance", "refund"].includes(item.subtype)
      && normalizeCategory(item.category) === normalizeCategory(budget.category))
      .reduce((sum, item) => sum + item.amount, 0),
  }));

  const aggregated = classification.calculateMonthlyBudgetProgress(budgets, transactions, month);

  assert.deepEqual(aggregated, legacyBudgetProgress);
  assert.deepEqual(aggregated.map(({ id }) => id), budgets.map(({ id }) => id), "budget order must remain unchanged");
  assert.equal(aggregated[0].spent, -1);
  assert.equal(aggregated[1].spent, -1, "duplicate normalized categories must receive the same total");
  assert.equal(aggregated[2].spent, 10);
  assert.equal(aggregated[3].spent, 10, "blank normalized categories retain their existing uncategorized behavior");
  assert.equal(aggregated[4].spent, 11);
  assert.equal(Number.isNaN(aggregated[5].spent), true, "runtime numeric coercion must match the prior reducer");
  assert.equal(Object.is(aggregated[6].spent, -0), true, "an unmatched budget must retain the prior negative-zero total");
  const dashboardModelStart = main.indexOf("async getDashboardModel");
  const dashboardModelImplementation = main.slice(dashboardModelStart, main.indexOf("addCategorizationRule", dashboardModelStart));
  assert.match(dashboardModelImplementation, /const month = localDate\(new Date\(\)\)\.slice\(0, 7\)/);
  assert.match(dashboardModelImplementation, /calculateMonthlyBudgetProgress\(budgetEntries\.filter\([\s\S]*?transactions, month\)/);
  assert.doesNotMatch(dashboardModelImplementation, /transactions\.filter\(/);
});

test("monthly budget aggregation traverses transactions once regardless of budget count", () => {
  const forbiddenTransactions = [{
    date: "2026-07-15",
    amount: -1,
    category: "groceries",
    type: "transaction",
    subtype: "purchase",
  }];
  forbiddenTransactions[Symbol.iterator] = () => {
    throw new Error("zero budgets must retain the prior zero-transaction traversal");
  };
  assert.deepEqual(classification.calculateMonthlyBudgetProgress([], forbiddenTransactions, "2026-07"), []);

  const budgets = Array.from({ length: 120 }, (_, index) => ({
    id: `budget-${index}`,
    name: `Budget ${index}`,
    category: `category-${index % 12}`,
    monthlyLimit: 100,
  }));
  const transactions = Array.from({ length: 300 }, (_, index) => ({
    date: index % 5 === 0 ? "2026-06-30" : "2026-07-15",
    amount: -(index + 1),
    category: `category-${index % 12}`,
    type: "transaction",
    subtype: index % 7 === 0 ? "transfer" : "purchase",
  }));
  let iteratorStarts = 0;
  let yieldedTransactions = 0;
  const nativeIterator = transactions[Symbol.iterator].bind(transactions);
  transactions[Symbol.iterator] = function* iterator() {
    iteratorStarts += 1;
    for (const item of nativeIterator()) {
      yieldedTransactions += 1;
      yield item;
    }
  };
  transactions.filter = () => {
    throw new Error("budget aggregation must not filter the transaction collection per budget");
  };

  const result = classification.calculateMonthlyBudgetProgress(budgets, transactions, "2026-07");

  assert.equal(result.length, budgets.length);
  assert.equal(iteratorStarts, 1);
  assert.equal(yieldedTransactions, transactions.length);
});

test("snapshot reads reuse one document and select the latest file in one pass", () => {
  const latestSnapshotStart = main.indexOf("private latestSnapshotFile(");
  const latestSnapshotImplementation = main.slice(latestSnapshotStart, main.indexOf("private accountFiles()", latestSnapshotStart));
  assert.match(latestSnapshotImplementation, /for \(const file of files\?\.files \?\? this\.app\.vault\.getMarkdownFiles\(\)\)/);
  assert.doesNotMatch(latestSnapshotImplementation, /\.filter\(|\.sort\(/);

  const readDocumentStart = main.indexOf("private async readLatestSnapshotDocument");
  const readDocumentImplementation = main.slice(readDocumentStart, main.indexOf("private parseSnapshotBalanceMap", readDocumentStart));
  assert.match(readDocumentImplementation, /const file = this\.latestSnapshotFile\(files\)/);
  assert.match(readDocumentImplementation, /const date = String\(/);
  assert.match(readDocumentImplementation, /const content = await this\.app\.vault\.cachedRead\(file\)/);
  assert.match(readDocumentImplementation, /lines: content\.split\("\\n"\)/);
  assert.ok(readDocumentImplementation.indexOf("const date = String(") < readDocumentImplementation.indexOf("await this.app.vault.cachedRead(file)"),
    "the selected snapshot date must be captured before yielding to the vault read");

  const holdingsStart = main.indexOf("private parseSnapshotHoldings");
  const holdingsImplementation = main.slice(holdingsStart, readDocumentStart);
  assert.match(holdingsImplementation, /for \(const account of accounts\)/);
  assert.match(holdingsImplementation, /snapshot\.lines\.filter/);
  assert.doesNotMatch(holdingsImplementation, /latestSnapshotFile|cachedRead|this\.accountFiles\(\)/);

  const balancesStart = main.indexOf("private parseSnapshotBalanceMap");
  const balancesImplementation = main.slice(balancesStart, latestSnapshotStart);
  assert.match(balancesImplementation, /lines\.filter/);
  assert.doesNotMatch(balancesImplementation, /latestSnapshotFile|cachedRead/);

  const dashboardStart = main.indexOf("async getDashboardModel(");
  const dashboardEnd = main.indexOf("\n  addManualAccount(", dashboardStart);
  assert.ok(dashboardStart >= 0 && dashboardEnd > dashboardStart, "inspect only the dashboard reader, not adjacent form commands");
  const dashboardImplementation = main.slice(dashboardStart, dashboardEnd);
  assert.equal((dashboardImplementation.match(/readLatestSnapshotDocument\([^)]*\)/g) || []).length, 1);
  assert.match(dashboardImplementation, /const accountLabels = new Map<string, AccountLabel>\(\)/);
  assert.match(dashboardImplementation, /readAccountsFromVault\(snapshot, accountLabels, sourcePaths, files\)/);
  assert.match(dashboardImplementation, /parseSnapshotHoldings\(snapshot, accounts, sourcePaths, files\)/);

  assert.doesNotMatch(main, /readLatestSnapshot\(|readSnapshotBalanceMap\(/);

  const files = [
    { path: "Finances/Snapshots/no-date.md", date: "" },
    { path: "Finances/Snapshots/2026-06-30.md", date: "2026-06-30" },
    { path: "Other/2027-01-01.md", date: "2027-01-01" },
    { path: "Finances/Snapshots/2026-07-01-a.md", date: "2026-07-01" },
    { path: "Finances/Snapshots/2026-07-01-z.md", date: "2026-07-01" },
  ];
  const prefix = "Finances/Snapshots/";
  const legacy = files.filter((file) => file.path.startsWith(prefix)).sort((left, right) =>
    right.date.localeCompare(left.date) || right.path.localeCompare(left.path))[0] || null;
  let selected = null;
  let selectedDate = "";
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const dateOrder = file.date.localeCompare(selectedDate);
    if (!selected || dateOrder > 0 || (dateOrder === 0 && file.path.localeCompare(selected.path) > 0)) {
      selected = file;
      selectedDate = file.date;
    }
  }
  assert.equal(selected, legacy);
});

test("dashboard account labels reuse the account scan without changing label semantics", async () => {
  const checkingFile = {
    path: "Finances/Accounts/Checking.md",
    basename: "Checking",
  };
  const labelOnlyFile = {
    path: "Finances/Accounts/Label Only.MD",
    basename: "Label Only",
  };
  const unrelatedFile = {
    path: "Other/Ignore.md",
    basename: "Ignore",
  };
  const files = [checkingFile, unrelatedFile, labelOnlyFile];
  const caches = new Map([
    [checkingFile, {
      frontmatter: {
        financeAccountId: "checking",
        institution: "Test Bank",
        accountName: "Checking",
        accountMask: "1234",
        accountType: "depository",
        currency: "USD",
      },
    }],
    [labelOnlyFile, {
      frontmatter: {
        institution: "Example Bank",
        title: "Reserve",
        accountMask: "4321",
      },
    }],
  ]);
  let fileListReads = 0;
  let metadataReads = 0;
  const app = {
    vault: {
      getMarkdownFiles() {
        fileListReads += 1;
        return files;
      },
    },
    metadataCache: {
      getFileCache(file) {
        metadataReads += 1;
        return caches.get(file) || {};
      },
    },
  };
  const plugin = new mainActionModule.default(app);
  plugin.settings = { financeFolder: "Finances", transactionLogTarget: "daily-note" };
  plugin.deviceState = { items: [] };
  plugin.createStore = () => ({
    readTransactionRecords: async () => [{
      line: "- Groceries [type:: transaction] [financeId:: transaction-one] [date:: 2026-07-15] [account:: [[Finances/Accounts/Label Only]]] [amount:: -12.5] [currency:: USD] [pending:: false] [providerCategory:: Groceries] [subtype:: purchase]",
      path: "Daily/2026-07-15.md",
      lineNumber: 7,
    }],
    readRules: () => [{
      id: "account-label-rule",
      name: "Account label rule",
      enabled: true,
      priority: 10,
      accountContains: "example bank reserve",
      nameContains: "",
      merchantContains: "",
      minAmount: null,
      maxAmount: null,
      category: "Matched account",
      tags: ["account-match"],
    }],
    readBudgetEntries: async () => [],
  });
  plugin.getPlaidSetupStatus = () => ({ state: "ready" });

  const model = await plugin.getDashboardModel();

  assert.deepEqual(model.accounts.map((account) => ({
    id: account.financeAccountId,
    name: account.name,
    institution: account.institutionName,
    mask: account.mask,
    path: account.path,
  })), [{
    id: "checking",
    name: "Checking",
    institution: "Test Bank",
    mask: "1234",
    path: checkingFile.path,
  }], "an account note without financeAccountId must remain label-only");
  assert.deepEqual(model.transactions.map((transaction) => ({
    account: transaction.account,
    accountPath: transaction.accountPath,
    accountSearchText: transaction.accountSearchText,
    category: transaction.category,
    categorySource: transaction.categorySource,
    tags: transaction.tags,
    ruleId: transaction.ruleId,
    sourcePath: transaction.sourcePath,
    sourceLine: transaction.sourceLine,
  })), [{
    account: "Reserve •4321",
    accountPath: "Finances/Accounts/Label Only",
    accountSearchText: "Example Bank Reserve 4321 Label Only",
    category: "Matched account",
    categorySource: "rule",
    tags: ["#account-match"],
    ruleId: "account-label-rule",
    sourcePath: "Daily/2026-07-15.md",
    sourceLine: 7,
  }]);
  assert.equal(fileListReads, 1, "one model-scoped file list feeds snapshot selection and account labels");
  assert.equal(metadataReads, 2, "each account note's metadata must be read once while account cards and labels are built");
});

test("dashboard model reads one coherent snapshot document for balances and holdings", async () => {
  const accountFile = {
    path: "Finances/Accounts/Checking.md",
    basename: "Checking",
  };
  const snapshotFile = {
    path: "Finances/Snapshots/2026-07-30.md",
    basename: "2026-07-30",
  };
  const snapshotContent = (value) => [
    "---",
    "date: 2026-07-30",
    "---",
    `- Checking [type:: balanceSnapshot] [account:: [[Finances/Accounts/Checking]]] [balance:: ${value}] [available:: ${value - 10}] [currency:: USD]`,
    `- Security [type:: holdingSnapshot] [account:: [[Finances/Accounts/Checking]]] [securityId:: security] [quantity:: 1] [price:: ${value}] [value:: ${value}] [costBasis:: 50] [currency:: USD]`,
  ].join("\n");
  const contents = [snapshotContent(100), snapshotContent(200)];
  let fileListReads = 0;
  let snapshotReads = 0;
  const app = {
    vault: {
      getMarkdownFiles() {
        fileListReads += 1;
        return [accountFile, snapshotFile];
      },
      async cachedRead(file) {
        assert.equal(file, snapshotFile);
        const content = contents[Math.min(snapshotReads, contents.length - 1)];
        snapshotReads += 1;
        return content;
      },
    },
    metadataCache: {
      getFileCache(file) {
        if (file === snapshotFile) return { frontmatter: { date: "2026-07-30" } };
        return {
          frontmatter: {
            financeAccountId: "finance-account",
            institution: "Test Bank",
            accountName: "Checking",
            accountType: "depository",
            currency: "USD",
          },
        };
      },
    },
  };
  const plugin = snapshotDashboardPlugin(app);

  const model = await plugin.getDashboardModel();

  assert.deepEqual({
    snapshotReads,
    fileListReads,
    balance: model.accounts[0].current,
    available: model.accounts[0].available,
    holdingValue: model.holdings[0].value,
  }, {
    snapshotReads: 1,
    fileListReads: 1,
    balance: 100,
    available: 90,
    holdingValue: 100,
  }, "one model must parse balances and holdings from one selected, immutable snapshot read");
  assert.equal(model.holdings[0].asOf, "2026-07-30");
});

test("snapshot reuse preserves no-snapshot and rich parsing semantics", async () => {
  const checkingFile = {
    path: "Finances/Accounts/Checking.MD",
    basename: "Checking",
  };
  const brokerageFile = {
    path: "Finances/Accounts/Brokerage.md",
    basename: "Brokerage",
  };
  const unrelatedFile = {
    path: "Other/Ignore.md",
    basename: "Ignore",
  };
  const accountCaches = new Map([
    [checkingFile, {
      frontmatter: {
        financeAccountId: "checking",
        institution: "Test Bank",
        accountName: "Checking",
        accountType: "depository",
        currency: "EUR",
      },
    }],
    [brokerageFile, {
      frontmatter: {
        financeAccountId: "brokerage",
        institution: "Test Bank",
        accountName: "Brokerage",
        accountType: "investment",
      },
    }],
  ]);
  let fileListReads = 0;
  let snapshotReads = 0;
  const noSnapshotApp = {
    vault: {
      getMarkdownFiles() {
        fileListReads += 1;
        return [checkingFile, brokerageFile, unrelatedFile];
      },
      async cachedRead() {
        snapshotReads += 1;
        throw new Error("no snapshot must not be read");
      },
    },
    metadataCache: {
      getFileCache(file) {
        return accountCaches.get(file) || {};
      },
    },
  };

  const noSnapshotModel = await snapshotDashboardPlugin(noSnapshotApp).getDashboardModel();

  assert.equal(fileListReads, 1);
  assert.equal(snapshotReads, 0);
  assert.deepEqual(noSnapshotModel.accounts.map((account) => ({
    id: account.financeAccountId,
    current: account.current,
    available: account.available,
    currency: account.currency,
  })), [
    { id: "checking", current: null, available: null, currency: "EUR" },
    { id: "brokerage", current: null, available: null, currency: "USD" },
  ]);
  assert.deepEqual(noSnapshotModel.holdings, []);

  const olderSnapshot = {
    path: "Finances/Snapshots/older.md",
    basename: "older",
  };
  const sameDateA = {
    path: "Finances/Snapshots/2026-07-30-a.md",
    basename: "2026-07-30-a",
  };
  const sameDateZ = {
    path: "Finances/Snapshots/2026-07-30-z.md",
    basename: "2026-07-30-z",
  };
  const selectedContent = [
    "- Checking first [type:: balanceSnapshot] [account:: [[Finances/Accounts/Checking]]] [balance:: 1] [available:: 2] [currency:: CAD]",
    "- Checking last [type:: balanceSnapshot] [account:: [[Finances/Accounts/Checking]]] [balance:: 123] [available:: invalid] [currency:: CAD]",
    "- Brokerage [type:: balanceSnapshot] [account:: [[Finances/Accounts/Brokerage]]] [balance:: 456] [available:: 400] [currency:: JPY]",
    "- Explicit [type:: holdingSnapshot] [account:: [[Finances/Accounts/Checking]]] [securityId:: explicit] [quantity:: 2] [price:: 3] [value:: 6] [costBasis:: 4] [currency:: GBP] [asOf:: 2026-07-29] [stale:: true]",
    "- Account currency [type:: holdingSnapshot] [account:: [[Finances/Accounts/Brokerage]]] [securityId:: account] [quantity:: invalid] [price:: invalid] [value:: invalid]",
    "- Unknown account [type:: holdingSnapshot] [account:: [[Finances/Accounts/Missing]]] [securityId:: unknown] [quantity:: 1] [price:: 2] [value:: 2] [costBasis:: invalid]",
  ].join("\n");
  fileListReads = 0;
  snapshotReads = 0;
  const semanticApp = {
    vault: {
      getMarkdownFiles() {
        fileListReads += 1;
        return [olderSnapshot, sameDateA, checkingFile, unrelatedFile, sameDateZ, brokerageFile];
      },
      async cachedRead(file) {
        snapshotReads += 1;
        assert.equal(file, sameDateZ, "equal snapshot dates must retain the released descending-path tiebreak");
        return selectedContent;
      },
    },
    metadataCache: {
      getFileCache(file) {
        if (file === olderSnapshot) return { frontmatter: { date: "2026-07-29" } };
        if (file === sameDateA || file === sameDateZ) return { frontmatter: { date: "2026-07-30" } };
        return accountCaches.get(file) || {};
      },
    },
  };

  const semanticModel = await snapshotDashboardPlugin(semanticApp).getDashboardModel();
  const accountsById = new Map(semanticModel.accounts.map((account) => [account.financeAccountId, account]));

  assert.equal(fileListReads, 1);
  assert.equal(snapshotReads, 1);
  assert.deepEqual({
    checking: {
      current: accountsById.get("checking").current,
      available: accountsById.get("checking").available,
      currency: accountsById.get("checking").currency,
    },
    brokerage: {
      current: accountsById.get("brokerage").current,
      available: accountsById.get("brokerage").available,
      currency: accountsById.get("brokerage").currency,
    },
  }, {
    checking: { current: 123, available: null, currency: "EUR" },
    brokerage: { current: 456, available: 400, currency: "JPY" },
  });
  assert.deepEqual(semanticModel.holdings.map((holding) => ({
    id: holding.securityId,
    account: holding.financeAccountId,
    quantity: holding.quantity,
    price: holding.price,
    value: holding.value,
    costBasis: holding.costBasis,
    currency: holding.currency,
    asOf: holding.asOf,
    stale: holding.stale,
  })), [
    { id: "explicit", account: "checking", quantity: 2, price: 3, value: 6, costBasis: 4, currency: "GBP", asOf: "2026-07-29", stale: true },
    { id: "account", account: "brokerage", quantity: 0, price: 0, value: 0, costBasis: null, currency: "JPY", asOf: "2026-07-30", stale: false },
    { id: "unknown", account: "", quantity: 1, price: 2, value: 2, costBasis: null, currency: "USD", asOf: "2026-07-30", stale: false },
  ]);
});

test("snapshot reuse preserves filename dates and propagates selected-file read failures", async () => {
  const accountFile = {
    path: "Finances/Accounts/Checking.md",
    basename: "Checking",
  };
  const undatedSnapshot = {
    path: "Finances/Snapshots/2026-07-31.md",
    basename: "2026-07-31",
  };
  let reads = 0;
  const app = {
    vault: {
      getMarkdownFiles: () => [accountFile, undatedSnapshot],
      async cachedRead(file) {
        reads += 1;
        assert.equal(file, undatedSnapshot);
        return "- Holding [type:: holdingSnapshot] [account:: [[Finances/Accounts/Checking]]] [securityId:: holding] [quantity:: 1] [price:: 1] [value:: 1]";
      },
    },
    metadataCache: {
      getFileCache(file) {
        if (file === accountFile) return { frontmatter: { financeAccountId: "checking", accountName: "Checking" } };
        return {};
      },
    },
  };

  const model = await snapshotDashboardPlugin(app).getDashboardModel();

  assert.equal(reads, 1);
  assert.equal(model.holdings[0].asOf, "2026-07-31");

  reads = 0;
  app.vault.cachedRead = async () => {
    reads += 1;
    throw new Error("selected snapshot disappeared");
  };
  await assert.rejects(snapshotDashboardPlugin(app).getDashboardModel(), /selected snapshot disappeared/);
  assert.equal(reads, 1, "a failed selected-file read must not reselect or fall back to another snapshot");
});

test("transaction routing controls are retired without changing historical note properties", () => {
  assert.doesNotMatch(settings, /Default transaction location|Record format|Transaction discovery/);
  assert.doesNotMatch(main, /setAccountTransactionLogTarget|setDefaultTransactionLogTarget|resolveFinanceTransactionTarget/);
  assert.match(atomicStore, /financePath\(this\.folder, "Transactions",/);
});

test("finance modal saves are single-flight and dashboard month keys are local", () => {
  assert.match(financeModals, /if \(saving\) return/);
  assert.match(financeModals, /saveButton\.setDisabled\(true\)/);
  assert.match(financeModals, /await save\(\)/);
  assert.match(financeModals, /TPS Finances could not save/);
});

test("settings writes merge local intent into latest data and preserve external and future fields", async () => {
  assert.match(main, /new CoalescedSnapshotWriter/);
  assert.match(main, /settingsWriter\.save\(this\.settings\)/);
  assert.doesNotMatch(main, /await this\.saveData\(this\.settings\)/);
  const baseline = normalizeWriterSettings({ financeFolder: "Finances", oauthRedirectUri: "https://old.example" });
  const state = { current: { ...baseline } };
  let disk = {
    financeFolder: "Finances",
    oauthRedirectUri: "https://external.example",
    settingsVersion: 99,
    futureProviderOption: { enabled: true },
  };
  const writes = [];
  const writer = createSettingsWriter({ baseline, state, read: () => disk, write: (value) => {
    writes.push(structuredClone(value));
    disk = structuredClone(value);
  } });

  state.current.financeFolder = "Money";
  await writer.save(state.current);

  assert.deepEqual(disk, {
    financeFolder: "Money",
    oauthRedirectUri: "https://external.example",
    settingsVersion: 99,
    futureProviderOption: { enabled: true },
  });
  assert.equal(writes.length, 1);
  assert.equal(state.current.oauthRedirectUri, "https://external.example", "the live baseline should adopt unrelated external changes");
  assert.equal(state.current.financeFolder, "Money");
});

test("settings writes retain an old-new-old revert while an older write is in flight", async () => {
  const baseline = normalizeWriterSettings({ financeFolder: "Finances", oauthRedirectUri: "https://old.example" });
  const state = { current: { ...baseline } };
  let disk = { ...baseline, futureSetting: "preserved" };
  const writes = [];
  const writer = createSettingsWriter({ baseline, state, read: () => disk, write: async (value) => {
    const gate = deferred();
    writes.push({ value: structuredClone(value), gate });
    await gate.promise;
    disk = structuredClone(value);
  } });

  state.current.oauthRedirectUri = "https://new.example";
  const first = writer.save(state.current);
  await waitFor(() => writes.length === 1);
  state.current.oauthRedirectUri = "https://old.example";
  const reverted = writer.save(state.current);
  state.current.financeFolder = "Money";
  const newest = writer.save(state.current);
  assert.strictEqual(reverted, first);
  assert.strictEqual(newest, first);

  writes[0].gate.resolve();
  await waitFor(() => writes.length === 2);
  assert.equal(writes[1].value.oauthRedirectUri, "https://old.example");
  assert.equal(writes[1].value.financeFolder, "Money");
  writes[1].gate.resolve();
  await Promise.all([first, reverted, newest]);
  assert.equal(disk.oauthRedirectUri, "https://old.example");
  assert.equal(disk.financeFolder, "Money");
  assert.equal(disk.futureSetting, "preserved");
});

test("external reconciliation is rebased into pending snapshots without becoming local intent", async () => {
  const baseline = normalizeWriterSettings({ financeFolder: "Finances", oauthRedirectUri: "https://old.example" });
  const state = { current: { ...baseline } };
  let disk = { ...baseline, oauthRedirectUri: "https://external-one.example", futureSetting: "preserved" };
  const writes = [];
  let reads = 0;
  let newest;
  let writer;
  writer = new settingsPersistence.CoalescedSnapshotWriter({
    initialSnapshot: baseline,
    readLatest: async () => {
      reads += 1;
      if (reads === 2) {
        disk.oauthRedirectUri = "https://external-two.example";
        state.current.financeFolder = "Plans";
        newest = writer.save(state.current);
      }
      return structuredClone(disk);
    },
    writeMerged: async (value) => {
      const gate = deferred();
      writes.push({ value: structuredClone(value), gate });
      await gate.promise;
      disk = structuredClone(value);
    },
    normalize: normalizeWriterSettings,
    reconcile: (requested, persisted) => {
      state.current = settingsPersistence.reconcilePersistedSnapshot(state.current, requested, persisted);
    },
  });

  state.current.financeFolder = "Money";
  const first = writer.save(state.current);
  await waitFor(() => writes.length === 1);
  state.current.financeFolder = "Budget";
  const pending = writer.save(state.current);
  writes[0].gate.resolve();
  await waitFor(() => writes.length === 2);
  writes[1].gate.resolve();
  await waitFor(() => writes.length === 3);
  assert.strictEqual(pending, first);
  assert.strictEqual(newest, first);
  assert.equal(writes[2].value.oauthRedirectUri, "https://external-two.example");
  writes[2].gate.resolve();
  await Promise.all([first, pending, newest]);
  assert.equal(disk.oauthRedirectUri, "https://external-two.example");
  assert.equal(disk.financeFolder, "Plans");
  assert.equal(disk.futureSetting, "preserved");
});

test("a pending newest settings snapshot supersedes a failed in-flight write", async () => {
  const baseline = normalizeWriterSettings({ financeFolder: "Finances", oauthRedirectUri: "https://old.example" });
  const state = { current: { ...baseline } };
  let disk = { ...baseline, unknown: true };
  const firstWrite = deferred();
  let attempts = 0;
  const writer = createSettingsWriter({ baseline, state, read: () => disk, write: async (value) => {
    attempts += 1;
    if (attempts === 1) {
      await firstWrite.promise;
      throw new Error("simulated stale write failure");
    }
    disk = structuredClone(value);
  } });

  state.current.oauthRedirectUri = "https://failed.example";
  const first = writer.save(state.current);
  await waitFor(() => attempts === 1);
  state.current.oauthRedirectUri = "https://newest.example";
  const newest = writer.save(state.current);
  assert.strictEqual(newest, first);
  firstWrite.resolve();

  await Promise.all([first, newest]);
  assert.equal(attempts, 2);
  assert.equal(disk.oauthRedirectUri, "https://newest.example");
  assert.equal(disk.unknown, true);
});

test("completion-window callers remain pending until their newer settings are durable", async () => {
  const baseline = normalizeWriterSettings({ financeFolder: "Finances", oauthRedirectUri: "https://old.example" });
  const state = { current: { ...baseline } };
  let disk = { ...baseline };
  const writes = [];
  const writer = createSettingsWriter({ baseline, state, read: () => disk, write: async (value) => {
    const gate = deferred();
    writes.push({ value: structuredClone(value), gate });
    await gate.promise;
    disk = structuredClone(value);
  } });

  state.current.oauthRedirectUri = "https://first.example";
  const first = writer.save(state.current);
  await waitFor(() => writes.length === 1);
  let late;
  writes[0].gate.promise.then(() => Promise.resolve()).then(() => {
    state.current.oauthRedirectUri = "https://late.example";
    late = writer.save(state.current);
  });
  writes[0].gate.resolve();
  await waitFor(() => writes.length === 2);
  assert.strictEqual(late, first);

  let cycleResolved = false;
  void first.then(() => { cycleResolved = true; });
  await Promise.resolve();
  assert.equal(cycleResolved, false);
  writes[1].gate.resolve();
  await Promise.all([first, late]);
  assert.equal(cycleResolved, true);
  assert.equal(disk.oauthRedirectUri, "https://late.example");
});

function createSettingsWriter({ baseline, state, read, write }) {
  return new settingsPersistence.CoalescedSnapshotWriter({
    initialSnapshot: baseline,
    readLatest: async () => structuredClone(read()),
    writeMerged: async (value) => write(value),
    normalize: normalizeWriterSettings,
    reconcile: (requested, persisted) => {
      state.current = settingsPersistence.reconcilePersistedSnapshot(state.current, requested, persisted);
    },
  });
}

function normalizeWriterSettings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    financeFolder: String(source.financeFolder || "Finances"),
    oauthRedirectUri: String(source.oauthRedirectUri || ""),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for deferred settings write.");
}

function plaidTransaction(id, accountId = "account") {
  return { transaction_id: id, account_id: accountId, date: "2026-01-01", amount: 1, pending: false };
}

function plaidRemovedTransaction(id, accountId = "account") {
  return { transaction_id: id, account_id: accountId };
}

function plaidSyncResponse({ added = [], modified = [], removed = [], nextCursor, hasMore }) {
  return {
    status: 200,
    json: { added, modified, removed, next_cursor: nextCursor, has_more: hasMore },
  };
}

await import("./test-transaction-index-batching.mjs");

test('summary separates cash, debt, and currencies and uses authoritative investment balance', async () => {
 const result=await build({entryPoints:[fileURLToPath(new URL('../src/finance-summary.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
 const {accountSummaries}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const accounts=[{financeAccountId:'cash',type:'depository',current:1000,currency:'USD'}, {financeAccountId:'card',type:'credit',current:-200,currency:'USD'}, {financeAccountId:'invest',type:'investment',current:500,currency:'USD'}, {financeAccountId:'eur',type:'depository',current:100,currency:'EUR'}];
 assert.deepEqual(accountSummaries(accounts,[{financeAccountId:'invest',value:450,currency:'USD'}]),[{currency:'USD',netWorth:1300,cash:1000,investments:500,debt:200,assets:0},{currency:'EUR',netWorth:100,cash:100,investments:0,debt:0,assets:0}]);
 assert.equal(accountSummaries([{...accounts[2],current:null}],[{financeAccountId:'invest',value:450,currency:'USD'}])[0].investments,450);
});



test('refunds reduce category spending while transfers are excluded',()=>{
 const transactions=[{date:'2026-09-13',amount:-100,type:'transaction',subtype:'purchase',category:'food'},{date:'2026-09-13',amount:20,type:'transaction',subtype:'refund',category:'food'},{date:'2026-09-13',amount:-100,type:'transaction',subtype:'transfer-out',category:'food'}];
 assert.equal(classification.calculateMonthlyBudgetProgress([{category:'food',monthlyLimit:100}],transactions,'2026-09')[0].spent,80);
});

test('USD budgets do not add foreign-currency spending',()=>{
 const rows=[{date:'2026-09-13',amount:-10,type:'transaction',subtype:'purchase',category:'food',currency:'USD'},{date:'2026-09-13',amount:-50,type:'transaction',subtype:'purchase',category:'food',currency:'EUR'}];
 assert.equal(classification.calculateMonthlyBudgetProgress([{category:'food',monthlyLimit:100}],rows,'2026-09')[0].spent,10);
});

test('blank and slash finance destinations survive saving, serialized persistence, and reload normalization',async()=>{
 const plugin=new mainActionModule.default({});let disk;let refreshed=0;
 plugin.settings={financeFolder:'Finances'};
 plugin.settingsWriter={save:async value=>{disk=JSON.parse(JSON.stringify(value));}};
 plugin.refreshDashboard=async()=>{refreshed++;};
 for(const value of ['', '/', '  ', '.']) {
  await plugin.setFinanceFolder(value);assert.equal(disk.financeFolder,'');
  plugin.settings=JSON.parse(JSON.stringify(disk));await plugin.saveSettings();assert.equal(plugin.settings.financeFolder,'');
 }
 assert.equal(refreshed,0);
 await plugin.setFinanceFolder('Money/Personal');assert.equal(disk.financeFolder,'Money/Personal');
 await assert.rejects(plugin.setFinanceFolder('../Outside'),/inside the vault/);assert.equal(disk.financeFolder,'Money/Personal');
 plugin.settings={};await plugin.saveSettings();assert.equal(disk.financeFolder,'Finances');
});

test('root dashboard identifies accounts and snapshots without mistaking holdings or ordinary notes for them',()=>{
 const files=[{path:'Wallet.md',basename:'Wallet',fm:{kind:'account',financeAccountId:'a',accountType:'depository',current:10}},{path:'Holding.md',basename:'Holding',fm:{type:'holding',financeAccountId:'a',securityId:'s'}},{path:'Journal.md',basename:'Journal',fm:{date:'2099-01-01'}},{path:'Old/Snapshot.md',fm:{type:'financeSnapshot',date:'2026-09-16'}}];
 const plugin=new mainActionModule.default({vault:{getMarkdownFiles:()=>files},metadataCache:{getFileCache:f=>({frontmatter:f.fm})}});
 plugin.settings={financeFolder:'',recordMode:'atomic-note'};
 assert.equal(plugin.readAccountsFromVault(null).length,1);assert.deepEqual(plugin.accountFiles().map(f=>f.path),['Wallet.md']);assert.equal(plugin.latestSnapshotFile().path,'Old/Snapshot.md');
});

test('Browse all transactions opens the whole-note Base without loading the dashboard',async()=>{
 const File=globalThis.__tpsMainActionTFile;
 const base=new File(),alternate=new File();
 base.path='Finances/Transactions.base';alternate.path='Finances/Transactions (Atomic notes).base';
 const files=new Map([[base.path,base],[alternate.path,alternate]]),opened=[];
 let scans=0,reads=0,reveals=0;
 const leaf={async openFile(file){opened.push(file);}};
 const app={vault:{getAbstractFileByPath:path=>files.get(path)||null,getMarkdownFiles(){scans++;return[];},cachedRead(){reads++;throw Error('unexpected body read');}},workspace:{getLeaf:mode=>{assert.equal(mode,'tab');return leaf;},revealLeaf(value){assert.equal(value,leaf);reveals++;}}};
 const plugin=new mainActionModule.default(app);plugin.settings={financeFolder:'Finances',recordMode:'atomic-note'};
 await plugin.openFinanceBase('Transactions');
 plugin.settings.recordMode='atomic-line';await plugin.openFinanceBase('Transactions');
 plugin.settings.recordMode='atomic-note';files.delete(alternate.path);await plugin.openFinanceBase('Transactions');
 assert.deepEqual(opened,[alternate,alternate,base]);assert.equal(reveals,3);
 assert.deepEqual({scans,reads},{scans:0,reads:0});
 files.delete(base.path);await assert.rejects(plugin.openFinanceBase('Transactions'),/Transactions\.base could not be found/);
 assert.equal(reveals,3,'a missing Base must not open a new tab');
});

test('dashboard passes its display or source mode to the budget reader',async()=>{
 const plugin=new mainActionModule.default({vault:{getMarkdownFiles:()=>[]},metadataCache:{getFileCache:()=>null}});plugin.settings={financeFolder:'Finances',recordMode:'atomic-note'};
 plugin.readLatestSnapshotDocument=async()=>null;plugin.readAccountsFromVault=()=>[];plugin.parseSnapshotHoldings=()=>[];
 plugin.getConnectedItems=()=>[];plugin.getRelayStatus=()=>null;plugin.getPlaidSetupStatus=()=>({state:'ready'});
 const observed=[];plugin.createStore=()=>({readTransactionRecords:async source=>{observed.push(['transactions',source]);return [];},readRules:()=>[],readBudgetEntries:async(_paths,source)=>{observed.push(['budgets',source]);return [];}});
 for(const mode of ['metadata','source'])await plugin.getDashboardModel(new Set(),mode);
 assert.deepEqual(observed,[['transactions','metadata'],['budgets','metadata'],['transactions','source'],['budgets','source']]);
});

test('budget editor opens current source values, guards identity, and saves against their revision',async()=>{
 const plugin=new mainActionModule.default({});
 const displayed={id:'plan',name:'Indexed old name',category:'',bucket:'flex',currency:'USD',monthlyLimit:100,sourcePath:'Plan.md',revision:'old'};
 const current={...displayed,name:'Current name',monthlyLimit:150,revision:'current'};
 plugin.getDashboardModel=async()=>({budgetEntries:[current],transactions:[],accounts:[]});
 const saves=[];plugin.createStore=()=>({ensureStructure:async()=>{},saveBudgetEntry:async(input,original)=>{saves.push({input,original});}});
 plugin.refreshDashboard=async()=>{};globalThis.__tpsOpenedModal=null;globalThis.__tpsConnectNotices=[];
 await plugin.openBudgetEditor(displayed);
 assert.strictEqual(globalThis.__tpsOpenedModal.budget,current);
 await globalThis.__tpsOpenedModal.save({...current,monthlyLimit:175});
 assert.deepEqual(saves,[{input:{...current,monthlyLimit:175},original:current}]);
 plugin.getDashboardModel=async()=>({budgetEntries:[{...current,id:'replacement'}],transactions:[],accounts:[]});globalThis.__tpsOpenedModal=null;
 await plugin.openBudgetEditor(displayed);
 assert.equal(globalThis.__tpsOpenedModal,null,'a new budget at the same path must not be edited from the old row');
 plugin.getDashboardModel=async()=>({budgetEntries:[],transactions:[],accounts:[]});globalThis.__tpsOpenedModal=null;
 await plugin.openBudgetEditor(displayed);
 assert.equal(globalThis.__tpsOpenedModal,null);assert.match(globalThis.__tpsConnectNotices.at(-1),/budget note changed or was removed/);
});

test('readable merchant titles keep existing bank-description classification rules working', () => {
 const rule={id:'r',name:'Bank descriptor',enabled:true,priority:0,accountContains:'',nameContains:'POS MARKET #1234',merchantContains:'',minAmount:null,maxAmount:null,category:'Groceries',tags:[]};
 const transaction={account:'Checking',name:'Market',providerName:'POS MARKET #1234',merchant:'Market',amount:-20,providerCategory:'food',categoryOverride:'',tags:[]};
 assert.equal(classification.ruleMatches(rule,transaction),true);
 assert.equal(classification.ruleMatches({...rule,nameContains:'Market'},transaction),true);
 assert.equal(classification.ruleMatches({...rule,nameContains:'Gas'},transaction),false);
 assert.equal(classification.classifyTransaction(transaction,[rule]).category,'Groceries');
});


test('account display uses the shared title without requiring a duplicate accountName and retains legacy search text',()=>{
 const file={path:'Account.md',basename:'Account',fm:{kind:'account',id:'a',title:'Chosen account',accountName:'Provider account',accountType:'depository',currency:'USD',current:10}};
 const plugin=new mainActionModule.default({vault:{getMarkdownFiles:()=>[file]},metadataCache:{getFileCache:f=>({frontmatter:f.fm})}});
 plugin.settings={financeFolder:''};const labels=new Map();
 assert.equal(plugin.readAccountsFromVault(null,labels)[0].name,'Chosen account');
 assert.match(labels.get('Account').display,/Chosen account/);assert.match(labels.get('Account').search,/Provider account/);
 delete file.fm.accountName;assert.equal(plugin.readAccountsFromVault(null)[0].name,'Chosen account');
 file.fm.title='Chosen account •1234';file.fm.accountMask='1234';const accounts=plugin.readAccountsFromVault(null,labels);
 assert.equal(labels.get('Account').display,'Chosen account •1234');
});

test('cleaned holdings resolve the account wikilink without a foreign account property or extra reads',()=>{
 const holding={path:'Holding.md',fm:{kind:'holding',type:'holding',id:'holding-1',account:'[[Broker.md|Brokerage]]',name:'Fund',active:true,quantity:2,price:3,value:6,currency:'USD'}};
 let scans=0,reads=0,writes=0;
 const app={vault:{getMarkdownFiles(){scans++;return[holding]},cachedRead(){reads++;throw Error('unexpected read')},read(){reads++;throw Error('unexpected read')},create(){writes++;throw Error('unexpected write')}},metadataCache:{getFileCache:f=>({frontmatter:f.fm})}};
 const plugin=new mainActionModule.default(app);plugin.settings={financeFolder:''};
 const accounts=[{path:'Broker.md',financeAccountId:'canonical-account',currency:'USD'}];
 const [row]=plugin.parseSnapshotHoldings(null,accounts);
 assert.equal(row.financeAccountId,'canonical-account');assert.equal(row.value,6);
 assert.deepEqual({scans,reads,writes},{scans:1,reads:0,writes:0});
 holding.fm.financeAccountId='stale-old-reference';assert.equal(plugin.parseSnapshotHoldings(null,accounts)[0].financeAccountId,'canonical-account','the visible link is authoritative when present');
 delete holding.fm.account;assert.equal(plugin.parseSnapshotHoldings(null,accounts)[0].financeAccountId,'stale-old-reference','retain read compatibility for old holdings without links');
});
