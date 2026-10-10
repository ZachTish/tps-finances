// Actual source regression for failed-dashboard dependency ownership;
// esbuild writes nothing. No Obsidian runtime, vault, settings, or provider calls.
// Reuses actual view/event handlers; controls stub the model, reader cases do not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sourceDir = fileURLToPath(new URL('..', import.meta.url));
const requireSource = createRequire(sourceDir + '/package.json');
const { build } = requireSource('esbuild');
const ts = requireSource('typescript');
const original = readFileSync(sourceDir + '/scripts/test-dashboard-render-ownership.mjs', 'utf8');
const prefix = original.slice(original.indexOf('// The actual dashboard'), original.indexOf("test('route changes"))
  .replace('resolveDir:process.cwd()', 'resolveDir:' + JSON.stringify(sourceDir));
const events = original.slice(original.indexOf('const mainSource='), original.indexOf("test('unrelated rename/edit bursts"))
  .replace("readFileSync(new URL('../src/main.ts',import.meta.url),'utf8')", 'readFileSync(' + JSON.stringify(sourceDir + '/src/main.ts') + ", 'utf8')");
assert.ok(prefix.includes('write:false') && events.includes('function eventHarness('), 'Expected existing in-memory test harness');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const { eventHarness, EventFile, model, deferred } = await new AsyncFunction('assert', 'build', 'readFileSync', 'ts',
  prefix + events + '\nreturn {eventHarness, EventFile, model, deferred};')(assert, build, readFileSync, ts);

// The reader cases below run the real main/store/snapshot reader, using the
// existing contract suite's Obsidian facade and synthetic in-memory file maps.
const contract = readFileSync(sourceDir + '/scripts/test-finance-contract.mjs', 'utf8');
const readerBuild = contract.slice(contract.indexOf('const mainActionBuild ='), contract.indexOf('class DashboardNode'))
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

function failOnCashLink(h) {
  h.setReader(sources => {
    sources.add('CashTransaction.md');
    sources.add('ExistingAccount.md');
    throw new Error('A cash transaction has a missing cash account. Repair its account link.');
  });
}

test('failed model retains the contributing dependency paths for relevant recovery', async () => {
  const h = eventHarness(); failOnCashLink(h); await h.view.onOpen();
  assert.deepEqual(h.view.sourcePaths, new Set(['CashTransaction.md', 'ExistingAccount.md']));
});

test('failed dashboard ignores 20 unrelated metadata, rename, and delete changes', async () => {
  const h = eventHarness(); failOnCashLink(h); await h.view.onOpen();
  for (let i = 0; i < 20; i++) {
    await h.event('changed', new EventFile('Ordinary.md'), 'ordinary text');
    await h.event('rename', new EventFile('Ordinary.md'), 'Ordinary-before.md');
    await h.event('delete', new EventFile('Ordinary.md'));
  }
  assert.equal(h.counts.models, 1, 'No repeated full model reads for unrelated Markdown');
  assert.ok(h.root.all().some(e => e.className === 'tps-finances-error'), 'Keep the real error visible');
});

