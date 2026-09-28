import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// The actual dashboard and budget renderers run against a small DOM facade.
// Only Obsidian's view base and icons are replaced; no model reader is hidden.
class Element {
  constructor(tag = 'div', options = {}, doc) {
    this.tagName = tag; this.children = []; this.listeners = {}; this.attrs = {...options.attr};
    this.textContent = options.text || ''; this.value = options.value || ''; this.scrollTop = 0;
    this.ownerDocument = doc; this.className = options.cls || ''; this.type = options.type;
  }
  createEl(tag, options = {}) { const child = new Element(tag, options, this.ownerDocument); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl('div', options); }
  createSpan(options = {}) { return this.createEl('span', options); }
  addClass(cls) { this.className += ` ${cls}`; }
  empty() { this.children = []; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  fire(name) { for (const fn of this.listeners[name] || []) fn({stopPropagation() {}}); }
  focus() { this.ownerDocument.activeElement = this; }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector) { assert.equal(selector, '[data-budget-focus]'); return this.all().filter(el => el.attrs['data-budget-focus']); }
}
globalThis.__FinanceTestElement = Element;
const result = await build({stdin:{contents:"export * from './src/dashboard-view'; export * from './src/finance-properties';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'obsidian-dashboard-test',setup(b) {
    b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`
      export class ItemView { constructor(leaf) { this.contentEl = leaf.root; } }
      export class Notice {} export class Menu {} export class WorkspaceLeaf {}
      export class App {} export class TFile {} export const parseYaml=JSON.parse; export const stringifyYaml=JSON.stringify;
      export const Platform = {isDesktopApp:true,isMobile:false}; export const setIcon=()=>{};
    `}));
  },
}]});
const {TPSFinancesView,financeProperties} = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const model = (amount = -10) => ({accounts:[{path:'Checking.md',name:'Checking',currency:'USD',type:'depository',subtype:'checking'}],holdings:[],connectedItems:0,plaidSetupState:'missing-credentials',budgets:[],budgetEntries:[
  {id:'food',name:'Food',bucket:'category',monthlyLimit:100,category:'Groceries',currency:'USD'},
  {id:'euro',name:'Euro spending',bucket:'flex',monthlyLimit:100,category:'',currency:'EUR'},
],transactions:[{financeId:'fixture',name:'Purchase',date:'2026-09-18',amount,currency:'USD',category:'Groceries',subtype:'purchase',type:'transaction',accountPath:'Checking',account:'Checking',pending:false}],lastSyncAt:''});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness() {
  const doc={activeElement:null},root=new Element('div',{},doc),counts={models:0,paint:0};
  let current=model(),reader=()=>Promise.resolve(current);
  const actions=[];
  const plugin={getDashboardModel(sources){counts.models++;return reader(sources);},addMonthlyBudget(...args){actions.push(['add',...args]);},editMonthlyBudget(value){actions.push(['edit',value.id]);},async openTransactionSource(value){actions.push(['open',value.financeId]);}};
  const view=new TPSFinancesView({root},plugin);
  for(const key of ['renderHeader','renderAccounts','renderHoldings','renderTransactions','renderWelcome'])view[key]=()=>{};
  view.renderSummary=(_root,m)=>{counts.paint++;view.lastOverview=m;};
  view.budgetState.month='2026-09';
  const control=key=>{const el=root.all().find(e=>e.attrs['data-budget-focus']===key);assert.ok(el,`Control ${key}`);return el;};
  return {view,root,doc,counts,actions,control,setModel(m){current=m;},setReader(fn){reader=fn;},click(key){const el=control(key);el.focus();el.fire('click');},change(key,value){const el=control(key);el.value=value;el.focus();el.fire('change');},settle:()=>view.renderPromise||Promise.resolve()};
}

test('route changes redraw the current model without rereading it, even in a burst',async()=>{
  const h=harness();await h.view.onOpen();assert.equal(h.counts.models,1);
  for(let i=0;i<25;i++){h.click('budget');await h.settle();assert.equal(h.control('budget').getAttribute('aria-pressed'),'true');h.click('overview');await h.settle();}
  assert.equal(h.counts.models,1,'display-only route changes must not scan the vault');
});

