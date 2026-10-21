// Actual model reader errors; retained after retiring the dashboard renderer.
// Synthetic in-memory files, no Obsidian runtime or provider calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sourceDir = fileURLToPath(new URL('..', import.meta.url));
const requireSource = createRequire(sourceDir + '/package.json');
const { build } = requireSource('esbuild');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// The reader cases below run the real main/store/snapshot reader, using the
// existing contract suite's Obsidian facade and synthetic in-memory file maps.
const contract = readFileSync(sourceDir + '/scripts/test-finance-contract.mjs', 'utf8');
const readerBuild = contract.slice(contract.indexOf('const mainActionBuild ='), contract.indexOf('function snapshotDashboardPlugin'))
  .replace('fileURLToPath(new URL("../src/main.ts", import.meta.url))', JSON.stringify(sourceDir + '/src/main.ts'));
const ReaderPlugin = await new AsyncFunction('build', readerBuild + '\nreturn mainActionModule.default;')(build);
function readerHarness(folder = 'Finances') {
  const entries = new Map();
  const counts = { enumerations: 0, metadata: 0, sourceReads: 0 };
  const app = {
    vault: {
      getMarkdownFiles: () => { counts.enumerations++; return [...entries.values()].map(entry => entry.file); },
      cachedRead: async file => { counts.sourceReads++; return entries.get(file.path).body; },
    },
    metadataCache: { getFileCache: file => { counts.metadata++; return entries.get(file.path).cache; } },
    plugins: { plugins: {} },
  };
  const plugin = new ReaderPlugin(app);
  plugin.settings = { financeFolder: folder, propertyNames: { keys: {} }, recordMode: 'atomic-note', legacyTransactionDiscovery: 'atomic-only' };
  app.plugins.plugins['tps-finances'] = plugin;
  plugin.getConnectedItems = () => []; plugin.getRelayStatus = () => null; plugin.getPlaidSetupStatus = () => ({ state: 'ready' });
  const add = (path, fields, cache = { frontmatter: fields }, body = '---\n' + JSON.stringify(fields) + '\n---\n') => {
    const file = new globalThis.__tpsMainActionTFile();
    Object.assign(file, { path, basename: path.split('/').at(-1).replace(/\.md$/, ''), extension: 'md' });
    entries.set(path, { file, cache, body }); return file;
  };
  const transaction = overrides => ({ kind: 'transaction', type: 'transaction', financeId: 'qa-transaction',
    account: '[[Finances/Accounts/Missing]]', title: 'QA transaction', date: '2026-10-06', amount: -1,
    currency: 'USD', ...overrides });
  return { app, plugin, add, transaction, counts, entries };
}


test('actual whole-note dashboard readers exclude body markers and legacy-only ledger metadata', async () => {
  for (const folder of ['', 'Finances']) for (const source of ['metadata', 'source']) {
    const r = readerHarness(folder), paths = new Set();
    r.add('Ordinary/Documentation.md', { title: 'Documentation' }, { frontmatter: { title: 'Documentation' } },
      'Example: - Legacy [type:: transaction] [financeId:: old-inline] [date:: 2026-10-06] [amount:: -1]');
    r.add('Ordinary/OldLedger.md', { type: 'financeTransactions' });
    const result = await r.plugin.getDashboardModel(paths, source);
    assert.deepEqual(result.transactions, []);
    assert.deepEqual(paths, new Set());
    assert.equal(r.counts.sourceReads, 0);
  }
});

test('actual cash-link failure already records its offending transaction before throwing', async () => {
  const h = readerHarness(), paths = new Set();
  h.add('Finances/Transactions/Cash.md', h.transaction({ financeSource: 'manual' }));
  await assert.rejects(h.plugin.getDashboardModel(paths, 'metadata'), /missing cash account/);
  assert.deepEqual(paths, new Set(['Finances/Transactions/Cash.md']));
  assert.equal(h.counts.enumerations, 1); assert.equal(h.counts.sourceReads, 0);
});

test('actual duplicate-identity failure must retain both candidates for deletion recovery', async () => {
  const h = readerHarness(), paths = new Set();
  h.add('Finances/Transactions/First.md', h.transaction({}));
  h.add('Finances/Transactions/Duplicate.md', h.transaction({}));
  await assert.rejects(h.plugin.getDashboardModel(paths, 'metadata'), /Duplicate atomic transaction identity/);
  assert.deepEqual(paths, new Set(['Finances/Transactions/First.md', 'Finances/Transactions/Duplicate.md']));
});

test('actual invalid-amount failure must retain the candidate for deletion or declassification recovery', async () => {
  const h = readerHarness(), paths = new Set();
  h.add('Finances/Transactions/Invalid.md', h.transaction({ amount: '' }));
  await assert.rejects(h.plugin.getDashboardModel(paths, 'metadata'), /Invalid atomic transaction properties/);
  assert.deepEqual(paths, new Set(['Finances/Transactions/Invalid.md']));
});
