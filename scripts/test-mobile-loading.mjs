import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';
import { parse, stringify } from 'yaml';

const bundle = async entry => (await build({
  entryPoints: [fileURLToPath(new URL(`../src/${entry}.ts`, import.meta.url))],
  bundle: true, write: false, format: 'cjs', target: 'es2018', minify: true,
  external: ['obsidian', 'electron', ...builtinModules],
})).outputFiles[0].text;
const mainBundle = process.env.TPS_FINANCES_TEST_BUNDLE
  ? readFileSync(process.env.TPS_FINANCES_TEST_BUNDLE, 'utf8') : await bundle('main');

function mobileHarness(code = mainBundle, desktop = false, desktopModules = {}, mobile = !desktop) {
  const required = [], commands = [], modals = [], notices = [], files = new Map(), contents = new Map();
  class File {
    constructor(path) {
      this.path = path; this.name = path.split('/').at(-1);
      this.extension = this.name.split('.').at(-1); this.basename = this.name.replace(/\.[^.]+$/, '');
      this.stat = { mtime: 1, ctime: 1, size: 0 };
    }
  }
  const events = []; const views = []; const ribbons = [];
  const counts = { writes: 0, folders: 0, layout: 0 };
  const frontmatter = file => parse(contents.get(file.path)?.match(/^---\n([\s\S]*?)\n---/)?.[1] || '{}');
  const app = {
    plugins: { plugins: {}, getPlugin: () => null },
    secretStorage: { getSecret: () => null, setSecret: () => assert.fail('No credential writes expected') },
    vault: {
      on: (name, callback) => { events.push({name, callback}); return {}; }, getAbstractFileByPath: path => files.get(path) || null,
      getMarkdownFiles: () => [...files.values()].filter(f => f.extension === 'md'),
      createFolder: async path => { counts.folders++; files.set(path, { path }); },
      create: async (path, text) => { counts.writes++; assert.ok(!files.has(path)); const f = new File(path); files.set(path, f); contents.set(path, text); return f; },
      cachedRead: async file => contents.get(file.path), read: async file => contents.get(file.path),
      modify: async (file, text) => { counts.writes++; contents.set(file.path, text); file.stat.mtime++; },
      process: async (file, update) => { counts.writes++; contents.set(file.path, update(contents.get(file.path))); file.stat.mtime++; },
    },
    metadataCache: { on: (name, callback) => { events.push({name, callback}); return {}; }, getFileCache: file => ({ frontmatter: frontmatter(file) }) },
    workspace: {
      on: (name, callback) => { events.push({name, callback}); return {}; },
      onLayoutReady: () => { counts.layout++; }, getLeavesOfType: () => [], detachLeavesOfType: () => {},
      getLeaf: () => ({ openFile: async () => {} }),
    },
  };
  app.fileManager = { processFrontMatter: async (file, mutate) => {
    counts.writes++; const fm = frontmatter(file); mutate(fm); contents.set(file.path, `---\n${JSON.stringify(fm)}\n---\n`);
  } };
  class Plugin {
    constructor() { this.app = app; }
    async loadData() { return { financeFolder: '', recordMode: 'atomic-note' }; }
    async saveData() { assert.fail('No settings writes expected'); }
    registerView(name) { views.push(name); } addSettingTab() {} addRibbonIcon(name) { ribbons.push(name); } registerEvent() {}
    addCommand(command) { commands.push(command); }
  }
  class Modal { constructor(app) { this.app = app; } open() { modals.push(this); } }
  const obsidian = {
    Plugin, Modal, TFile: File, Platform: { isDesktopApp: desktop, isMobile: mobile },
    PluginSettingTab: class {}, ItemView: class {}, ButtonComponent: class {}, Setting: class {},
    Notice: class { constructor(message) { notices.push(message); } },
    normalizePath: p => p, stringifyYaml: stringify, parseYaml: parse,
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
  return { exports: context.module.exports, app, required, commands, modals, notices, files, contents, counts, events, views, ribbons };
}

test('mobile manifest and complete production-shaped bundle activate with no Node or Electron runtime', async () => {
  assert.equal(JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url))).isDesktopOnly, false);
  const h = mobileHarness();
  const plugin = new h.exports.default();
  await plugin.onload();
  const model = await plugin.getDashboardModel();
  assert.equal(model.accounts.length, 0);
  assert.ok(!h.commands.some(command => command.id === "connect-plaid" || command.id === "sync-finances"));
  assert.ok(h.commands.some(command => command.id === 'add-cash-account'));
  assert.ok(h.commands.some(command => command.id === 'add-cash-transaction'));
  assert.equal(h.commands.some(command => command.id === 'open-finances'), false);
  assert.equal(h.files.size, 0);
  assert.deepEqual(h.counts, { writes: 0, folders: 0, layout: 0 });
  await plugin.onunload?.();
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

