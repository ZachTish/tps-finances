import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/finance-store.ts", import.meta.url), "utf8");
const transactionContentSource = readFileSync(new URL("../src/transaction-content.ts", import.meta.url), "utf8");
const financeModals = readFileSync(new URL("../src/finance-modals.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/dashboard-view.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/plaid-client.ts", import.meta.url), "utf8");
const link = readFileSync(new URL("../src/plaid-link.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
const investmentSyncSource = readFileSync(new URL("../src/investment-sync.ts", import.meta.url), "utf8");
const deviceStateSource = readFileSync(new URL("../src/device-state.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const classificationBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/classification.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const classification = await import(`data:text/javascript;base64,${Buffer.from(classificationBuild.outputFiles[0].text).toString("base64")}`);
const credentialBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/plaid-credentials.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const credentialHelpers = await import(`data:text/javascript;base64,${Buffer.from(credentialBuild.outputFiles[0].text).toString("base64")}`);
const investmentSyncBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/investment-sync.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const investmentSync = await import(`data:text/javascript;base64,${Buffer.from(investmentSyncBuild.outputFiles[0].text).toString("base64")}`);
const deviceStateBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/device-state.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const deviceState = await import(`data:text/javascript;base64,${Buffer.from(deviceStateBuild.outputFiles[0].text).toString("base64")}`);
const transactionContentBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/transaction-content.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const transactionContent = await import(`data:text/javascript;base64,${Buffer.from(transactionContentBuild.outputFiles[0].text).toString("base64")}`);
const settingsPersistenceBuild = await build({ entryPoints: [fileURLToPath(new URL("../src/settings-persistence.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const settingsPersistence = await import(`data:text/javascript;base64,${Buffer.from(settingsPersistenceBuild.outputFiles[0].text).toString("base64")}`);
const plaidClientBuild = await build({
  entryPoints: [fileURLToPath(new URL("../src/plaid-client.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "mock-obsidian-request",
    setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const requestUrl = (options) => globalThis.__tpsPlaidRequestUrl(options);" }));
    },
  }],
});
const plaidClientModule = await import(`data:text/javascript;base64,${Buffer.from(plaidClientBuild.outputFiles[0].text).toString("base64")}`);

test("TPS Finances is a desktop finance view with device-local authentication", () => {
  assert.equal(manifest.id, "tps-finances");
  assert.equal(manifest.isDesktopOnly, true);
  assert.match(main, /registerView\(TPS_FINANCES_VIEW_TYPE/);
  assert.match(main, /SecretStorage|getSecret/);
  assert.match(main, /DEVICE_STATE_SECRET/);
  assert.match(main, /Platform\.isDesktopApp/);
  assert.match(link, /127\.0\.0\.1/);
  assert.match(link, /cdn\.plaid\.com\/link\/v2\/stable\/link-initialize\.js/);
  assert.match(link, /let completing=false/);
  assert.match(link, /const response=await fetch\(complete/);
  assert.match(link, /if\(!response\.ok\)throw/);
  assert.match(link, /onExit\(err\)\{\s*if\(completing\)return/);
  assert.doesNotMatch(main, /accessToken.*saveData|saveData\([^)]*deviceState/);
});

test("finance settings use a shallow routed hub with complete controls and actions", () => {
  for (const route of ["Plaid setup", "Data & routing", "Connections", "Rules & budgets"]) {
    assert.ok(settings.includes(`title: "${route}"`));
  }
  for (const control of [
    "Finance folder",
    "Plaid environment",
    "Plaid client ID",
    "Plaid secret",
    "OAuth redirect URI",
    "Transaction history",
    "Default transaction location",
    "Debug logging",
  ]) {
    assert.match(settings, new RegExp(`setName\\("${control}"\\)`));
  }
  for (const action of ["Connect with Plaid", "Sync finances", "Open finances", "Add rule", "Add budget"]) {
    assert.match(settings, new RegExp(`setButtonText\\("${action}"\\)`));
  }

  assert.match(settings, /private activeRoute: FinanceSettingsRoute = "plaid"/);
  assert.match(settings, /"aria-pressed": String\(isActive\)/);
  assert.match(settings, /pageHeading\.focus\(\{ preventScroll: true \}\)/);
  assert.match(settings, /pageHeading\.scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(settings, /activeRouteButton\?\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);
  assert.match(settings, /this\.renderSettings\(false, "Plaid client ID"\)/);
  assert.match(settings, /this\.renderSettings\(false, "Plaid secret"\)/);
  assert.match(settings, /await this\.plugin\.runConnectPlaid\("settings"\);\s*this\.renderSettings\(true\)/);
  assert.match(settings, /await this\.plugin\.runSync\("settings"\);\s*this\.renderSettings\(true\)/);
  assert.match(main, /runConnectPlaid\(source: "command" \| "settings"\): Promise<void>/);
  assert.match(main, /runSync\(reason: string\): Promise<void>/);
  assert.doesNotMatch(settings, /createEl\("details"/);
  assert.doesNotMatch(types, /activeRoute|settingsRoute/);

  assert.match(styles, /\.tps-finances-settings-hub\s*\{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.tps-finances-settings-route:focus-visible/);
  assert.match(styles, /@media \(max-width: 800px\)/);
  assert.match(styles, /\.tps-finances-settings-routes\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.tps-finances-settings-route\s*\{[^}]*height:\s*auto/s);
  assert.match(styles, /\.tps-finances-settings-page > h3\s*\{[^}]*scroll-margin-top:/s);
});

test("finance transactions are contract-native daily-note log lines", () => {
  assert.match(readme, /Bank and investment transactions are plain `log` bullets in the configured daily note/);
  assert.match(store, /resolveTransactionTarget\(\{/);
  assert.match(store, /date: transaction\.date/);
  assert.match(store, /upsertTransactionContent\(content, transaction\.financeId, line\)/);
  assert.match(store, /`\[type:: \$\{transaction\.kind\}\]`/);
  assert.match(store, /`\[financeId:: \$\{transaction\.financeId\}\]`/);
  assert.match(store, /`\[account::/);
  assert.match(store, /`\[amount::/);
  assert.match(store, /`\[subtype:: \$\{inlineValue\(transaction\.subtype\)\}\]`/);
  assert.doesNotMatch(store, /## Transactions/);
  assert.match(store, /findFinanceLedgerFile\(`\$\{this\.rootFolder\}\/Snapshots\/`, "financeSnapshot", "date", date\)/);
  assert.match(store, /String\(frontmatter\.type \|\| ""\) === type && String\(frontmatter\[key\] \|\| ""\) === value/);
  assert.match(store, /providerCategory/);
  assert.match(store, /categoryOverride/);
  assert.match(store, /findTransactionMetadata/);
  assert.match(store, /\[asOf::/);
  assert.match(store, /\[stale:: true\]/);
  assert.match(store, /migrateLegacyTransactionLedgers/);
  assert.match(store, /removeEmptyLegacyLedger/);
  assert.match(main, /dailyNotes\?\.ensureForIsoDate/);
  assert.match(main, /getDailyNotePathForIsoDate/);
  assert.match(readme, /Plaid categories are retained as `providerCategory`/);
  assert.match(readme, /Monthly category budgets are durable `financeBudget` notes/);
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
      && item.amount < 0
      && item.type === "transaction"
      && ["purchase", "payment", "fee", "cash-advance"].includes(item.subtype)
      && normalizeCategory(item.category) === normalizeCategory(budget.category))
      .reduce((sum, item) => sum + item.amount, 0),
  }));

  const aggregated = classification.calculateMonthlyBudgetProgress(budgets, transactions, month);

  assert.deepEqual(aggregated, legacyBudgetProgress);
  assert.deepEqual(aggregated.map(({ id }) => id), budgets.map(({ id }) => id), "budget order must remain unchanged");
  assert.equal(aggregated[0].spent, 24);
  assert.equal(aggregated[1].spent, 24, "duplicate normalized categories must receive the same total");
  assert.equal(aggregated[2].spent, 10);
  assert.equal(aggregated[3].spent, 10, "blank normalized categories retain their existing uncategorized behavior");
  assert.equal(aggregated[4].spent, 11);
  assert.equal(Number.isNaN(aggregated[5].spent), true, "runtime numeric coercion must match the prior reducer");
  assert.equal(Object.is(aggregated[6].spent, -0), true, "an unmatched budget must retain the prior negative-zero total");
  const dashboardModelStart = main.indexOf("async getDashboardModel");
  const dashboardModelImplementation = main.slice(dashboardModelStart, main.indexOf("addCategorizationRule", dashboardModelStart));
  assert.match(dashboardModelImplementation, /const month = localDate\(new Date\(\)\)\.slice\(0, 7\)/);
  assert.match(dashboardModelImplementation, /calculateMonthlyBudgetProgress\(store\.readBudgets\(\), transactions, month\)/);
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

test("snapshot reads reuse parsed accounts and select the latest file in one pass", () => {
  const latestSnapshotStart = main.indexOf("private latestSnapshotFile()");
  const latestSnapshotImplementation = main.slice(latestSnapshotStart, main.indexOf("private accountFiles()", latestSnapshotStart));
  assert.match(latestSnapshotImplementation, /for \(const file of this\.app\.vault\.getMarkdownFiles\(\)\)/);
  assert.doesNotMatch(latestSnapshotImplementation, /\.filter\(|\.sort\(/);

  const readLatestStart = main.indexOf("private async readLatestSnapshot");
  const readLatestImplementation = main.slice(readLatestStart, main.indexOf("private async readSnapshotBalanceMap", readLatestStart));
  assert.match(readLatestImplementation, /for \(const account of accounts\)/);
  assert.doesNotMatch(readLatestImplementation, /this\.accountFiles\(\)/);

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

test("transaction ownership supports daily-note defaults and per-account overrides", () => {
  assert.match(types, /transactionLogTarget: TransactionLogTarget/);
  assert.match(types, /transactionLogTarget: "daily-note"/);
  assert.match(settings, /Default transaction location/);
  assert.match(settings, /setDefaultTransactionLogTarget/);
  assert.match(main, /setAccountTransactionLogTarget/);
  assert.match(main, /transactionRouteOverrides/);
  assert.match(main, /resolveFinanceTransactionTarget/);
  assert.match(store, /rerouteTransactions/);
  assert.match(store, /resolveTransactionTarget/);
  assert.ok(store.includes('\\\\[\\\\[[^\\\\]]+\\\\]\\\\]'));
  assert.match(readme, /Each account card can inherit that default or explicitly choose daily notes\/account note/);
  assert.match(readme, /Changing either route moves existing identified transactions to the resolved owner; it does not keep mirrored copies/);
});

test("transaction moves and updates preserve concurrent note edits atomically", () => {
  const original = "User text\n- Old [financeId:: finance-one]\n- Duplicate [financeId:: finance-one]\nTail\n";
  const replacement = "- Updated [financeId:: finance-one] [amount:: -12]";
  assert.equal(
    transactionContent.upsertTransactionContent(original, "finance-one", replacement),
    `User text\n${replacement}\nTail\n`,
  );
  assert.equal(
    transactionContent.appendTransactionIfMissing("User text\n", "finance-one", replacement),
    `User text\n${replacement}\n`,
  );
  assert.equal(
    transactionContent.appendTransactionIfMissing(`User text\n${replacement}\n`, "finance-one", replacement),
    `User text\n${replacement}\n`,
  );
  assert.equal(transactionContent.removeTransactionContent(original, "finance-one"), "User text\nTail\n");
  assert.match(store, /vault\.process\(target, \(content\) => upsertTransactionContent/);
  assert.match(store, /vault\.process\(dailyNote, \(content\) => appendTransactionIfMissing/);
  assert.doesNotMatch(store, /vault\.modify\(target, appendLine/);
  assert.ok(transactionContentSource.includes("transactionMarker"));
});

test("finance modal saves are single-flight and dashboard month keys are local", () => {
  assert.match(financeModals, /if \(saving\) return/);
  assert.match(financeModals, /saveButton\.setDisabled\(true\)/);
  assert.match(financeModals, /await save\(\)/);
  assert.match(financeModals, /TPS Finances could not save/);
  assert.match(dashboard, /now\.getFullYear\(\)/);
  assert.match(dashboard, /now\.getMonth\(\) \+ 1/);
  assert.doesNotMatch(dashboard, /toISOString\(\)\.slice\(0, 7\)/);
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

test("Plaid sync handles cursor patches and investment products", () => {
  assert.match(client, /"\/transactions\/sync"/);
  assert.match(client, /response\.added/);
  assert.match(client, /response\.modified/);
  assert.match(client, /response\.removed/);
  assert.match(client, /TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION/);
  assert.match(client, /"\/investments\/holdings\/get"/);
  assert.match(client, /"\/investments\/transactions\/get"/);
  assert.match(client, /offset: page \* 500/);
  assert.match(client, /total_investment_transactions/);
  assert.match(client, /amount: -numberOrZero\(transaction\.amount\)/);
  assert.match(client, /isLiabilityType\(type\) \? -Math\.abs\(current\) : current/);
  assert.match(client, /PRODUCT_NOT_READY/);
  assert.match(client, /"Plaid-Version"/);
  assert.match(types, /lastInvestmentTransactionSyncAt: string/);
  assert.match(investmentSyncSource, /lastSuccessfulSyncAt/);
});

test("Plaid credential selection rejects missing and conflicting secrets without exposing values", () => {
  const secrets = new Map([["client", "client-value"], ["environment", "environment-value"], ["same-value", "duplicate"]]);
  const readSecret = (name) => secrets.get(name) || null;
  assert.deepEqual(credentialHelpers.inspectPlaidCredentials("client", "environment", readSecret, 0), {
    state: "ready",
    clientIdConfigured: true,
    secretConfigured: true,
    connectedItems: 0,
  });
  assert.equal(credentialHelpers.inspectPlaidCredentials("same-value", "same-value", readSecret).state, "conflicting-credentials");
  secrets.set("different-name", "duplicate");
  assert.equal(credentialHelpers.inspectPlaidCredentials("same-value", "different-name", readSecret).state, "conflicting-credentials");
  assert.throws(
    () => credentialHelpers.readPlaidCredentials("same-value", "same-value", readSecret),
    (error) => /two different Obsidian secrets/.test(error.message) && !error.message.includes("duplicate"),
  );
  assert.equal(credentialHelpers.inspectPlaidCredentials("missing", "environment", readSecret).state, "missing-credentials");

  secrets.set("spaced-client", "  client-value\n");
  secrets.set("spaced-environment", "\tenvironment-value  ");
  assert.deepEqual(credentialHelpers.readPlaidCredentials("spaced-client", "spaced-environment", readSecret), {
    clientId: "client-value",
    secret: "environment-value",
  });
  secrets.set("whitespace-only", " \n\t ");
  assert.equal(credentialHelpers.inspectPlaidCredentials("whitespace-only", "spaced-environment", readSecret).state, "missing-credentials");
});

test("legacy Item migration freezes the current client-ID secret reference without exposing secret values", () => {
  const rawItems = [
    { localItemId: "legacy-local", accessToken: "legacy-token", environment: "production" },
    { localItemId: "current-local", accessToken: "current-token", environment: "sandbox", plaidClientIdSecretName: "existing-client-ref", plaidSecretName: "environment-ref" },
    { localItemId: "invalid-without-token" },
  ];
  const normalized = deviceState.normalizeDeviceItems(rawItems, "current-client-ref", "current-environment-ref");
  assert.equal(normalized.skipped, 1);
  assert.equal(normalized.migratedClientIdItems, 1);
  assert.equal(normalized.items[0].plaidClientIdSecretName, "current-client-ref");
  assert.equal(normalized.items[0].plaidSecretName, "current-environment-ref");
  assert.equal(normalized.items[1].plaidClientIdSecretName, "existing-client-ref");
  assert.equal(normalized.items[0].lastInvestmentTransactionSyncAt, "");
  assert.equal(rawItems[0].plaidClientIdSecretName, undefined);
  assert.match(deviceStateSource, /existingClientIdSecretName \|\| currentClientIdSecretName/);
  assert.match(main, /legacy-client-id-references-migrated/);
  assert.match(main, /setSecret\(DEVICE_STATE_SECRET, JSON\.stringify\(state\)\)/);
});

test("Plaid transport pins the API contract and reports safe structured provider errors", async () => {
  let captured;
  globalThis.__tpsPlaidRequestUrl = async (options) => {
    captured = options;
    return { status: 200, json: { link_token: "link-test" } };
  };
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  assert.equal(await plaid.createLinkToken("user-test", 1000, ""), "link-test");
  assert.equal(captured.url, "https://sandbox.plaid.com/link/token/create");
  assert.equal(captured.headers["Plaid-Version"], "2020-09-14");
  assert.equal(captured.headers["PLAID-CLIENT-ID"], "client-test");
  assert.equal(captured.headers["PLAID-SECRET"], "secret-test");
  assert.equal(JSON.parse(captured.body).transactions.days_requested, 730);

  globalThis.__tpsPlaidRequestUrl = async () => ({
    status: 401,
    json: { error_code: "INVALID_API_KEYS", error_message: "The API keys are invalid.", request_id: "request-test" },
  });
  await assert.rejects(
    () => plaid.createLinkToken("user-test", 30, ""),
    (error) => error instanceof plaidClientModule.PlaidApiError
      && error.code === "INVALID_API_KEYS"
      && error.message.includes("request-test")
      && !error.message.includes("secret-test"),
  );
});

test("optional Investments failures do not block core account and transaction sync", async () => {
  globalThis.__tpsPlaidRequestUrl = async () => ({
    status: 400,
    json: { error_code: "PRODUCT_NOT_ENABLED", error_message: "Investments is unavailable." },
  });
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  const item = { accessToken: "access-test" };
  const state = { providerIdentityMap: {} };
  assert.deepEqual(await plaid.getHoldings(item, state), { status: "unavailable", code: "PRODUCT_NOT_ENABLED", requestId: "" });
  assert.deepEqual(await plaid.getInvestmentTransactions(item, state, "2026-01-01", "2026-01-31"), { status: "unavailable", code: "PRODUCT_NOT_ENABLED", requestId: "" });

  globalThis.__tpsPlaidRequestUrl = async () => ({
    status: 400,
    json: { error_code: "INSTITUTION_DOWN", error_message: "Try again later." },
  });
  assert.equal((await plaid.getHoldings(item, state)).status, "pending");

  globalThis.__tpsPlaidRequestUrl = async (options) => options.url.endsWith("/investments/holdings/get")
    ? { status: 200, json: { holdings: [], securities: [] } }
    : { status: 200, json: { investment_transactions: [], total_investment_transactions: 0 } };
  assert.deepEqual(await plaid.getHoldings(item, state), { status: "ok", value: [] });
  assert.deepEqual(await plaid.getInvestmentTransactions(item, state, "2026-01-01", "2026-01-31"), { status: "ok", value: [] });
});

test("investment history retries the full first-sync window and advances its watermark only after persistence succeeds", async () => {
  const now = new Date(2026, 6, 11, 12, 0, 0);
  const firstRange = investmentSync.investmentDateRange("", 730, now);
  assert.deepEqual(firstRange, { start: "2024-07-11", end: "2026-07-11" });

  let persistCalls = 0;
  const pending = { status: "pending", code: "PRODUCT_NOT_READY", requestId: "" };
  const pendingApply = await investmentSync.applyInvestmentTransactionResult(pending, "", now.toISOString(), async () => { persistCalls += 1; });
  assert.deepEqual(pendingApply, { watermark: "", count: 0 });
  assert.equal(persistCalls, 0);
  assert.deepEqual(investmentSync.investmentDateRange(pendingApply.watermark, 730, now), firstRange);

  const completedAt = new Date(2026, 6, 11, 12, 1, 0).toISOString();
  const successfulApply = await investmentSync.applyInvestmentTransactionResult({ status: "ok", value: [] }, pendingApply.watermark, completedAt, async () => { persistCalls += 1; });
  assert.deepEqual(successfulApply, { watermark: completedAt, count: 0 });
  assert.equal(persistCalls, 1);
  assert.deepEqual(investmentSync.investmentDateRange(successfulApply.watermark, 730, new Date(2026, 6, 12, 12, 0, 0)), { start: "2026-06-27", end: "2026-07-12" });
});

test("optional holdings outages preserve only current Item holdings and authoritative empty success clears them", () => {
  const previous = [
    { financeAccountId: "current-a", securityId: "security-a", asOf: "2026-07-10", stale: false },
    { financeAccountId: "current-b", securityId: "security-b", asOf: "2026-07-09", stale: true },
    { financeAccountId: "other-item", securityId: "security-c", asOf: "2026-07-10", stale: false },
  ];
  const unavailable = investmentSync.holdingsForSnapshot(
    { status: "pending", code: "INSTITUTION_DOWN", requestId: "" },
    new Set(["current-a", "current-b"]),
    previous,
  );
  assert.equal(unavailable.preserved, 2);
  assert.deepEqual(unavailable.holdings.map((holding) => [holding.financeAccountId, holding.asOf, holding.stale]), [
    ["current-a", "2026-07-10", true],
    ["current-b", "2026-07-09", true],
  ]);
  assert.deepEqual(investmentSync.holdingsForSnapshot({ status: "ok", value: [] }, new Set(["current-a", "current-b"]), previous), { holdings: [], preserved: 0 });
});

test("transaction sync discards a mutated partial page and restarts from the durable cursor", async () => {
  const cursors = [];
  let call = 0;
  globalThis.__tpsPlaidRequestUrl = async (options) => {
    const body = JSON.parse(options.body);
    cursors.push(body.cursor);
    call += 1;
    if (call === 1) return { status: 200, json: { added: [{ transaction_id: "discarded", account_id: "account", date: "2026-01-01", amount: 1 }], modified: [], removed: [], next_cursor: "page-2", has_more: true } };
    if (call === 2) return { status: 400, json: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", error_message: "Restart pagination." } };
    return { status: 200, json: { added: [{ transaction_id: "kept", account_id: "account", date: "2026-01-02", amount: 2 }], modified: [], removed: [], next_cursor: "complete", has_more: false } };
  };
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  const patch = await plaid.syncTransactions({ accessToken: "access-test", cursor: "" }, { providerIdentityMap: {} });
  assert.deepEqual(cursors, [undefined, "page-2", undefined]);
  assert.equal(patch.added.length, 1);
  assert.equal(patch.added[0].providerTransactionId, "kept");
  assert.equal(patch.nextCursor, "complete");
});

test("disconnect and logging behavior protect financial integrations", () => {
  assert.match(client, /"\/item\/remove"/);
  assert.match(settings, /DisconnectItemModal/);
  assert.match(readme, /subscription charges/);
  assert.match(main, /logger\.flow\("Sync", "item:done"/);
  assert.doesNotMatch(main, /logger\.[a-z]+\([^\n]*(accessToken|providerItemId)/);
  assert.match(main, /new PlaidClient\(item\.environment, this\.getPlaidCredentials\(item\.plaidSecretName, item\.plaidClientIdSecretName \|\| this\.settings\.plaidClientIdSecret\)\)/);
  assert.match(main, /if \(!failures\.length && \(allAccounts\.length \|\| allHoldings\.length\)\)/);
  assert.match(main, /gcmApi\.frontmatter\.process\(file, mutator\)/);
  assert.match(main, /externalActions\.register/);
  assert.match(main, /renderHomeSummary/);
  assert.match(main, /openTransactionSource/);
  assert.match(main, /frontmatter\?\.date/);
  assert.match(store, /Accounts\.base/);
  assert.match(store, /Transactions\.base/);
  assert.match(store, /Holdings\.base/);
  assert.match(store, /Rules\.base/);
  assert.match(store, /Budgets\.base/);
  assert.match(main, /updateTransactionMetadata/);
  assert.match(main, /Budget remaining/);
});
