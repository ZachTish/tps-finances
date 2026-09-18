import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';

const bundle = async entry => (await build({
  entryPoints: [fileURLToPath(new URL(`../src/${entry}.ts`, import.meta.url))],
  bundle: true, write: false, format: 'cjs', target: 'es2018', minify: true,
  external: ['obsidian', 'electron', ...builtinModules],
})).outputFiles[0].text;
const mainBundle = process.env.TPS_FINANCES_TEST_BUNDLE
  ? readFileSync(process.env.TPS_FINANCES_TEST_BUNDLE, 'utf8') : await bundle('main');
const linkBundle = await bundle('plaid-link');

function mobileHarness(code = mainBundle, desktop = false, desktopModules = {}, mobile = !desktop) {
  const required = [], commands = [], modals = [], notices = [], files = new Map(), contents = new Map();
  class File {
    constructor(path) {
      this.path = path; this.name = path.split('/').at(-1);
      this.extension = this.name.split('.').at(-1); this.basename = this.name.replace(/\.[^.]+$/, '');
      this.stat = { mtime: 1, ctime: 1, size: 0 };
    }
  }
  const frontmatter = file => JSON.parse(contents.get(file.path)?.match(/^---\n([\s\S]*?)\n---/)?.[1] || '{}');
  const app = {
    plugins: { plugins: {}, getPlugin: () => null },
    secretStorage: { getSecret: () => null, setSecret: () => assert.fail('No credential writes expected') },
    vault: {
      on: () => ({}), getAbstractFileByPath: path => files.get(path) || null,
      getMarkdownFiles: () => [...files.values()].filter(f => f.extension === 'md'),
      createFolder: async path => { files.set(path, { path }); },
      create: async (path, text) => { assert.ok(!files.has(path)); const f = new File(path); files.set(path, f); contents.set(path, text); return f; },
      cachedRead: async file => contents.get(file.path), read: async file => contents.get(file.path),
      modify: async (file, text) => { contents.set(file.path, text); file.stat.mtime++; },
      process: async (file, update) => { contents.set(file.path, update(contents.get(file.path))); file.stat.mtime++; },
    },
    metadataCache: { on: () => ({}), getFileCache: file => ({ frontmatter: frontmatter(file) }) },
    workspace: {
      onLayoutReady: () => {}, getLeavesOfType: () => [], detachLeavesOfType: () => {},
      getLeaf: () => ({ openFile: async () => {} }),
    },
  };
  app.fileManager = { processFrontMatter: async (file, mutate) => {
    const fm = frontmatter(file); mutate(fm); contents.set(file.path, `---\n${JSON.stringify(fm)}\n---\n`);
  } };
  class Plugin {
    constructor() { this.app = app; }
    async loadData() { return { financeFolder: '', recordMode: 'atomic-note' }; }
    async saveData() { assert.fail('No settings writes expected'); }
    registerView() {} addSettingTab() {} addRibbonIcon() {} registerEvent() {}
    addCommand(command) { commands.push(command); }
  }
  class Modal { constructor(app) { this.app = app; } open() { modals.push(this); } }
  const obsidian = {
    Plugin, Modal, TFile: File, Platform: { isDesktopApp: desktop, isMobile: mobile },
    PluginSettingTab: class {}, ItemView: class {}, ButtonComponent: class {}, Setting: class {},
    Notice: class { constructor(message) { notices.push(message); } },
    normalizePath: p => p, stringifyYaml: value => JSON.stringify(value) + '\n', parseYaml: JSON.parse,
    setIcon: () => {},
  };
  const context = vm.createContext({
    module: { exports: {} }, console, crypto: webcrypto, window: { setTimeout, clearTimeout },
    require(name) {
      required.push(name);
      if (name === 'obsidian') return obsidian;
      if (desktop && name in desktopModules) return desktopModules[name];
      throw new Error(`Unavailable mobile module: ${name}`);
    },
  });
  vm.runInContext(code, context);
  return { exports: context.module.exports, app, required, commands, modals, notices, files, contents };
}

test('mobile manifest and complete production-shaped bundle activate with no Node or Electron runtime', async () => {
  assert.equal(JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url))).isDesktopOnly, false);
  const h = mobileHarness();
  const plugin = new h.exports.default();
  await plugin.onload();
  await plugin.prepareFinanceStorage();
  const model = await plugin.getDashboardModel();
  assert.equal(model.accounts.length, 0);
  assert.equal(model.connectedItems, 0);
  assert.ok(h.commands.some(command => command.id === 'add-cash-account'));
  assert.ok(h.commands.some(command => command.id === 'open-finances'));
  assert.ok([...h.files.keys()].some(path => path === 'Accounts.base'));
  await plugin.onunload();
  assert.ok(h.required.every(name => name === 'obsidian'));
});

