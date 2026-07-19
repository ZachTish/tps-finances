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

function plaidTransaction(id, accountId = "account") {
  return { transaction_id: id, account_id: accountId, date: "2026-01-01", amount: 1 };
}

function plaidSyncResponse({ added = [], modified = [], removed = [], nextCursor, hasMore }) {
  return {
    status: 200,
    json: { added, modified, removed, next_cursor: nextCursor, has_more: hasMore },
  };
}

test("transaction sync discards a mutated partial page and restarts from the durable cursor", async () => {
  const cursors = [];
  let call = 0;
  globalThis.__tpsPlaidRequestUrl = async (options) => {
    const body = JSON.parse(options.body);
    cursors.push(body.cursor);
    call += 1;
    if (call === 1 || call === 3) {
      const attempt = call === 1 ? 1 : 2;
      return plaidSyncResponse({
        added: [plaidTransaction(`discarded-added-${attempt}`)],
        modified: [plaidTransaction(`discarded-modified-${attempt}`)],
        removed: [{ transaction_id: `discarded-removed-${attempt}` }],
        nextCursor: `page-2-attempt-${attempt}`,
        hasMore: true,
      });
    }
    if (call === 2 || call === 4) {
      return { status: 400, json: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", error_message: "Restart pagination." } };
    }
    return plaidSyncResponse({
      added: [plaidTransaction("kept-added")],
      modified: [plaidTransaction("kept-modified")],
      removed: [{ transaction_id: "kept-removed" }],
      nextCursor: "complete",
      hasMore: false,
    });
  };
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  const item = { accessToken: "access-test", cursor: "durable" };
  const state = { providerIdentityMap: { "account:account": "finance-account-existing" } };
  const patch = await plaid.syncTransactions(item, state);
  assert.deepEqual(cursors, ["durable", "page-2-attempt-1", "durable", "page-2-attempt-2", "durable"]);
  assert.equal(call, 5);
  assert.equal(patch.added.length, 1);
  assert.equal(patch.added[0].providerTransactionId, "kept-added");
  assert.equal(patch.modified[0].providerTransactionId, "kept-modified");
  assert.deepEqual(patch.removedProviderIds, ["kept-removed"]);
  assert.equal(patch.nextCursor, "complete");
  assert.equal(item.cursor, "durable");
  assert.deepEqual(Object.keys(state.providerIdentityMap).sort(), [
    "account:account",
    "transaction:kept-added",
    "transaction:kept-modified",
  ]);
});

test("transaction sync bounds repeated mutation recovery and leaves failed attempts side-effect free", async () => {
  const cursors = [];
  let call = 0;
  globalThis.__tpsPlaidRequestUrl = async (options) => {
    const body = JSON.parse(options.body);
    cursors.push(body.cursor);
    call += 1;
    const attempt = Math.ceil(call / 2);
    if (call % 2 === 1) {
      return plaidSyncResponse({
        added: [plaidTransaction(`discarded-${attempt}`)],
        nextCursor: `attempt-${attempt}`,
        hasMore: true,
      });
    }
    return {
      status: 400,
      json: {
        error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
        error_message: "Restart pagination.",
        request_id: `mutation-${attempt}`,
      },
    };
  };
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  const item = { accessToken: "access-test", cursor: "durable" };
  const state = { providerIdentityMap: { existing: "identity" } };
  await assert.rejects(
    () => plaid.syncTransactions(item, state),
    (error) => error instanceof plaidClientModule.PlaidApiError
      && error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
      && error.requestId === "mutation-3",
  );
  assert.equal(call, 6);
  assert.deepEqual(cursors, ["durable", "attempt-1", "durable", "attempt-2", "durable", "attempt-3"]);
  assert.equal(item.cursor, "durable");
  assert.deepEqual(state.providerIdentityMap, { existing: "identity" });
});

test("transaction sync restarts only for the structured Plaid mutation code", async () => {
  let call = 0;
  globalThis.__tpsPlaidRequestUrl = async () => {
    call += 1;
    if (call === 1) {
      return plaidSyncResponse({ added: [plaidTransaction("discarded")], nextCursor: "page-2", hasMore: true });
    }
    return {
      status: 400,
      json: {
        error_code: "INSTITUTION_DOWN",
        error_message: "Message mentions TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION but this is not that error.",
      },
    };
  };
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  const state = { providerIdentityMap: {} };
  await assert.rejects(
    () => plaid.syncTransactions({ accessToken: "access-test", cursor: "durable" }, state),
    (error) => error instanceof plaidClientModule.PlaidApiError && error.code === "INSTITUTION_DOWN",
  );
  assert.equal(call, 2);
  assert.deepEqual(state.providerIdentityMap, {});
});

test("transaction sync does not invent a recovery when mutation is returned on the first request", async () => {
  let call = 0;
  globalThis.__tpsPlaidRequestUrl = async () => {
    call += 1;
    return {
      status: 400,
      json: { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", error_message: "No active page sequence." },
    };
  };
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  await assert.rejects(
    () => plaid.syncTransactions({ accessToken: "access-test", cursor: "durable" }, { providerIdentityMap: {} }),
    (error) => error instanceof plaidClientModule.PlaidApiError
      && error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
  );
  assert.equal(call, 1);
});

test("transaction sync rejects malformed and non-progressing cursor responses without retrying", async () => {
  const cases = [
    {
      name: "missing has_more",
      responses: [plaidSyncResponse({ nextCursor: "next" })],
      expected: /invalid has_more/,
    },
    {
      name: "non-boolean has_more",
      responses: [plaidSyncResponse({ nextCursor: "next", hasMore: "false" })],
      expected: /invalid has_more/,
    },
    {
      name: "missing next_cursor",
      responses: [plaidSyncResponse({ hasMore: false })],
      expected: /invalid next_cursor/,
    },
    {
      name: "empty terminal cursor on an active stream",
      responses: [plaidSyncResponse({ nextCursor: "", hasMore: false })],
      expected: /empty terminal next_cursor/,
    },
    {
      name: "stationary continuing cursor",
      responses: [plaidSyncResponse({ nextCursor: "durable", hasMore: true })],
      expected: /non-progressing next_cursor/,
    },
    {
      name: "continuing cursor cycle",
      responses: [
        plaidSyncResponse({ nextCursor: "page-2", hasMore: true }),
        plaidSyncResponse({ nextCursor: "durable", hasMore: true }),
      ],
      expected: /non-progressing next_cursor/,
    },
    {
      name: "terminal cursor rewind",
      responses: [
        plaidSyncResponse({ nextCursor: "page-2", hasMore: true }),
        plaidSyncResponse({ nextCursor: "durable", hasMore: false }),
      ],
      expected: /rewinds pagination/,
    },
    {
      name: "stationary terminal cursor with changes",
      responses: [plaidSyncResponse({ added: [plaidTransaction("replayed")], nextCursor: "durable", hasMore: false })],
      expected: /changes without advancing/,
    },
    {
      name: "invalid change collection",
      responses: [{ status: 200, json: { added: null, modified: [], removed: [], next_cursor: "next", has_more: false } }],
      expected: /invalid added collection/,
    },
  ];

  for (const scenario of cases) {
    let call = 0;
    globalThis.__tpsPlaidRequestUrl = async () => scenario.responses[call++];
    const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
    const state = { providerIdentityMap: {} };
    await assert.rejects(
      () => plaid.syncTransactions({ accessToken: "access-test", cursor: "durable" }, state),
      scenario.expected,
      scenario.name,
    );
    assert.equal(call, scenario.responses.length, scenario.name);
    assert.deepEqual(state.providerIdentityMap, {}, scenario.name);
  }
});

test("transaction sync accepts supported empty and stationary terminal no-op cursors", async () => {
  for (const cursor of ["", "durable"]) {
    let requestCursor = "not-called";
    globalThis.__tpsPlaidRequestUrl = async (options) => {
      requestCursor = JSON.parse(options.body).cursor;
      return plaidSyncResponse({ nextCursor: cursor, hasMore: false });
    };
    const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
    const state = { providerIdentityMap: {} };
    const patch = await plaid.syncTransactions({ accessToken: "access-test", cursor }, state);
    assert.equal(requestCursor, cursor || undefined);
    assert.deepEqual(patch, { added: [], modified: [], removedProviderIds: [], nextCursor: cursor });
    assert.deepEqual(state.providerIdentityMap, {});
  }
});

test("transaction sync commits identity mappings only after terminal normalization succeeds", async () => {
  const malformed = plaidTransaction("malformed");
  Object.defineProperty(malformed, "personal_finance_category", {
    get() {
      throw new Error("Malformed category payload.");
    },
  });
  globalThis.__tpsPlaidRequestUrl = async () => plaidSyncResponse({
    added: [malformed],
    nextCursor: "complete",
    hasMore: false,
  });
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  const state = { providerIdentityMap: { existing: "identity" } };
  await assert.rejects(
    () => plaid.syncTransactions({ accessToken: "access-test", cursor: "durable" }, state),
    /Malformed category payload/,
  );
  assert.deepEqual(state.providerIdentityMap, { existing: "identity" });
});

test("transaction sync enforces the 100-page attempt limit without normalizing partial data", async () => {
  let call = 0;
  globalThis.__tpsPlaidRequestUrl = async () => {
    call += 1;
    return plaidSyncResponse({
      added: [plaidTransaction(`partial-${call}`)],
      nextCursor: `cursor-${call}`,
      hasMore: true,
    });
  };
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  const item = { accessToken: "access-test", cursor: "durable" };
  const state = { providerIdentityMap: {} };
  await assert.rejects(() => plaid.syncTransactions(item, state), /exceeded 100 pages/);
  assert.equal(call, 100);
  assert.equal(item.cursor, "durable");
  assert.deepEqual(state.providerIdentityMap, {});
});

test("transaction sync accepts a terminal 100th page and retains all buffered pages", async () => {
  let call = 0;
  globalThis.__tpsPlaidRequestUrl = async () => {
    call += 1;
    const added = call === 1
      ? [plaidTransaction("first-page")]
      : call === 100
        ? [plaidTransaction("terminal-page")]
        : [];
    return plaidSyncResponse({ added, nextCursor: `cursor-${call}`, hasMore: call < 100 });
  };
  const plaid = new plaidClientModule.PlaidClient("sandbox", { clientId: "client-test", secret: "secret-test" });
  const state = { providerIdentityMap: { "account:account": "finance-account-existing" } };
  const patch = await plaid.syncTransactions({ accessToken: "access-test", cursor: "durable" }, state);
  assert.equal(call, 100);
  assert.equal(patch.nextCursor, "cursor-100");
  assert.deepEqual(patch.added.map((transaction) => transaction.providerTransactionId), ["first-page", "terminal-page"]);
  assert.deepEqual(Object.keys(state.providerIdentityMap).sort(), [
    "account:account",
    "transaction:first-page",
    "transaction:terminal-page",
  ]);
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