test('month, currency and expanded transactions use the loaded model and preserve focus',async()=>{
  const h=harness();await h.view.onOpen();h.click('budget');await h.settle();
  h.root.scrollTop=220;h.change('month','2026-08');await h.settle();assert.equal(h.view.budgetState.month,'2026-08');assert.equal(h.control('month').value,'2026-08');assert.equal(h.doc.activeElement,h.control('month'));assert.equal(h.root.scrollTop,220);
  h.change('month','2026-09');await h.settle();h.change('currency','EUR');await h.settle();assert.equal(h.control('currency').value,'EUR');h.change('currency','USD');await h.settle();
  h.click('expand-food');await h.settle();assert.equal(h.control('expand-food').getAttribute('aria-expanded'),'true');
  assert.ok(h.root.all().some(e=>e.textContent==='Purchase'));
  h.click('expand-food');await h.settle();assert.equal(h.control('expand-food').getAttribute('aria-expanded'),'false');
  assert.equal(h.counts.models,1,'local budget controls must not reload transactions');
});

test('an explicit data refresh loads new data and replaces local control closures',async()=>{
  const h=harness();await h.view.onOpen();h.click('budget');await h.settle();
  const latest=model(-37);h.setModel(latest);await h.view.render();assert.equal(h.counts.models,2);
  h.click('overview');await h.settle();assert.equal(h.view.lastOverview,latest);assert.equal(h.counts.models,2);
  h.click('budget');await h.settle();assert.ok(h.root.all().some(e=>e.textContent.includes('37.00')));
});

test('local navigation during a data refresh does not discard or repeat its pending read',async()=>{
  const h=harness();await h.view.onOpen();const pending=deferred();h.setReader(()=>pending.promise);
  const refresh=h.view.render();await Promise.resolve();assert.equal(h.counts.models,2);
  h.click('budget');assert.equal(h.control('budget').getAttribute('aria-pressed'),'true');
  h.change('month','2026-08');assert.equal(h.control('month').value,'2026-08');
  pending.resolve(model(-22));await refresh;
  assert.equal(h.counts.models,2);assert.equal(h.control('budget').getAttribute('aria-pressed'),'true');assert.equal(h.control('month').value,'2026-08');
});

test('a second data invalidation still refreshes again and displays the latest model',async()=>{
  const h=harness();await h.view.onOpen();const pending=deferred(),latest=model(-51);let calls=0;h.setReader(()=>++calls===1?pending.promise:Promise.resolve(latest));
  const first=h.view.render();await Promise.resolve();const second=h.view.render();pending.resolve(model(-5));await Promise.all([first,second]);
  assert.equal(h.counts.models,3);assert.equal(h.view.lastOverview,latest);
});

test('closing during a data refresh prevents late or detached-control painting',async()=>{
  const h=harness();await h.view.onOpen();const pending=deferred();h.setReader(()=>pending.promise);const oldBudget=h.control('budget');const refresh=h.view.render();await Promise.resolve();await h.view.onClose();const oldChildren=h.root.children;pending.resolve(model(-90));await refresh;oldBudget.fire('click');
  assert.equal(h.root.children,oldChildren);assert.equal(h.counts.models,2);
});

test('budget mutating/navigation actions keep their existing owners',async()=>{
  const h=harness();await h.view.onOpen();h.click('budget');await h.settle();
  h.root.all().find(e=>e.attrs['aria-label']==='Add income').fire('click');
  h.root.all().find(e=>e.attrs['aria-label']==='Edit Food').fire('click');
  h.click('expand-food');await h.settle();h.root.all().find(e=>e.className==='tps-finances-plan-transaction').fire('click');await Promise.resolve();
  assert.deepEqual(h.actions,[['add','income','USD'],['edit','food'],['open','fixture']]);assert.equal(h.counts.models,1);
});

test('data-read failures retain the existing error presentation',async()=>{
  const h=harness();h.setReader(()=>Promise.reject(Error('Read failed')));await h.view.onOpen();assert.ok(h.root.all().some(e=>e.className==='tps-finances-error'&&e.textContent==='Read failed'));assert.equal(h.view.renderPromise,null);
});