for (const existingBase of [false, true]) test('startup and 20 dashboard model reads do not create or rewrite Bases: existing=' + existingBase, async () => {
  const h=mobileHarness();
  if(existingBase) await h.app.vault.create('Accounts.base','User-authored Base content');
  h.counts.writes=0;
  const before=[...h.contents.entries()];
  const plugin=new h.exports.default();
  await plugin.onload();
  assert.equal(h.counts.layout,0,'No deferred startup storage writer is registered');
  for(let i=0;i<20;i++) await plugin.getDashboardModel();
  await plugin.onunload?.();
  assert.deepEqual(h.counts,{writes:0,folders:0,layout:0});
  assert.deepEqual([...h.contents.entries()],before);
});


test('dashboard retirement removes launchers, render APIs and metadata-driven background work', async () => {
  const h=mobileHarness(), plugin=new h.exports.default();
  let scans=0, reads=0;
  h.app.vault.getMarkdownFiles=()=>{scans++;return [];};
  h.app.vault.cachedRead=async()=>{reads++;return '';};
  await plugin.onload();
  assert.equal(h.views.length,0);assert.equal(h.ribbons.length,0);
  assert.equal(h.commands.some(c=>c.id==='open-finances'),false);
  assert.equal(plugin.api.openDashboard,undefined);assert.equal(plugin.api.renderHomeSummary,undefined);
  assert.equal(typeof plugin.api.getDashboardModel,'function');
  assert.deepEqual(h.events.map(e=>e.name),['file-menu']);
  for(let i=0;i<1000;i++) for(const name of ['changed','rename','delete','active-leaf-change','layout-change','tps:gcm-api-changed'])
    for(const event of h.events) if(event.name===name) event.callback();
  assert.equal(scans,0);assert.equal(reads,0);assert.equal(h.counts.writes,0);
  const open=h.commands.find(c=>c.id==='open-budget');let base='';plugin.openFinanceBase=async name=>{base=name;};
  open.callback();await Promise.resolve();assert.equal(base,'Budgets');assert.equal(scans,0);
});

test('note context menu and command retain the guarded budget, asset and classification editors', async () => {
  const h=mobileHarness(),plugin=new h.exports.default();await plugin.onload();
  const create=(path,fm)=>h.app.vault.create(path,'---\n'+JSON.stringify(fm)+'\n---\nPreserved body');
  const budget=await create('Budget.md',{kind:'financeBudget',id:'budget',monthlyLimit:50});
  const asset=await create('Asset.md',{kind:'account',id:'asset',financeSource:'manual',accountType:'other',current:200});
  const tx=await create('Entry.md',{kind:'transaction',type:'transaction',id:'tx',amount:-5,date:'2026-10-21'});
  const unrelated=await create('Daily.md',{kind:['note','entity']});
  const selections=[];plugin.createStore=()=>({readBudgetEntries:async()=>[{id:'budget',sourcePath:budget.path}]});
  plugin.openBudgetEditor=async value=>selections.push(['budget',value.id]);
  plugin.updateAssetValue=value=>selections.push(['asset',value.financeAccountId]);
  plugin.getDashboardModel=async()=>({transactions:[{financeId:'tx',sourcePath:tx.path,sourceFile:tx}]});
  plugin.editTransactionClassification=value=>selections.push(['transaction',value.financeId]);
  const entry=h.events.find(e=>e.name==='file-menu');
  for(const file of [budget,asset,tx]) {
    let selected;const item={setTitle(label){assert.equal(label,'Edit finance record');return this;},setIcon(){return this;},onClick(fn){selected=fn;return this;}};
    entry.callback({addItem(fn){fn(item);}},file);assert.equal(typeof selected,'function');
    await plugin.editFinanceRecord(file);
  }
  assert.deepEqual(selections,[['budget','budget'],['asset','asset'],['transaction','tx']]);
  entry.callback({addItem(){assert.fail('unrelated note offered finance editor');}},unrelated);
  const command=h.commands.find(c=>c.id==='edit-finance-record');
  h.app.workspace.getActiveFile=()=>unrelated;assert.equal(command.checkCallback(true),false);
  h.app.workspace.getActiveFile=()=>budget;assert.equal(command.checkCallback(true),true);
  h.files.delete(tx.path);await assert.rejects(plugin.editFinanceRecord(tx),/removed/);
  h.app.plugins.getPlugin=()=>({api:{}});h.app.plugins.plugins['tps-global-context-menu']={api:{}};
  assert.equal(command.checkCallback(true),false,'unready classification owner hides action without throwing');
});
