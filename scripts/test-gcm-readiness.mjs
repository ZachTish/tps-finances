// Actual Finances onload/register/onunload source in an in-memory mobile facade.
// No installed plugin, real vault, layout callback, settings write or provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const mainBundle = (await build({
  entryPoints: [fileURLToPath(new URL('../src/main.ts', import.meta.url))],
  bundle: true, write: false, format: 'cjs', target: 'es2018',
  external: ['obsidian', 'electron', ...builtinModules],
})).outputFiles[0].text;

function harness(initiallyAvailable = false) {
  const log = [], registry = new Map(), registeredEvents = [], commands = [];
  const counts = { source: 0, metadata: 0, inventory: 0, mutation: 0, settingsWrite: 0,
    model: 0, provider: 0, registrations: 0, cleanups: 0, dashboard: 0, layout: 0 };
  const blocked = key => () => { counts[key]++; assert.fail(`Unexpected ${key} operation`); };
  class Events {
    listeners = new Set();
    on(name, callback) { const ref = { owner: this, name, callback }; this.listeners.add(ref); return ref; }
    offref(ref) { this.listeners.delete(ref); }
    trigger(name, payload) { for (const ref of [...this.listeners]) if (ref.name === name) ref.callback(payload); }
  }
  class File {
    constructor(path, frontmatter = {}) { this.path = path; this.frontmatter = frontmatter; }
  }
  let currentApi = null;
  const workspace = Object.assign(new Events(), {
    onLayoutReady() { counts.layout++; }, getLeavesOfType: () => [], detachLeavesOfType() {},
  });
  const app = {
    workspace,
    plugins: { plugins: {}, getPlugin: id => id === 'tps-global-context-menu' ? { api: currentApi } : null },
    secretStorage: { getSecret: () => null, setSecret: blocked('settingsWrite') },
    metadataCache: Object.assign(new Events(), { getFileCache: blocked('metadata') }),
    vault: Object.assign(new Events(), {
      getMarkdownFiles: blocked('inventory'), read: blocked('source'), cachedRead: blocked('source'),
      create: blocked('mutation'), createFolder: blocked('mutation'), modify: blocked('mutation'),
      process: blocked('mutation'), delete: blocked('mutation'), trash: blocked('mutation'),
    }),
    fileManager: { processFrontMatter: blocked('mutation') },
  };
  class Plugin {
    constructor() { this.app = app; }
    async loadData() { return { financeFolder: 'Finances', recordMode: 'atomic-note', enableLogging: false }; }
    saveData = blocked('settingsWrite');
    registerView() {} addSettingTab() {} addRibbonIcon() {}
    addCommand(command) { commands.push(command); }
    registerEvent(ref) { registeredEvents.push(ref); }
    disposeEvents() { for (const ref of registeredEvents.splice(0)) ref.owner.offref(ref); }
  }
  const obsidian = {
    Plugin, TFile: File, TAbstractFile: File, Platform: { isDesktopApp: false, isMobile: true },
    Modal: class {}, PluginSettingTab: class {}, ItemView: class {}, ButtonComponent: class {},
    Setting: class {}, Notice: class {}, normalizePath: value => value,
    parseYaml: JSON.parse, stringifyYaml: value => JSON.stringify(value) + '\n', setIcon() {},
    requestUrl: blocked('provider'),
  };
  const context = vm.createContext({ module: { exports: {} }, console, crypto: webcrypto,
    window: { setTimeout, clearTimeout },
    require(name) { assert.equal(name, 'obsidian', 'No provider, Node or Electron runtime'); return obsidian; },
  });
  vm.runInContext(mainBundle, context);
  const plugin = new context.module.exports.default();
  plugin.getDashboardModel = blocked('model');
  plugin.createPlaidClient = blocked('provider');
  plugin.openDashboard = async () => { counts.dashboard++; return 'opened'; };
  const makeApi = label => ({ externalActions: { register(action) {
    const key = `${action.pluginId}:${action.id}`;
    counts.registrations++; log.push(`register:${label}`); registry.set(key, action);
    // Real GCM callbacks delete by key, not registration ownership. This makes
    // cleanup-before-replacement observable even across two API facades.
    return () => { counts.cleanups++; log.push(`remove:${label}`); registry.delete(key); };
  } } });
  const firstApi = makeApi('first');
  if (initiallyAvailable) currentApi = firstApi;
  const emit = (available, api = currentApi, sourcePluginId = 'tps-global-context-menu') =>
    workspace.trigger('tps:gcm-api-changed', { sourcePluginId, available, api: available ? api : null });
  const unload = async () => { await plugin.onunload(); plugin.disposeEvents(); };
  const action = () => registry.get('tps-finances:open-finances');
  const assertNoDataWork = () => {
    for (const key of ['source', 'metadata', 'inventory', 'mutation', 'settingsWrite', 'model', 'provider'])
      assert.equal(counts[key], 0, `No ${key} during readiness or cleanup`);
  };
  return { plugin, app, counts, log, registry, commands, workspace, firstApi, makeApi, emit, unload,
    action, File, assertNoDataWork, setCurrentApi: api => { currentApi = api; } };
}