for (const failed of [false, true]) for (const legacy of ['inline-marker', 'ledger-type']) {
  test(`retired ${legacy} does not refresh a settled ${failed ? 'failed' : 'successful'} dashboard`, async () => {
    const h = eventHarness();
    if (failed) failOnCashLink(h);
    await h.view.onOpen();
    const fields = legacy === 'ledger-type' ? { type: 'financeTransactions' } : { title: 'Documentation' };
    const body = legacy === 'inline-marker' ? 'Documented example: [financeId:: old-inline-record]' : 'Old ledger';
    for (let i = 0; i < 20; i++) await h.event('changed', new EventFile('Ordinary/Legacy.md', fields), body);
    assert.equal(h.counts.models, 1);
    assert.equal(h.root.all().some(e => e.className === 'tps-finances-error'), failed);
  });
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

test('real Finance fields, holdings, and snapshots still introduce dashboard candidates', async () => {
  const h = eventHarness(); failOnCashLink(h); await h.view.onOpen();
  const fields = [
    { financeId: 'qa-transaction', type: 'financeTransactions' },
    { financeAccountId: 'qa-account' }, { financeRuleId: 'qa-rule' }, { financeBudgetId: 'qa-budget' },
    { kind: 'account' }, { kind: 'financeRule' }, { kind: 'financeBudget' },
    { type: 'holding' }, { type: 'financeSnapshot' },
  ];
  for (const [index, fm] of fields.entries()) {
    await h.event('changed', new EventFile(`Candidate-${index}.md`, fm), '');
    assert.equal(h.counts.models, index + 2);
  }
});

test('editing the contributing transaction still recovers a failed dashboard', async () => {
  const h = eventHarness(); failOnCashLink(h); await h.view.onOpen();
  h.setReader(sources => { sources.add('CashTransaction.md'); return Promise.resolve(model()); });
  await h.event('changed', new EventFile('CashTransaction.md'), 'corrected linked account');
  assert.equal(h.counts.models, 2); assert.equal(h.counts.paint, 1);
});

test('deleting the offending transaction still recovers without current candidate metadata', async () => {
  const h = eventHarness(); failOnCashLink(h); await h.view.onOpen();
  h.setReader(() => Promise.resolve(model()));
  await h.event('delete', new EventFile('CashTransaction.md'));
  assert.equal(h.counts.models, 2); assert.equal(h.counts.paint, 1);
});

test('renaming a failed source away or moving its ancestor still requests recovery', async () => {
  for (const folder of [false, true]) {
    const h = eventHarness();
    h.setReader(paths => { paths.add('Old/Problem.md'); throw Error('Bad source'); });
    await h.view.onOpen();
    h.setReader(() => Promise.resolve(model()));
    await h.event('rename', folder ? { path: 'Moved' } : new EventFile('Moved/Problem.txt'), folder ? 'Old' : 'Old/Problem.md');
    assert.equal(h.counts.models, 2); assert.equal(h.counts.paint, 1);
  }
});

test('new account metadata still recovers a missing-account failure', async () => {
  const h = eventHarness(); failOnCashLink(h); await h.view.onOpen();
  h.setReader(sources => { sources.add('NewAccount.md'); return Promise.resolve(model()); });
  await h.event('changed', new EventFile('NewAccount.md', { kind: 'account', financeAccountId: 'qa-new-account' }), '');
  assert.equal(h.counts.models, 2); assert.equal(h.counts.paint, 1);
});

test('explicit settings/owner refresh remains allowed after failure', async () => {
  const h = eventHarness(); failOnCashLink(h); await h.view.onOpen();
  h.setReader(() => Promise.resolve(model())); await h.owner.refreshDashboard();
  assert.equal(h.counts.models, 2); assert.equal(h.counts.paint, 1);
});

test('an in-flight read still conservatively retries an unknown change', async () => {
  const h = eventHarness(); await h.view.onOpen();
  const pending = deferred(); let reads = 0;
  h.setReader(sources => { sources.add('NewSource.md'); return ++reads === 1 ? pending.promise : Promise.resolve(model(-55)); });
  const loading = h.view.render(); await Promise.resolve();
  const changed = h.event('changed', new EventFile('NotYetObserved.md'), 'classification removed during read');
  pending.resolve(model(-4)); await Promise.all([loading, changed]);
  assert.equal(h.counts.models, 3); assert.equal(h.view.lastOverview.transactions[0].amount, -55);
});

test('a failed dashboard does not schedule itself without external changes', async () => {
  const h = eventHarness(); failOnCashLink(h); await h.view.onOpen();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(h.counts.models, 1); assert.equal(h.view.renderPromise, null);
});

test('failure before any known source retains the existing conservative recovery', async () => {
  const h = eventHarness(); h.setReader(() => { throw Error('Configuration failed before source discovery'); });
  await h.view.onOpen(); assert.equal(h.view.sourcePaths, null);
  h.setReader(() => Promise.resolve(model()));
  await h.event('changed', new EventFile('Ordinary.md'), 'later metadata publication');
  assert.equal(h.counts.models, 2);
});

test('actual cash-link failure already records its offending transaction before throwing', async () => {
  const h = readerHarness(), paths = new Set();
  h.add('Finances/Transactions/Cash.md', h.transaction({ financeSource: 'manual' }));
  await assert.rejects(h.plugin.getDashboardModel(paths, 'metadata'), /missing cash account/);
  assert.deepEqual(paths, new Set(['Finances/Transactions/Cash.md']));
  assert.equal(h.counts.enumerations, 1); assert.equal(h.counts.sourceReads, 0);
});

test('actual failed cash dashboard avoids full scans for 20 unrelated edits and recovers on account creation', async () => {
  const r = readerHarness(), h = eventHarness();
  r.add('Finances/Transactions/Cash.md', r.transaction({ financeSource: 'manual' }));
  for (let i = 0; i < 1000; i++) r.add('Ordinary/' + i + '.md', { title: 'Ordinary' });
  h.setReader(paths => r.plugin.getDashboardModel(paths, 'metadata'));
  await h.view.onOpen();
  const before = { ...r.counts };
  for (let i = 0; i < 20; i++) await h.event('changed', new EventFile('Ordinary/' + i + '.md'), 'body-only edit');
  assert.equal(h.counts.models, 1); assert.deepEqual(r.counts, before, 'No additional reader enumerations, metadata, or source reads');
  const fields = { kind: 'account', financeAccountId: 'qa-account', financeSource: 'manual',
    accountType: 'depository', accountSubtype: 'cash', openingBalance: 0, currency: 'USD' };
  r.add('Finances/Accounts/Missing.md', fields);
  await h.event('changed', new EventFile('Finances/Accounts/Missing.md', fields), '');
  assert.equal(h.counts.models, 2); assert.equal(r.counts.enumerations, before.enumerations + 1);
  assert.equal(r.counts.sourceReads, 0);
  assert.ok(!h.root.all().some(e => e.className === 'tps-finances-error'));
});

test('actual duplicate-identity failure must retain both candidates for deletion recovery', async () => {
  const h = readerHarness(), paths = new Set();
  h.add('Finances/Transactions/First.md', h.transaction({}));
  h.add('Finances/Transactions/Duplicate.md', h.transaction({}));
  await assert.rejects(h.plugin.getDashboardModel(paths, 'metadata'), /Duplicate atomic transaction identity/);
  assert.deepEqual(paths, new Set(['Finances/Transactions/First.md', 'Finances/Transactions/Duplicate.md']));
});

test('actual duplicate deletion recovers the failed view while unrelated edits stay idle', async () => {
  const r = readerHarness(), h = eventHarness();
  r.add('Finances/Transactions/First.md', r.transaction({}));
  r.add('Finances/Transactions/Duplicate.md', r.transaction({}));
  h.setReader(paths => r.plugin.getDashboardModel(paths, 'metadata'));
  await h.view.onOpen();
  await h.event('changed', new EventFile('Ordinary.md'), 'ordinary body');
  assert.equal(h.counts.models, 1);
  r.entries.delete('Finances/Transactions/Duplicate.md');
  await h.event('delete', new EventFile('Finances/Transactions/Duplicate.md'));
  assert.equal(h.counts.models, 2);
  assert.ok(!h.root.all().some(e => e.className === 'tps-finances-error'));
});

test('actual invalid-amount failure must retain the candidate for deletion or declassification recovery', async () => {
  const h = readerHarness(), paths = new Set();
  h.add('Finances/Transactions/Invalid.md', h.transaction({ amount: '' }));
  await assert.rejects(h.plugin.getDashboardModel(paths, 'metadata'), /Invalid atomic transaction properties/);
  assert.deepEqual(paths, new Set(['Finances/Transactions/Invalid.md']));
});

test('actual invalid transaction declassification recovers the failed view', async () => {
  const r = readerHarness(), h = eventHarness();
  r.add('Finances/Transactions/Invalid.md', r.transaction({ amount: '' }));
  h.setReader(paths => r.plugin.getDashboardModel(paths, 'metadata'));
  await h.view.onOpen();
  await h.event('changed', new EventFile('Ordinary.md'), 'ordinary body');
  assert.equal(h.counts.models, 1);
  r.entries.get('Finances/Transactions/Invalid.md').cache = { frontmatter: {} };
  await h.event('changed', new EventFile('Finances/Transactions/Invalid.md'), 'classification removed');
  assert.equal(h.counts.models, 2);
  assert.ok(!h.root.all().some(e => e.className === 'tps-finances-error'));
});

test('actual root metadata decode failure must retain the offending file', async () => {
  const h = readerHarness(''), paths = new Set();
  h.app.plugins.plugins['tps-global-context-menu'] = { api: { nativeRecords: {getStorageProfile: () => ({identityMode: 'property', identityPropertyKey: 'tpsId'})}, frontmatterKinds: {
    version: 2, definition: () => null, decode: () => ({}), encode: fields => fields,
    propertyKey: () => null, matches: () => true,
  } } };
  h.add('Ambiguous.md', h.transaction({ type: undefined, kind: undefined }));
  await assert.rejects(h.plugin.getDashboardModel(paths, 'metadata'), /classification is ambiguous/);
  assert.deepEqual(paths, new Set(['Ambiguous.md']));
  const view = eventHarness(); view.setReader(paths => h.plugin.getDashboardModel(paths, 'metadata'));
  await view.view.onOpen();
  h.entries.delete('Ambiguous.md');
  await view.event('delete', new EventFile('Ambiguous.md'));
  assert.equal(view.counts.models, 2);
  assert.ok(!view.root.all().some(e => e.className === 'tps-finances-error'));
});

test('actual marked-budget parse failure must retain its source before parsing', async () => {
  const h = readerHarness(), paths = new Set();
  h.add('Finances/Budgets/Broken.md', {}, null, '---\n{"financeBudgetId": malformed}\n---\n');
  await assert.rejects(h.plugin.getDashboardModel(paths, 'metadata'), SyntaxError);
  assert.deepEqual(paths, new Set(['Finances/Budgets/Broken.md']));
  const view = eventHarness(); view.setReader(paths => h.plugin.getDashboardModel(paths, 'metadata'));
  await view.view.onOpen();
  h.add('Finances/Budgets/Broken.md', { kind: 'financeBudget', financeBudgetId: 'qa-budget', monthlyLimit: 10, title: 'QA budget' });
  await view.event('changed', new EventFile('Finances/Budgets/Broken.md', { kind: 'financeBudget', financeBudgetId: 'qa-budget' }), '');
  assert.equal(view.counts.models, 2);
  assert.ok(!view.root.all().some(e => e.className === 'tps-finances-error'));
});
