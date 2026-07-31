import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { build } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(process.env.TPS_FINANCES_TRANSACTION_SOURCE_ROOT || repositoryRoot);
const baselineRoot = process.env.TPS_FINANCES_BASELINE_ROOT
  ? resolve(process.env.TPS_FINANCES_BASELINE_ROOT)
  : null;
const exactBaseline = {
  version: "0.5.8",
  commit: "a2cd5f7c7d6ff65c37a75dbb79a480ac7d1ec85d",
  financeStoreSha256: "036fd8bd6346e3ee6ee67bbf272f21716efa37048eeb9818af32de1b9bffd48f",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadFinanceStore(root, label) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(root, "src/finance-store.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [{
      name: `mock-obsidian-${label}`,
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: "obsidian",
          namespace: `mock-${label}`,
        }));
        builder.onLoad({ filter: /.*/, namespace: `mock-${label}` }, () => ({
          contents: [
            "export class App {}",
            "export class TFile {",
            "  static [Symbol.hasInstance](value) {",
            "    return Boolean(value && value.__tpsFinanceTestFile === true);",
            "  }",
            "}",
            "export const normalizePath = (value) => value;",
          ].join("\n"),
        }));
      },
    }],
  });
  const moduleText = `${result.outputFiles[0].text}\n// ${label}\n`;
  return import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);
}

const subjectModule = await loadFinanceStore(sourceRoot, "transaction-subject");
const baselineModule = baselineRoot
  ? await loadFinanceStore(baselineRoot, "transaction-baseline")
  : null;