test('Finances loads before GCM and registers when the existing API readiness event arrives', async () => {
  const h = harness(); await h.plugin.onload();
  assert.equal(h.counts.registrations, 0);
  h.setCurrentApi(h.firstApi); h.emit(true);
  assert.equal(h.counts.registrations, 1); assert.ok(h.action()); h.assertNoDataWork();
});

test('GCM ready before Finances retains the existing initial menu registration', async () => {
  const h = harness(true); await h.plugin.onload();
  assert.equal(h.counts.registrations, 1); assert.equal(h.registry.size, 1); h.assertNoDataWork();
});

test('same API repeated readiness announcements do not replace a current keyed registration', async () => {
  for (const initiallyAvailable of [false, true]) {
    const h = harness(initiallyAvailable); await h.plugin.onload();
    h.setCurrentApi(h.firstApi); h.emit(true);
    const first = h.action(); for (let i = 0; i < 20; i++) h.emit(true);
    assert.equal(h.counts.registrations, 1); assert.equal(h.counts.cleanups, 0);
    assert.equal(h.action(), first); h.assertNoDataWork();
  }
});

test('API replacement cleans the old keyed action before registering the new owner', async () => {
  const h = harness(true); await h.plugin.onload(); const first = h.action();
  const secondApi = h.makeApi('second'); h.setCurrentApi(secondApi); h.emit(true);
  assert.deepEqual(h.log, ['register:first', 'remove:first', 'register:second']);
  assert.ok(h.action()); assert.notEqual(h.action(), first);
  assert.equal(h.counts.registrations, 2); assert.equal(h.counts.cleanups, 1); h.assertNoDataWork();
});

test('unavailable announcement removes the action before GCM deletes its still-discoverable API', async () => {
  const h = harness(true); await h.plugin.onload(); h.emit(false);
  assert.equal(h.registry.size, 0); assert.equal(h.counts.cleanups, 1);
  assert.equal(h.counts.registrations, 1, 'Do not re-register the API still present during GCM unload');
  h.setCurrentApi(null); h.emit(false); assert.equal(h.counts.cleanups, 1); h.assertNoDataWork();
});

test('a provider made unavailable may later register again even with the same API identity', async () => {
  const h = harness(true); await h.plugin.onload(); h.emit(false); h.setCurrentApi(null);
  h.setCurrentApi(h.firstApi); h.emit(true);
  assert.equal(h.counts.registrations, 2); assert.equal(h.counts.cleanups, 1); assert.ok(h.action());
  await h.unload(); assert.equal(h.counts.cleanups, 2); assert.equal(h.registry.size, 0); h.assertNoDataWork();
});

test('unrelated and malformed workspace announcements cannot affect the action owner', async () => {
  const h = harness(true); await h.plugin.onload(); const first = h.action();
  h.emit(false, null, 'unrelated-plugin'); h.emit(true, h.makeApi('unrelated'), 'unrelated-plugin');
  h.workspace.trigger('tps:gcm-api-changed', undefined);
  h.workspace.trigger('tps:gcm-api-changed', {});
  assert.equal(h.counts.registrations, 1); assert.equal(h.counts.cleanups, 0); assert.equal(h.action(), first);
  h.assertNoDataWork();
});

test('matching-source packets without an explicit valid availability do not alter the owner', async () => {
  const h = harness(true); await h.plugin.onload(); const first = h.action();
  for (const payload of [
    {}, { available: undefined }, { available: null }, { available: 'true' },
    { available: 0 }, { available: 1 }, { available: true }, { available: true, api: null },
  ]) h.workspace.trigger('tps:gcm-api-changed', { sourcePluginId: 'tps-global-context-menu', ...payload });
  assert.equal(h.counts.registrations, 1); assert.equal(h.counts.cleanups, 0);
  assert.equal(h.action(), first); h.assertNoDataWork();
});