const mainSource=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
const mainAst=ts.createSourceFile('main.ts',mainSource,ts.ScriptTarget.Latest,true),methods=[],eventSources={};
function visit(node){
  if(ts.isMethodDeclaration(node)&&['refreshDashboard','dashboardChangeMayIntroduceRecord','isFinanceRecord'].includes(node.name?.getText(mainAst)))methods.push(node.getText(mainAst));
  if(ts.isCallExpression(node)&&['this.app.vault.on','this.app.metadataCache.on'].includes(node.expression.getText(mainAst))&&['changed','rename','delete'].includes(node.arguments[0]?.text))eventSources[node.arguments[0].text]=node.arguments[1].getText(mainAst);
  ts.forEachChild(node,visit);
}visit(mainAst);
class EventFile {constructor(path,fm={}){this.path=path;this.extension=path.split('.').at(-1);this.fm=fm;}}
const exports={};
new Function('exports','TPSFinancesView','TPS_FINANCES_VIEW_TYPE','TFile','financeProperties','financePrefix',ts.transpileModule('export class Owner {'+methods.join('\n')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText)(exports,TPSFinancesView,'tps-finances',EventFile,financeProperties,(root,section='')=>root?[root,section].filter(Boolean).join('/')+'/':'');
function eventHarness(folder=''){
  const h=harness();h.sourceNames=['Account.md','Journal.md'];h.setReader(sources=>{for(const path of h.sourceNames)sources?.add(path);return Promise.resolve(model());});
  const owner=new exports.Owner();owner.settings={financeFolder:folder,propertyNames:{keys:{}}};owner.app={workspace:{getLeavesOfType:()=>h.leaves},metadataCache:{getFileCache:file=>({frontmatter:file.fm})},plugins:{plugins:{'tps-finances':owner}}};h.leaves=[{view:h.view}];
  const callbacks=Object.fromEntries(Object.entries(eventSources).map(([event,fn])=>[event,new Function('financePrefix',ts.transpileModule('const handler='+fn+';',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText+'return handler;').call(owner,root=>root?root+'/':'')]));
  return Object.assign(h,{owner,async event(name,file,oldPathOrData){callbacks[name](file,oldPathOrData);await h.settle();}});
}

test('unrelated rename/edit bursts do no dashboard reads after initial load',async()=>{
  const h=eventHarness();await h.view.onOpen();
  for(let i=0;i<50;i++){await h.event('rename',new EventFile('Other.md'),'Previous.md');await h.event('changed',new EventFile('Other.md'),'ordinary body');}
  assert.equal(h.counts.models,1);assert.equal(h.counts.paint,1);
});
test('metadata removal and legacy line removal refresh from the displayed source paths',async()=>{
  const h=eventHarness();await h.view.onOpen();await h.event('changed',new EventFile('Account.md'),'no finance frontmatter');await h.event('changed',new EventFile('Journal.md'),'legacy line removed');assert.equal(h.counts.models,3);
});
test('new inline records outside the finance folder and mapped records invalidate',async()=>{
  const h=eventHarness('Finances');await h.view.onOpen();await h.event('changed',new EventFile('Daily/New.md'),'[financeId:: new]');
  h.owner.settings.propertyNames={keys:{type:'recordType'}};await h.event('changed',new EventFile('New.md',{recordType:'holding'}),'');assert.equal(h.counts.models,3);
});
test('new reader candidates in a configured section refresh but unrelated folder documents do not',async()=>{
  const h=eventHarness('Finances');await h.view.onOpen();await h.event('rename',new EventFile('Finances/Readme.md'),'Finances/Old.md');assert.equal(h.counts.models,1);
  await h.event('rename',new EventFile('Finances/Accounts/New.md'),'Inbox/New.md');assert.equal(h.counts.models,2);
});
test('deletes, old rename paths and ancestor folder changes invalidate contributing sources',async()=>{
  const h=eventHarness();h.sourceNames=['Archive/Account.md'];await h.view.onOpen();await h.event('rename',new EventFile('Elsewhere.md'),'Archive/Account.md');await h.event('delete',new EventFile('Archive/Account.md'));await h.event('rename',{path:'Moved'},'Archive');assert.equal(h.counts.models,4);
});
test('attachments never request a model; Markdown extension transitions still do',async()=>{
  const h=eventHarness();h.sourceNames=['Account.md'];await h.view.onOpen();for(let i=0;i<25;i++)await h.event('rename',new EventFile('New.png'),'Old.png');assert.equal(h.counts.models,1);await h.event('rename',new EventFile('Account.txt'),'Account.md');assert.equal(h.counts.models,2);
});
test('in-flight reads conservatively invalidate; their replaced dependency set does not retain old paths',async()=>{
  const h=eventHarness();await h.view.onOpen();const pending=deferred();let n=0;h.setReader(sources=>{sources?.add('Newest.md');return ++n===1?pending.promise:Promise.resolve(model(-55));});
  const refresh=h.view.render();await Promise.resolve();const changed=h.event('changed',new EventFile('Unseen.md'),'removed data');pending.resolve(model(-4));await Promise.all([refresh,changed]);assert.equal(h.view.lastOverview.transactions[0].amount,-55);assert.equal(h.counts.models,3);
  await h.event('delete',new EventFile('Account.md'));assert.equal(h.counts.models,3,'retired dependency is discarded');await h.event('delete',new EventFile('Newest.md'));assert.equal(h.counts.models,4);
});
test('closed views and explicit refresh retain lifecycle ownership and do no source writes',async()=>{
  const h=eventHarness();await h.view.onOpen();h.leaves=[];await h.event('changed',new EventFile('New.md',{financeId:'new'}),'');assert.equal(h.counts.models,1);h.leaves=[{view:h.view}];await h.owner.refreshDashboard();assert.equal(h.counts.models,2);await h.view.onClose();await h.event('delete',new EventFile('Account.md'));assert.equal(h.counts.models,2);
});
test('sync/migration still own final refresh and errors remain refreshable',async()=>{
  const h=eventHarness();await h.view.onOpen();h.owner.syncing=true;await h.event('delete',new EventFile('Account.md'));h.owner.syncing=false;h.owner.settings.propertyMigration={};await h.event('changed',new EventFile('Account.md'),'');assert.equal(h.counts.models,1);h.owner.settings.propertyMigration=null;
  h.setReader(()=>Promise.reject(Error('invalid record')));await h.view.render();h.setReader(sources=>{sources?.add('Repaired.md');return Promise.resolve(model());});await h.event('changed',new EventFile('Other.md'),'correction');assert.equal(h.counts.models,3);
});


test('root label-only account candidates and moved section ancestors refresh',async()=>{
  const h=eventHarness();await h.view.onOpen();await h.event('changed',new EventFile('Label.md',{kind:'account',title:'New account label'}),'');assert.equal(h.counts.models,2);
  const nested=eventHarness('Parent/Finances');await nested.view.onOpen();await nested.event('rename',{path:'Parent'},'Elsewhere');assert.equal(nested.counts.models,2);
});
test('metadata bursts during a read coalesce and closing releases the view dependency set',async()=>{
  const h=eventHarness();await h.view.onOpen();const pending=deferred();let n=0;h.setReader(sources=>{sources?.add('Fresh.md');return ++n===1?pending.promise:Promise.resolve(model(-19));});const load=h.view.render();await Promise.resolve();
  const work=[];for(let i=0;i<50;i++)work.push(h.event('changed',new EventFile('Account.md'),'changed source'));pending.resolve(model(-2));await Promise.all([load,...work]);assert.equal(h.counts.models,3);assert.equal(h.view.lastOverview.transactions[0].amount,-19);await h.view.onClose();assert.equal(h.view.sourcePaths,null);
});

test('dashboard explicitly requests indexed properties on open and data refresh',async()=>{
 const h=harness(),sources=[];h.view.plugin.getDashboardModel=async(paths,source)=>{sources.push(source);paths.add('Account.md');return model();};
 await h.view.onOpen();await h.view.render();assert.deepEqual(sources,['metadata','metadata']);assert.ok(h.view.dependsOnSource('Account.md'));
});