test('mobile can create manual cash accounts and transactions and read the resulting balance without Controller', async () => {
  const h = mobileHarness();
  const plugin = new h.exports.default();
  await plugin.onload();
  plugin.addManualAccount('cash');
  await h.modals.at(-1).save({ name: 'Wallet', kind: 'cash', value: 100, currency: 'USD', valuationDate: '2026-09-17', assetType: 'personal-property', purchaseTransaction: '', liabilityAccount: '' });
  const account = (await plugin.getDashboardModel()).accounts[0];
  assert.equal(account.current, 100);
  await plugin.addCashTransaction();
  await h.modals.at(-1).save({ accountPath: account.path, title: 'Lunch', amount: 12.5, date: '2026-09-17', kind: 'expense', category: 'Food', tags: [], counterpart: '', linkedTransaction: '' });
  const model = await plugin.getDashboardModel();
  assert.equal(model.accounts[0].current, 87.5);
  assert.equal(model.transactions.length, 1);
  assert.equal(model.transactions[0].amount, -12.5);
  assert.ok(h.required.every(name => name === 'obsidian'));
});

test('mobile connect and reconnect fail before any provider access, including command entry points', async () => {
  const h = mobileHarness();
  const plugin = new h.exports.default();
  await plugin.onload();
  plugin.createPlaidClient = () => assert.fail('Mobile Link must not request a provider token');
  await assert.rejects(plugin.connectPlaid(), /Connect or reconnect Plaid.*desktop/);
  await assert.rejects(plugin.reconnectItem('synthetic'), /Connect or reconnect Plaid.*desktop/);
  await h.commands.find(command => command.id === 'connect-plaid').callback();
  await plugin.runReconnectItem('synthetic');
  assert.equal(h.notices.filter(n => /Connect or reconnect Plaid.*desktop/.test(n)).length, 2);
  assert.ok(h.required.every(name => name === 'obsidian'));
});

test('the Link entry point itself refuses mobile before loading http', async () => {
  const h = mobileHarness(linkBundle);
  await assert.rejects(h.exports.openLocalPlaidLink('synthetic'), /Connect or reconnect Plaid.*desktop/);
  assert.ok(h.required.every(name => name === 'obsidian'));
});

test('desktop still loads its localhost server on demand and closes it after browser failure', async () => {
  let listens = 0, closed = 0;
  const server = {
    once() {}, close() { closed++; }, address: () => ({ port: 12345 }),
    listen(port, host, ready) { assert.equal(port, 0); assert.equal(host, '127.0.0.1'); listens++; ready(); },
  };
  const h = mobileHarness(linkBundle, true, {
    http: { createServer: () => server },
    electron: { shell: { openExternal: async url => { assert.equal(url, 'http://127.0.0.1:12345/'); throw new Error('Synthetic browser failure'); } } },
  });
  assert.ok(!h.required.includes('http'));
  await assert.rejects(h.exports.openLocalPlaidLink('synthetic'), /Synthetic browser failure/);
  assert.equal(listens, 1); assert.equal(closed, 1);
  assert.ok(h.required.includes('http')); assert.ok(h.required.includes('electron'));
});


test('mobile emulation also blocks desktop Link instead of disguising unavailable actions', async () => {
  const h = mobileHarness(linkBundle, true, {}, true);
  await assert.rejects(h.exports.openLocalPlaidLink('synthetic'), /Connect or reconnect Plaid.*desktop/);
  assert.ok(h.required.every(name => name === 'obsidian'));
});

test('paired mobile startup and bank actions use the Controller with no local tokens or desktop imports', async () => {
  const h=mobileHarness();const requests=[];
  h.app.plugins.plugins['tps-controller']={api:{financeRelay:{version:1,getConfiguration:()=>({mode:'client',enabled:true}),getStatus:()=>({configured:true,mode:'client',enabled:true,online:true,message:'Controller ready.',items:[{localItemId:'synthetic-item',institutionName:'Synthetic Bank',environment:'sandbox',lastSyncAt:''}]}),getOperations:()=>[],request:async(action,id)=>{requests.push([action,id]);return 'synthetic-request';}}}};
  const plugin=new h.exports.default();await plugin.onload();assert.equal(plugin.canConnectPlaid(),true);
  await plugin.connectPlaid();await plugin.reconnectItem('synthetic-item');await plugin.syncAll('mobile');await plugin.disconnectItem('synthetic-item');
  assert.equal(plugin.getConnectedItems().length,1);assert.deepEqual(requests.map(r=>r[0]),['connect','reconnect','sync','disconnect']);
  assert.deepEqual([...new Set(h.required)],['obsidian']);assert.equal(h.modals.length,4);
});