test('Finances unload cleans only its current action and releases the readiness listener', async () => {
  const h = harness(true); await h.plugin.onload();
  const secondApi = h.makeApi('second'); h.setCurrentApi(secondApi); h.emit(true);
  await h.unload(); assert.equal(h.counts.cleanups, 2); assert.equal(h.registry.size, 0);
  assert.equal(h.workspace.listeners.size, 0);
  h.emit(true); h.emit(false); assert.equal(h.counts.registrations, 2); assert.equal(h.counts.cleanups, 2);
  h.assertNoDataWork();
});

test('an unloaded Finances waiting for GCM does not register when readiness later arrives', async () => {
  const h = harness(); await h.plugin.onload(); await h.unload();
  h.setCurrentApi(h.firstApi); h.emit(true); assert.equal(h.counts.registrations, 0);
  assert.equal(h.workspace.listeners.size, 0); h.assertNoDataWork();
});

test('unsupported GCM external action API leaves no registration and later supported API is accepted', async () => {
  const h = harness(true); await h.plugin.onload(); h.setCurrentApi({}); h.emit(true);
  assert.equal(h.registry.size, 0); assert.equal(h.counts.cleanups, 1);
  h.setCurrentApi(h.firstApi); h.emit(true); assert.equal(h.counts.registrations, 2); assert.ok(h.action());
  h.assertNoDataWork();
});

test('failed replacement registration leaves no stale owner and accepts a later successful announcement', async () => {
  const h = harness(true); await h.plugin.onload();
  const failingApi = { externalActions: { register() { throw new Error('Synthetic registration failure'); } } };
  h.setCurrentApi(failingApi);
  assert.throws(() => h.emit(true), /Synthetic registration failure/);
  assert.equal(h.registry.size, 0); assert.equal(h.counts.cleanups, 1);
  h.setCurrentApi(h.firstApi); h.emit(true); assert.ok(h.action());
  assert.equal(h.counts.registrations, 2);
  await h.unload(); assert.equal(h.counts.cleanups, 2); assert.equal(h.registry.size, 0); h.assertNoDataWork();
});

test('failed old cleanup is released before invocation and cannot run again during unload', async () => {
  const h = harness();
  const oldApi = { externalActions: { register(action) {
    h.counts.registrations++; h.registry.set('tps-finances:open-finances', action);
    return () => { h.counts.cleanups++; h.registry.clear(); throw new Error('Synthetic cleanup failure'); };
  } } };
  h.setCurrentApi(oldApi); await h.plugin.onload(); h.setCurrentApi(h.firstApi);
  assert.throws(() => h.emit(true), /Synthetic cleanup failure/);
  assert.equal(h.registry.size, 0); assert.equal(h.counts.cleanups, 1);
  await h.unload(); assert.equal(h.counts.cleanups, 1); assert.equal(h.workspace.listeners.size, 0);
  h.assertNoDataWork();
});

test('late menu action keeps its labels, current finance visibility and dashboard click behavior', async () => {
  const h = harness(); await h.plugin.onload(); h.setCurrentApi(h.firstApi); h.emit(true);
  const action = h.action(); assert.ok(action);
  assert.equal(action.id, 'open-finances'); assert.equal(action.pluginId, 'tps-finances');
  assert.equal(action.order, 35); assert.equal(action.icon, 'landmark');
  assert.equal(action.label, 'Open finances'); assert.equal(action.title, 'Open the TPS Finances dashboard');
  h.app.metadataCache.getFileCache = file => ({ frontmatter: file.frontmatter });
  const fields = [{ financeId: 'qa' }, { financeAccountId: 'qa' }, { financeRuleId: 'qa' },
    { financeBudgetId: 'qa' }, { type: 'financeSnapshot' }];
  for (const fm of fields) assert.equal(action.isVisible({ file: new h.File('Elsewhere/Record.md', fm) }), true);
  assert.equal(action.isVisible({ file: new h.File('Finances/Ordinary.md') }), true);
  assert.equal(action.isVisible({ file: new h.File('Finances-other/Ordinary.md') }), false);
  assert.equal(action.isVisible({ file: new h.File('Elsewhere/Ordinary.md') }), false);
  h.plugin.settings.financeFolder = '';
  assert.equal(action.isVisible({ file: new h.File('Finances/Ordinary.md') }), false);
  assert.equal(action.isVisible({ file: new h.File('Elsewhere/Record.md', { financeId: 'qa' }) }), true);
  assert.equal(await action.onClick(), 'opened'); assert.equal(h.counts.dashboard, 1); h.assertNoDataWork();
});