if (baselineRoot) {
  const baselineManifest = JSON.parse(readFileSync(join(baselineRoot, "manifest.json"), "utf8"));
  const baselineSource = readFileSync(join(baselineRoot, "src/finance-store.ts"));
  const baselineCommit = execFileSync(
    "git",
    ["-C", baselineRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const baselineStatus = execFileSync(
    "git",
    ["-C", baselineRoot, "status", "--short"],
    { encoding: "utf8" },
  ).trim();
  assert.equal(baselineManifest.version, exactBaseline.version);
  assert.equal(baselineCommit, exactBaseline.commit);
  assert.equal(baselineStatus, "");
  assert.equal(sha256(baselineSource), exactBaseline.financeStoreSha256);
}

function transaction(index, overrides = {}) {
  const numericIndex = typeof index === "number" ? index : 1;
  return {
    financeId: `finance-${index}`,
    providerTransactionId: `provider-${index}`,
    financeAccountId: "account-one",
    date: "2026-07-01",
    authorizedDate: "2026-07-01",
    name: `Transaction ${index}`,
    merchantName: `Merchant ${index}`,
    amount: -(numericIndex + 1),
    currency: "USD",
    pending: false,
    category: "general_merchandise",
    categoryDetail: "general_merchandise_other",
    subtype: "purchase",
    kind: "transaction",
    ...overrides,
  };
}

function createVault(entries, options = {}) {
  const hooks = {
    beforeProcess: null,
    afterProcess: null,
    beforeResolve: null,
    cachedRead: null,
    getMarkdownFiles: null,
    ...options.hooks,
  };
  const files = [];
  const filesByPath = new Map();
  const contents = new Map();
  const listeners = new Map();
  const metrics = {
    markdownListCalls: 0,
    cachedReads: 0,
    cachedReadBytes: 0,
    abstractFileLookups: 0,
    processCalls: 0,
    resolverCalls: 0,
    subscriptions: 0,
    unsubscriptions: 0,
    processLog: [],
    resolverLog: [],
  };

  function makeFile(path) {
    const name = path.split("/").at(-1) || path;
    return {
      __tpsFinanceTestFile: true,
      path,
      basename: name.replace(/\.[^.]+$/u, ""),
      extension: name.includes(".") ? name.split(".").at(-1) : "",
    };
  }

  function emit(name, ...args) {
    for (const callback of listeners.get(name) || []) callback(...args);
  }

  function addFile(path, content, emitEvent = false) {
    assert.equal(filesByPath.has(path), false, `duplicate fixture path: ${path}`);
    const file = makeFile(path);
    files.push(file);
    filesByPath.set(path, file);
    contents.set(path, content);
    if (emitEvent) emit("create", file);
    return file;
  }

  for (const [path, content] of entries) addFile(path, content);

  const api = {
    hooks,
    metrics,
    app: null,
    resolveTransactionTarget: null,
    accountPaths: new Map([["account-one", "Finances/Accounts/Primary.md"]]),
    content(path) {
      return contents.get(path);
    },
    createExternal(path, content) {
      return addFile(path, content, true);
    },
    modifyExternal(path, update) {
      const file = filesByPath.get(path);
      assert.ok(file, `missing external-modify path: ${path}`);
      const current = contents.get(path);
      contents.set(path, typeof update === "function" ? update(current) : update);
      emit("modify", file);
    },
    deleteExternal(path) {
      const file = filesByPath.get(path);
      if (!file) return;
      filesByPath.delete(path);
      contents.delete(path);
      emit("delete", file);
    },
    replaceExternal(path, content) {
      const file = filesByPath.get(path);
      assert.ok(file, `missing external-replace path: ${path}`);
      filesByPath.delete(path);
      contents.delete(path);
      emit("delete", file);
      return addFile(path, content, true);
    },
    renameExternal(oldPath, newPath) {
      const file = filesByPath.get(oldPath);
      assert.ok(file, `missing external-rename path: ${oldPath}`);
      const content = contents.get(oldPath);
      filesByPath.delete(oldPath);
      contents.delete(oldPath);
      const name = newPath.split("/").at(-1) || newPath;
      file.path = newPath;
      file.basename = name.replace(/\.[^.]+$/u, "");
      file.extension = name.includes(".") ? name.split(".").at(-1) : "";
      filesByPath.set(newPath, file);
      contents.set(newPath, content);
      emit("rename", file, oldPath);
      return file;
    },
    snapshot() {
      return [...filesByPath]
        .map(([path]) => [path, contents.get(path)])
        .sort(([left], [right]) => left.localeCompare(right));
    },
    activeListenerCount() {
      return [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0);
    },
  };

  const vault = {
    getMarkdownFiles() {
      metrics.markdownListCalls += 1;
      hooks.getMarkdownFiles?.({ call: metrics.markdownListCalls, api });
      return files.filter((file) => filesByPath.get(file.path) === file && file.extension === "md");
    },
    async cachedRead(file) {
      metrics.cachedReads += 1;
      const content = contents.get(file.path);
      hooks.cachedRead?.({
        call: metrics.cachedReads,
        file,
        content,
        api,
      });
      if (content === undefined) throw new Error(`Missing file during cachedRead: ${file.path}`);
      metrics.cachedReadBytes += Buffer.byteLength(content);
      return content;
    },
    getAbstractFileByPath(path) {
      metrics.abstractFileLookups += 1;
      return filesByPath.get(path) || null;
    },
    async process(file, mutator) {
      metrics.processCalls += 1;
      const call = metrics.processCalls;
      await hooks.beforeProcess?.({ call, file, api });
      if (filesByPath.get(file.path) !== file) throw new Error(`Missing file during process: ${file.path}`);
      const before = contents.get(file.path);
      const after = mutator(before);
      assert.equal(typeof after, "string", "Vault.process callbacks must return text synchronously");
      contents.set(file.path, after);
      metrics.processLog.push({ call, path: file.path, before, after });
      emit("modify", file);
      await hooks.afterProcess?.({ call, file, before, after, api });
      return after;
    },
    on(name, callback) {
      metrics.subscriptions += 1;
      const callbacks = listeners.get(name) || new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
      return { name, callback };
    },
    offref(ref) {
      metrics.unsubscriptions += 1;
      listeners.get(ref.name)?.delete(ref.callback);
    },
  };

  api.app = {
    vault,
    metadataCache: { getFileCache: () => ({}) },
    fileManager: {},
  };
  api.resolveTransactionTarget = async (context) => {
    metrics.resolverCalls += 1;
    metrics.resolverLog.push(structuredClone(context));
    await hooks.beforeResolve?.({
      call: metrics.resolverCalls,
      context,
      api,
    });
    const path = options.route?.(context, api) || `Daily/${context.date}.md`;
    return filesByPath.get(path) || addFile(path, options.newTargetContent?.(path, context) || "", true);
  };
  return api;
}

function createStore(module, vault) {
  return new module.FinanceStore(
    vault.app,
    "Finances",
    async (_file, mutator) => mutator({}),
    async () => {
      throw new Error("daily-note fallback must not be used by this harness");
    },
    vault.resolveTransactionTarget,
  );
}

async function captureApply(module, scenario) {
  const vault = scenario();
  const store = createStore(module, vault);
  try {
    const result = await store.applyTransactions(
      vault.added || [],
      vault.modified || [],
      vault.removedProviderIds || [],
      vault.state || { plaidUserId: "test", items: [], providerIdentityMap: {} },
      vault.accountPaths,
    );
    return {
      status: "fulfilled",
      result,
      snapshot: vault.snapshot(),
      processPaths: vault.metrics.processLog.map(({ path }) => path),
      resolverLog: vault.metrics.resolverLog,
      vault,
      store,
    };
  } catch (error) {
    return {
      status: "rejected",
      error: { name: error?.name || "Error", message: String(error?.message || error) },
      snapshot: vault.snapshot(),
      processPaths: vault.metrics.processLog.map(({ path }) => path),
      resolverLog: vault.metrics.resolverLog,
      vault,
      store,
    };
  }
}

function observable(result) {
  return {
    status: result.status,
    result: result.result,
    error: result.error,
    snapshot: result.snapshot,
    processPaths: result.processPaths,
    resolverLog: result.resolverLog,
  };
}

function performanceScenario(fileCount, transactionCount) {
  const entries = Array.from(
    { length: fileCount - 1 },
    (_, index) => [`Notes/Unrelated-${String(index).padStart(5, "0")}.md`, `Unrelated ${index}\n`],
  );
  entries.push(["Daily/2026-07-01.md", "User text\n"]);
  const vault = createVault(entries);
  vault.added = Array.from({ length: transactionCount }, (_, index) => transaction(index));
  vault.modified = [];
  vault.removedProviderIds = [];
  vault.state = { plaidUserId: "test", items: [], providerIdentityMap: {} };
  return vault;
}

async function runPerformance(module, fileCount, transactionCount) {
  const vault = performanceScenario(fileCount, transactionCount);
  const store = createStore(module, vault);
  const started = performance.now();
  const result = await store.applyTransactions(
    vault.added,
    [],
    [],
    vault.state,
    vault.accountPaths,
  );
  const elapsedMs = performance.now() - started;
  return {
    result,
    elapsedMs,
    markdownListCalls: vault.metrics.markdownListCalls,
    cachedReads: vault.metrics.cachedReads,
    processCalls: vault.metrics.processCalls,
    targetContent: vault.content("Daily/2026-07-01.md"),
    vault,
    store,
  };
}

test("transaction batches reuse one lazy content index and discard it at the public boundary", async () => {
  const fileCount = 2_000;
  const transactionCount = 80;
  const measurement = await runPerformance(subjectModule, fileCount, transactionCount);
  console.log("# transaction-batch subject", JSON.stringify({
    root: sourceRoot,
    markdownListCalls: measurement.markdownListCalls,
    cachedReads: measurement.cachedReads,
    processCalls: measurement.processCalls,
    elapsedMs: Number(measurement.elapsedMs.toFixed(3)),
  }));
  assert.deepEqual(measurement.result, { added: transactionCount, modified: 0, removed: 0 });
  assert.equal(measurement.markdownListCalls, 1);
  assert.equal(measurement.cachedReads, fileCount);
  assert.equal(measurement.processCalls, transactionCount);

  const records = await measurement.store.readTransactionRecords();
  assert.equal(records.length, transactionCount);
  assert.equal(
    measurement.vault.metrics.markdownListCalls,
    2,
    "the public batch must discard its invocation-local index",
  );
});

test("empty, unmapped-removal, and invalid-date batches retain zero-scan behavior", async () => {
  const vault = createVault([["Daily/2026-07-01.md", "User text\n"]]);
  const store = createStore(subjectModule, vault);
  assert.deepEqual(
    await store.applyTransactions([], [], [], {
      plaidUserId: "test",
      items: [],
      providerIdentityMap: {},
    }, vault.accountPaths),
    { added: 0, modified: 0, removed: 0 },
  );
  assert.deepEqual(
    await store.applyTransactions(
      [transaction("invalid-added", { date: "not-a-date" })],
      [transaction("invalid-modified", { date: "2026-7-1" })],
      ["unmapped-provider-id"],
      { plaidUserId: "test", items: [], providerIdentityMap: {} },
      vault.accountPaths,
    ),
    { added: 1, modified: 1, removed: 0 },
  );
  await store.replaceInvestmentTransactions([], vault.accountPaths);
  assert.equal(vault.metrics.markdownListCalls, 0);
  assert.equal(vault.metrics.cachedReads, 0);
  assert.equal(vault.metrics.processCalls, 0);
});

function denseEquivalenceScenario() {
  const vault = createVault([
    ["Notes/Unrelated.md", "Unrelated text\n"],
    [
      "Daily/2026-07-01.md",
      [
        "Daily heading",
        "- Remove me [type:: transaction] [financeId:: finance-remove] [date:: 2026-07-01]",
        "- Old modified [type:: transaction] [financeId:: finance-modified] [date:: 2026-07-01] [categoryOverride:: groceries] [tags:: #keep, #two]",
        "- Duplicate modified [type:: transaction] [financeId:: finance-modified] [date:: 2026-07-01]",
        "Daily tail",
        "",
      ].join("\n"),
    ],
    [
      "Finances/Accounts/Primary.md",
      "Account heading\n- Old account copy [type:: transaction] [financeId:: finance-modified] [date:: 2026-07-01]\n",
    ],
    ["Daily/2026-07-02.md", "Second day\n"],
    [
      "Daily/2026-07-03.md",
      "Third day\n- Later duplicate [type:: transaction] [financeId:: finance-later] [date:: 2026-07-03] [categoryOverride:: wrong-later-copy]\n",
    ],
  ], {
    route(context) {
      if (context.line.includes("[financeId:: finance-account-target]")) {
        return "Finances/Accounts/Primary.md";
      }
      return `Daily/${context.date}.md`;
    },
    hooks: {
      beforeProcess({ call, file, api }) {
        api.modifyExternal(file.path, (content) => `${content.replace(/\s*$/u, "")}\nConcurrent user text ${call}\n`);
        if (call === 1) {
          api.modifyExternal(file.path, (content) => [
            content.replace(/\s*$/u, ""),
            "- Concurrent later record [type:: transaction] [financeId:: finance-later] [date:: 2026-07-02] [categoryOverride:: touched] [tags:: #inside]",
            "",
          ].join("\n"));
        }
      },
    },
  });
  vault.removedProviderIds = ["remove", "unmapped", "missing", "remove-again"];
  vault.state = {
    plaidUserId: "test",
    items: [],
    providerIdentityMap: {
      "transaction:remove": "finance-remove",
      "transaction:missing": "finance-missing",
      "transaction:remove-again": "finance-remove",
    },
  };
  vault.modified = [
    transaction("modified", {
      financeId: "finance-modified",
      providerTransactionId: "provider-modified",
      date: "2026-07-02",
      name: "Modified wins first",
      amount: -42.5,
    }),
    transaction("invalid-modified", { date: "2026-13-40" }),
  ];
  vault.added = [
    transaction("account-target", {
      financeId: "finance-account-target",
      providerTransactionId: "provider-account-target",
      date: "2026-07-02",
      name: "Account routed",
    }),
    transaction("later", {
      financeId: "finance-later",
      providerTransactionId: "provider-later",
      date: "2026-07-02",
      name: "Later touched-file record",
    }),
    transaction("modified-again", {
      financeId: "finance-modified",
      providerTransactionId: "provider-modified-again",
      date: "2026-07-03",
      name: "Added wins last",
      amount: -99,
    }),
  ];
  return vault;
}

test("transaction batching preserves dense removal, modification, addition, routing, and metadata behavior", async () => {
  const after = await captureApply(subjectModule, denseEquivalenceScenario);
  if (baselineModule) {
    const before = await captureApply(baselineModule, denseEquivalenceScenario);
    assert.deepEqual(observable(after), observable(before));
  }
  assert.equal(after.status, "fulfilled");
  assert.deepEqual(after.result, { added: 3, modified: 2, removed: 1 });
  const snapshotText = JSON.stringify(after.snapshot);
  assert.match(snapshotText, /\[categoryOverride:: groceries\]/);
  assert.match(snapshotText, /\[tags:: #keep, #two\]/);
  assert.match(snapshotText, /\[categoryOverride:: touched\]/);
  assert.match(snapshotText, /\[tags:: #inside\]/);
  assert.doesNotMatch(snapshotText, /Duplicate modified|Old account copy|Remove me|wrong-later-copy/);
});

function investmentScenario() {
  const vault = createVault([
    ["Daily/2026-07-01.md", "Investment day\n"],
    [
      "Daily/2026-07-02.md",
      "- Old investment [type:: investmentTransaction] [financeId:: investment-existing] [date:: 2026-07-02] [categoryOverride:: retirement] [tags:: #tax]\n",
    ],
  ]);
  vault.investments = [
    transaction("investment-existing", {
      financeId: "investment-existing",
      providerTransactionId: "provider-investment-existing",
      date: "2026-07-01",
      name: "Investment moved",
      kind: "investmentTransaction",
      subtype: "buy",
      securityId: "security-one",
      quantity: 2.5,
      price: 40,
      fees: 1.25,
    }),
    transaction("investment-new", {
      financeId: "investment-new",
      providerTransactionId: "provider-investment-new",
      date: "2026-07-02",
      name: "Dividend",
      kind: "investmentTransaction",
      subtype: "dividend",
      securityId: "security-two",
      quantity: null,
      price: null,
      fees: 0,
    }),
    transaction("investment-invalid", {
      date: "invalid",
      kind: "investmentTransaction",
    }),
  ];
  return vault;
}

async function captureInvestments(module) {
  const vault = investmentScenario();
  const store = createStore(module, vault);
  try {
    await store.replaceInvestmentTransactions(vault.investments, vault.accountPaths);
    return {
      status: "fulfilled",
      snapshot: vault.snapshot(),
      processPaths: vault.metrics.processLog.map(({ path }) => path),
      resolverLog: vault.metrics.resolverLog,
    };
  } catch (error) {
    return {
      status: "rejected",
      error: { name: error?.name || "Error", message: String(error?.message || error) },
      snapshot: vault.snapshot(),
      processPaths: vault.metrics.processLog.map(({ path }) => path),
      resolverLog: vault.metrics.resolverLog,
    };
  }
}

test("transaction batching preserves investment upsert behavior", async () => {
  const after = await captureInvestments(subjectModule);
  assert.equal(after.status, "fulfilled");
  assert.match(JSON.stringify(after.snapshot), /\[categoryOverride:: retirement\]/);
  assert.match(JSON.stringify(after.snapshot), /\[tags:: #tax\]/);
  if (baselineModule) assert.deepEqual(after, await captureInvestments(baselineModule));
});

test("a newly resolved target is fully indexed from its committed template content", async () => {
  function scenario() {
    const vault = createVault([["Notes/Existing.md", "Existing text\n"]], {
      route(context) {
        return context.line.includes("[financeId:: finance-template-first]")
          ? "Daily/New target.md"
          : "Daily/2026-07-02.md";
      },
      newTargetContent(path) {
        return path === "Daily/New target.md"
          ? "Template text\n- Template transaction [type:: transaction] [financeId:: finance-template-later] [date:: 2026-07-02] [categoryOverride:: template-owned] [tags:: #template]\n"
          : "Second target\n";
      },
    });
    vault.added = [
      transaction("template-first", {
        financeId: "finance-template-first",
        date: "2026-07-01",
      }),
      transaction("template-later", {
        financeId: "finance-template-later",
        date: "2026-07-02",
      }),
    ];
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.deepEqual(observable(after), observable(before));
  }
  assert.match(JSON.stringify(after.snapshot), /\[categoryOverride:: template-owned\]/);
  assert.match(JSON.stringify(after.snapshot), /\[tags:: #template\]/);
  assert.doesNotMatch(
    after.snapshot.find(([path]) => path === "Daily/New target.md")?.[1] || "",
    /finance-template-later/,
  );
});

test("an unexpectedly missing source invalidates the batch index before later work", async () => {
  function scenario() {
    const vault = createVault([
      [
        "External/Move old.md",
        "- Move old [type:: transaction] [financeId:: finance-missing-source] [date:: 2026-07-01]\n",
      ],
      [
        "External/Next old.md",
        "- Next old [type:: transaction] [financeId:: finance-after-rename] [date:: 2026-07-02] [categoryOverride:: renamed-source]\n",
      ],
      ["Daily/2026-07-01.md", "First target\n"],
      ["Daily/2026-07-02.md", "Second target\n"],
    ], {
      hooks: {
        afterProcess({ call, api }) {
          if (call !== 1) return;
          api.deleteExternal("External/Move old.md");
          api.renameExternal("External/Next old.md", "External/Next renamed.md");
        },
      },
    });
    vault.added = [
      transaction("missing-source", {
        financeId: "finance-missing-source",
        date: "2026-07-01",
      }),
      transaction("after-rename", {
        financeId: "finance-after-rename",
        date: "2026-07-02",
      }),
    ];
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.deepEqual(observable(after), observable(before));
  }
  assert.match(JSON.stringify(after.snapshot), /\[categoryOverride:: renamed-source\]/);
  assert.doesNotMatch(
    after.snapshot.find(([path]) => path === "External/Next renamed.md")?.[1] || "",
    /finance-after-rename/,
  );
  assert.equal(after.vault.metrics.markdownListCalls, 2);
});

test("a later indexed source refresh preserves concurrent local metadata edits", async () => {
  function scenario() {
    const vault = createVault([
      ["Daily/2026-07-01.md", "First target\n"],
      ["Daily/2026-07-02.md", "Second target\n"],
      [
        "External/Second source.md",
        "- Second old [type:: transaction] [financeId:: finance-concurrent-second] [date:: 2026-07-02] [categoryOverride:: old] [tags:: #old]\n",
      ],
    ], {
      hooks: {
        afterProcess({ call, api }) {
          if (call !== 1) return;
          api.modifyExternal(
            "External/Second source.md",
            "- Second edited [type:: transaction] [financeId:: finance-concurrent-second] [date:: 2026-07-02] [categoryOverride:: newest] [tags:: #newest]\n",
          );
        },
      },
    });
    vault.added = [
      transaction("concurrent-first", {
        financeId: "finance-concurrent-first",
        date: "2026-07-01",
      }),
      transaction("concurrent-second", {
        financeId: "finance-concurrent-second",
        date: "2026-07-02",
      }),
    ];
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.deepEqual(observable(after), observable(before));
  }
  assert.match(JSON.stringify(after.snapshot), /\[categoryOverride:: newest\]/);
  assert.match(JSON.stringify(after.snapshot), /\[tags:: #newest\]/);
  assert.doesNotMatch(JSON.stringify(after.snapshot), /\[categoryOverride:: old\]/);
});

test("a later indexed source rename is reconciled before the current transaction writes", async () => {
  function scenario() {
    const vault = createVault([
      ["Daily/2026-07-01.md", "First target\n"],
      ["Daily/2026-07-02.md", "Second target\n"],
      [
        "External/Rename old.md",
        "- Rename source [type:: transaction] [financeId:: finance-rename-second] [date:: 2026-07-02] [categoryOverride:: renamed]\n",
      ],
    ], {
      hooks: {
        afterProcess({ call, api }) {
          if (call === 1) api.renameExternal("External/Rename old.md", "External/Rename new.md");
        },
      },
    });
    vault.added = [
      transaction("rename-first", {
        financeId: "finance-rename-first",
        date: "2026-07-01",
      }),
      transaction("rename-second", {
        financeId: "finance-rename-second",
        date: "2026-07-02",
      }),
    ];
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.deepEqual(observable(after), observable(before));
  }
  assert.match(JSON.stringify(after.snapshot), /\[categoryOverride:: renamed\]/);
  assert.doesNotMatch(
    after.snapshot.find(([path]) => path === "External/Rename new.md")?.[1] || "",
    /finance-rename-second/,
  );
  assert.equal(after.vault.metrics.markdownListCalls, 2);
});

test("an initial-index rename preserves released duplicate metadata precedence", async () => {
  function scenario() {
    let renamed = false;
    const oldPath = "External/First old.md";
    const newPath = "External/First new.md";
    const vault = createVault([
      [
        oldPath,
        "- First source [type:: transaction] [financeId:: finance-initial-rename] [date:: 2026-07-02] [categoryOverride:: first] [tags:: #first]\n",
      ],
      [
        "External/Second.md",
        "- Second source [type:: transaction] [financeId:: finance-initial-rename] [date:: 2026-07-02] [categoryOverride:: second] [tags:: #second]\n",
      ],
      ["Daily/2026-07-02.md", "Target\n"],
    ], {
      hooks: {
        cachedRead({ file, api }) {
          if (renamed || file.path !== oldPath) return;
          renamed = true;
          api.renameExternal(oldPath, newPath);
        },
      },
    });
    vault.added = [
      transaction("initial-rename", {
        financeId: "finance-initial-rename",
        date: "2026-07-02",
      }),
    ];
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.deepEqual(observable(after), observable(before));
  }
  const target = after.snapshot.find(([path]) => path === "Daily/2026-07-02.md")?.[1] || "";
  assert.match(target, /\[categoryOverride:: first\]/);
  assert.match(target, /\[tags:: #first\]/);
  assert.doesNotMatch(target, /\[categoryOverride:: second\]|\[tags:: #second\]/);
  assert.equal(after.vault.metrics.markdownListCalls, 1);
});

test("a source renamed during its bounded refresh is reindexed before cleanup", async () => {
  function scenario() {
    let renamed = false;
    const oldPath = "External/In-flight old.md";
    const newPath = "External/In-flight new.md";
    const vault = createVault([
      ["Daily/2026-07-01.md", "First target\n"],
      ["Daily/2026-07-02.md", "Second target\n"],
      [
        oldPath,
        "- Rename source [type:: transaction] [financeId:: finance-inflight-second] [date:: 2026-07-02] [categoryOverride:: in-flight] [tags:: #rename]\n",
      ],
    ], {
      hooks: {
        cachedRead({ file, api }) {
          if (renamed || api.metrics.processCalls !== 1 || file.path !== oldPath) return;
          renamed = true;
          api.renameExternal(oldPath, newPath);
        },
      },
    });
    vault.added = [
      transaction("inflight-first", {
        financeId: "finance-inflight-first",
        date: "2026-07-01",
      }),
      transaction("inflight-second", {
        financeId: "finance-inflight-second",
        date: "2026-07-02",
      }),
    ];
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.deepEqual(observable(after), observable(before));
  }
  assert.equal(after.snapshot.some(([path]) => path === "External/In-flight old.md"), false);
  assert.doesNotMatch(
    after.snapshot.find(([path]) => path === "External/In-flight new.md")?.[1] || "",
    /finance-inflight-second/,
  );
  assert.match(JSON.stringify(after.snapshot), /\[categoryOverride:: in-flight\]/);
  assert.match(JSON.stringify(after.snapshot), /\[tags:: #rename\]/);
  assert.equal(after.vault.metrics.markdownListCalls, 2);
});

test("a same-path source replacement is refreshed before metadata and cleanup", async () => {
  function scenario() {
    let replaced = false;
    const sourcePath = "External/Replaced.md";
    const vault = createVault([
      ["Daily/2026-07-01.md", "First target\n"],
      ["Daily/2026-07-02.md", "Second target\n"],
      [
        sourcePath,
        "- Old source [type:: transaction] [financeId:: finance-replaced-second] [date:: 2026-07-02] [categoryOverride:: stale] [tags:: #stale]\n",
      ],
    ], {
      hooks: {
        cachedRead({ file, api }) {
          if (replaced || api.metrics.processCalls !== 1 || file.path !== sourcePath) return;
          replaced = true;
          api.replaceExternal(
            sourcePath,
            "- Replacement source [type:: transaction] [financeId:: finance-replaced-second] [date:: 2026-07-02] [categoryOverride:: replacement] [tags:: #replacement]\n",
          );
        },
      },
    });
    vault.added = [
      transaction("replacement-first", {
        financeId: "finance-replacement-first",
        date: "2026-07-01",
      }),
      transaction("replaced-second", {
        financeId: "finance-replaced-second",
        date: "2026-07-02",
      }),
    ];
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  const target = after.snapshot.find(([path]) => path === "Daily/2026-07-02.md")?.[1] || "";
  assert.match(target, /\[categoryOverride:: replacement\]/);
  assert.match(target, /\[tags:: #replacement\]/);
  assert.doesNotMatch(target, /\[categoryOverride:: stale\]|\[tags:: #stale\]/);
  assert.doesNotMatch(
    after.snapshot.find(([path]) => path === "External/Replaced.md")?.[1] || "",
    /finance-replaced-second/,
  );
  assert.equal(after.vault.metrics.markdownListCalls, 2);
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.equal(before.status, "fulfilled");
    assert.notDeepEqual(observable(after), observable(before));
    assert.match(JSON.stringify(before.snapshot), /\[categoryOverride:: stale\]/);
  }
});

test("atomic target reconciliation preserves metadata added after the batch snapshot", async () => {
  function scenario() {
    const vault = createVault([
      ["Daily/2026-07-01.md", "First target\n"],
      ["Daily/2026-07-02.md", "Second target\n"],
    ], {
      hooks: {
        afterProcess({ call, api }) {
          if (call !== 1) return;
          api.modifyExternal(
            "Daily/2026-07-02.md",
            "Second target\n- Concurrent target [type:: transaction] [financeId:: finance-target-second] [date:: 2026-07-02] [categoryOverride:: atomic-new] [tags:: #atomic]\n",
          );
        },
      },
    });
    vault.added = [
      transaction("target-first", {
        financeId: "finance-target-first",
        date: "2026-07-01",
      }),
      transaction("target-second", {
        financeId: "finance-target-second",
        date: "2026-07-02",
      }),
    ];
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.equal(after.status, before.status);
    assert.deepEqual(after.result, before.result);
    assert.deepEqual(after.snapshot, before.snapshot);
    assert.deepEqual(after.processPaths, before.processPaths);
  }
  assert.match(JSON.stringify(after.snapshot), /\[categoryOverride:: atomic-new\]/);
  assert.match(JSON.stringify(after.snapshot), /\[tags:: #atomic\]/);
});

function failureScenario(failProcessAt = null, failResolverAt = null) {
  const vault = denseEquivalenceScenario();
  const originalBeforeProcess = vault.hooks.beforeProcess;
  vault.hooks.beforeProcess = async (context) => {
    if (context.call === failProcessAt) throw new Error(`process failure ${failProcessAt}`);
    await originalBeforeProcess?.(context);
  };
  const originalBeforeResolve = vault.hooks.beforeResolve;
  vault.hooks.beforeResolve = async (context) => {
    if (context.call === failResolverAt) throw new Error(`resolver failure ${failResolverAt}`);
    await originalBeforeResolve?.(context);
  };
  vault.disableFaults = () => {
    vault.hooks.beforeProcess = originalBeforeProcess;
    vault.hooks.beforeResolve = originalBeforeResolve;
  };
  return vault;
}

async function retryAfterFailure(module, failProcessAt, failResolverAt) {
  const vault = failureScenario(failProcessAt, failResolverAt);
  const store = createStore(module, vault);
  let firstError = null;
  try {
    await store.applyTransactions(
      vault.added,
      vault.modified,
      vault.removedProviderIds,
      vault.state,
      vault.accountPaths,
    );
  } catch (error) {
    firstError = { name: error?.name || "Error", message: String(error?.message || error) };
  }
  assert.ok(firstError, "the injected first attempt must reject");
  vault.disableFaults();
  const retryResult = await store.applyTransactions(
    vault.added,
    vault.modified,
    vault.removedProviderIds,
    vault.state,
    vault.accountPaths,
  );
  return {
    firstError,
    retryResult,
    snapshot: vault.snapshot(),
  };
}

test("transaction batching preserves every resolver and write failure boundary", async () => {
  const healthy = await captureApply(subjectModule, () => failureScenario());
  assert.equal(healthy.status, "fulfilled");
  for (let processCall = 1; processCall <= healthy.processPaths.length; processCall += 1) {
    const after = await captureApply(subjectModule, () => failureScenario(processCall, null));
    assert.equal(after.status, "rejected", `process call ${processCall}`);
    assert.deepEqual(after.error, {
      name: "Error",
      message: `process failure ${processCall}`,
    });
    const afterRetry = await retryAfterFailure(subjectModule, processCall, null);
    assert.equal(afterRetry.retryResult.added, 3);
    assert.equal(afterRetry.retryResult.modified, 2);
    assert.ok(afterRetry.retryResult.removed === 0 || afterRetry.retryResult.removed === 1);
    if (baselineModule) {
      const before = await captureApply(baselineModule, () => failureScenario(processCall, null));
      assert.deepEqual(observable(after), observable(before), `process call ${processCall}`);
      assert.deepEqual(
        afterRetry,
        await retryAfterFailure(baselineModule, processCall, null),
        `process retry ${processCall}`,
      );
    }
  }
  for (let resolverCall = 1; resolverCall <= healthy.resolverLog.length; resolverCall += 1) {
    const after = await captureApply(subjectModule, () => failureScenario(null, resolverCall));
    assert.equal(after.status, "rejected", `resolver call ${resolverCall}`);
    assert.deepEqual(after.error, {
      name: "Error",
      message: `resolver failure ${resolverCall}`,
    });
    const afterRetry = await retryAfterFailure(subjectModule, null, resolverCall);
    assert.equal(afterRetry.retryResult.added, 3);
    assert.equal(afterRetry.retryResult.modified, 2);
    assert.ok(afterRetry.retryResult.removed === 0 || afterRetry.retryResult.removed === 1);
    if (baselineModule) {
      const before = await captureApply(baselineModule, () => failureScenario(null, resolverCall));
      assert.deepEqual(observable(after), observable(before), `resolver call ${resolverCall}`);
      assert.deepEqual(
        afterRetry,
        await retryAfterFailure(baselineModule, null, resolverCall),
        `resolver retry ${resolverCall}`,
      );
    }
  }
});

test("partial initial-index failures retain no cache and retry from a fresh scan", async () => {
  async function run(module, failAt) {
    const entries = Array.from(
      { length: 5 },
      (_, index) => [`Notes/Index-${index}.md`, `Index ${index}\n`],
    );
    entries.push(["Daily/2026-07-01.md", "Target\n"]);
    const vault = createVault(entries, {
      hooks: {
        cachedRead({ call }) {
          if (call === failAt) throw new Error(`index read failure ${failAt}`);
        },
      },
    });
    const store = createStore(module, vault);
    let firstError = null;
    try {
      await store.applyTransactions(
        [transaction(`index-${failAt}`)],
        [],
        [],
        { plaidUserId: "test", items: [], providerIdentityMap: {} },
        vault.accountPaths,
      );
    } catch (error) {
      firstError = { name: error?.name || "Error", message: String(error?.message || error) };
    }
    vault.hooks.cachedRead = null;
    const retryResult = await store.applyTransactions(
      [transaction(`index-${failAt}`)],
      [],
      [],
      { plaidUserId: "test", items: [], providerIdentityMap: {} },
      vault.accountPaths,
    );
    return {
      firstError,
      retryResult,
      snapshot: vault.snapshot(),
      markdownListCalls: vault.metrics.markdownListCalls,
      processCalls: vault.metrics.processCalls,
    };
  }

  for (const failAt of [1, 3, 6]) {
    const after = await run(subjectModule, failAt);
    assert.deepEqual(after.firstError, {
      name: "Error",
      message: `index read failure ${failAt}`,
    });
    assert.deepEqual(after.retryResult, { added: 1, modified: 0, removed: 0 });
    if (baselineModule) {
      assert.deepEqual(after, await run(baselineModule, failAt), `initial index read ${failAt}`);
    }
  }
});

test("the candidate removes a redundant full-vault read failure without retry or fallback", async () => {
  function scenario() {
    const fileCount = 100;
    const vault = performanceScenario(fileCount, 2);
    vault.hooks.cachedRead = ({ call }) => {
      if (call > fileCount) throw new Error("redundant second index read");
    };
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  assert.deepEqual(after.result, { added: 2, modified: 0, removed: 0 });
  assert.equal(after.vault.metrics.processCalls, 2);
  assert.equal(after.vault.metrics.markdownListCalls, 1);
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.deepEqual(before.error, {
      name: "Error",
      message: "redundant second index read",
    });
    assert.equal(before.vault.metrics.processCalls, 1);
  }
});

test("the invocation-local optimization has an explicit untouched-note concurrency boundary", async () => {
  function scenario() {
    const vault = createVault([
      ["Daily/2026-07-01.md", "First target\n"],
      ["Daily/2026-07-02.md", "Second target\n"],
    ], {
      hooks: {
        afterProcess({ call, api }) {
          if (call === 1) {
            api.createExternal(
              "External/Concurrent.md",
              "- External [type:: transaction] [financeId:: finance-second] [date:: 2026-07-02] [categoryOverride:: external]\n",
            );
          }
        },
      },
    });
    vault.added = [
      transaction("first", { financeId: "finance-first", date: "2026-07-01" }),
      transaction("second", { financeId: "finance-second", date: "2026-07-02" }),
    ];
    return vault;
  }
  const after = await captureApply(subjectModule, scenario);
  assert.equal(after.status, "fulfilled");
  assert.match(
    JSON.stringify(after.snapshot),
    /External\/Concurrent\.md/,
    "the candidate must not overwrite or remove an unrelated record it did not observe",
  );
  if (baselineModule) {
    const before = await captureApply(baselineModule, scenario);
    assert.equal(before.status, "fulfilled");
    assert.notDeepEqual(after.snapshot, before.snapshot);
    assert.match(
      JSON.stringify(before.snapshot),
      /\[categoryOverride:: external\]/,
      "released rescanning can incidentally observe the new untouched-note record",
    );
  }
});

test("transaction batching proves the deterministic 20,000-file/500-change reduction", async () => {
  const fileCount = 20_000;
  const transactionCount = 500;
  const after = await runPerformance(subjectModule, fileCount, transactionCount);
  assert.equal(after.markdownListCalls, 1);
  assert.equal(after.cachedReads, fileCount);
  assert.equal(after.processCalls, transactionCount);
  if (baselineModule) {
    const before = await runPerformance(baselineModule, fileCount, transactionCount);
    console.log("# transaction-batch comparison", JSON.stringify({
      exactBaseline,
      before: {
        markdownListCalls: before.markdownListCalls,
        cachedReads: before.cachedReads,
        processCalls: before.processCalls,
        elapsedMs: Number(before.elapsedMs.toFixed(3)),
      },
      after: {
        markdownListCalls: after.markdownListCalls,
        cachedReads: after.cachedReads,
        processCalls: after.processCalls,
        elapsedMs: Number(after.elapsedMs.toFixed(3)),
      },
    }));
    assert.deepEqual(after.result, before.result);
    assert.equal(after.targetContent, before.targetContent);
    assert.equal(before.markdownListCalls, transactionCount);
    assert.equal(before.cachedReads, fileCount * transactionCount);
    assert.equal(after.processCalls, before.processCalls);
  }
});
