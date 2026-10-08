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
    if (doc?.counts) doc.counts.nodes++;
  }
  get isConnected() { return this.parentElement ? this.parentElement.isConnected : this.connected === true; }
  createEl(tag, options = {}) { const child = new Element(tag, options, this.ownerDocument); this.children.push(child); child.parentElement = this; return child; }
  createDiv(options = {}) { return this.createEl('div', options); }
  createSpan(options = {}) { return this.createEl('span', options); }
  addClass(cls) { this.className += ` ${cls}`; }
  empty() { if (this === this.ownerDocument?.root) this.ownerDocument.counts.rootClears++; for (const child of this.children) child.parentElement = null; this.children = []; }
  setText(value) { this.textContent = value; this.children = []; }
  setAttr(key, value) { this.setAttribute(key, value); }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  fire(name, properties = {}) {
    const event = { ...properties, defaultPrevented: false, stopped: false,
      stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } };
    for (let target = this; target; target = target.parentElement) {
      for (const fn of target.listeners[name] || []) fn(event);
      if (event.stopped) break;
    }
    return event;
  }
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
],transactions:[{financeId:'fixture',name:'Purchase',date:'2026-09-18',amount,currency:'USD',category:'Groceries',subtype:'purchase',type:'transaction',accountPath:'Checking',account:'Checking',pending:false,tags:[]}],lastSyncAt:''});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(full = false) {
  const counts={models:0,paint:0,nodes:0,rootClears:0,renders:0},doc={activeElement:null,counts},root=new Element('div',{},doc);doc.root=root;root.connected=true;
  let current=model(),reader=()=>Promise.resolve(current);
  if (full) globalThis.document = {createElement:tag=>new Element(tag,{},doc),createTextNode:text=>new Element('#text',{text},doc)};
  const actions=[];
  const plugin={getDashboardModel(sources){counts.models++;return reader(sources);},addMonthlyBudget(...args){actions.push(['add',...args]);},editMonthlyBudget(value){actions.push(['edit',value.id]);},async openTransactionSource(value){actions.push(['open',value.financeId]);},async openFinanceBase(name){actions.push(['base',name]);}};
  const view=new TPSFinancesView({root},plugin);
  const renderModel=view.renderModel.bind(view);view.renderModel=(...args)=>{counts.renders++;return renderModel(...args);};
  if (!full) for(const key of ['renderHeader','renderAccounts','renderHoldings','renderTransactions','renderWelcome'])view[key]=()=>{};
  const summary=view.renderSummary.bind(view);
  view.renderSummary=(_root,m)=>{counts.paint++;view.lastOverview=m;if(full)summary(_root,m);};
  view.budgetState.month='2026-09';
  const control=key=>{const el=root.all().find(e=>e.attrs['data-budget-focus']===key);assert.ok(el,`Control ${key}`);return el;};
  const details=summary=>{const el=root.all().find(e=>e.tagName==='summary'&&e.textContent.includes(summary))?.parentElement;assert.ok(el,`Disclosure ${summary}`);return el;};
  return {view,root,doc,counts,actions,control,details,toggle(summary,open){const el=details(summary);el.open=open;el.fire('toggle');},setModel(m){current=m;},setReader(fn){reader=fn;},click(key){const el=control(key);el.focus();el.fire('click');},change(key,value){const el=control(key);el.value=value;el.focus();el.fire('change');},settle:()=>view.renderPromise||Promise.resolve()};
}

function populatedBudget(count=1000) {
  const data=model();
  data.budgetEntries.push({id:'rent',name:'Rent',bucket:'fixed',monthlyLimit:100,category:'Rent',currency:'USD'},
    {id:'flex',name:'Flexible allowance',bucket:'flex',monthlyLimit:1500,category:'',currency:'USD'});
  data.transactions=Array.from({length:count},(_,index)=>({...data.transactions[0],financeId:`purchase-${index}`,name:`Purchase ${index}` }));
  data.transactions.push({...data.transactions[0],financeId:'rent-payment',name:'Rent payment',category:'Rent',amount:-25},
    ...[1,2].map(index=>({...data.transactions[0],financeId:`review-${index}`,name:`Unknown ${index}`,subtype:'unknown'})));
  return data;
}
async function budgetOperations(run) {
  const h=harness(),data=populatedBudget();let formatters=0,scans=0;
  const originalFormatter=Intl.NumberFormat,iterator=data.transactions[Symbol.iterator];
  data.transactions[Symbol.iterator]=function*(){scans++;yield* iterator.call(this);};
  Intl.NumberFormat=new Proxy(originalFormatter,{construct(target,args){formatters++;return Reflect.construct(target,args);}});
  try {
    h.setModel(data);await h.view.onOpen();h.click('budget');await h.settle();
    const snapshot=()=>({...h.counts,formatters,scans});
    const rows=()=>h.root.all().filter(el=>el.className==='tps-finances-plan-transaction');
    await run({...h,data,snapshot,rows});
  } finally {Intl.NumberFormat=originalFormatter;}
}

test('route changes redraw the current model without rereading it, even in a burst',async()=>{
  const h=harness();await h.view.onOpen();assert.equal(h.counts.models,1);
  for(let i=0;i<25;i++){h.click('budget');await h.settle();assert.equal(h.control('budget').getAttribute('aria-pressed'),'true');h.click('overview');await h.settle();}
  assert.equal(h.counts.models,1,'display-only route changes must not scan the vault');
});

test('overview caps recent rows at 80 and browses the complete Transactions Base without another model read',async()=>{
  const h=harness(true),m=model();
  m.transactions=Array.from({length:85},(_,index)=>({...m.transactions[0],financeId:`transaction-${index}`}));
  h.setModel(m);
  await h.view.onOpen();
  assert.ok(h.root.all().some(element=>element.textContent==='Latest 80 transactions'));
  assert.equal(h.root.all().filter(element=>element.className.includes('tps-finances-row--clickable')).length,80);
  const browse=h.root.all().find(element=>element.attrs['aria-label']==='Browse all transactions');
  assert.equal(browse?.tagName,'button');assert.equal(browse?.type,'button');
  assert.ok(browse.className.includes('tps-finances-browse-button'));
  assert.ok(browse.all().some(element=>element.textContent==='Browse all transactions'));
  browse.fire('click');await Promise.resolve();
  assert.deepEqual(h.actions,[['base','Transactions']]);
  assert.equal(h.counts.models,1);
});

test('month, currency and expanded transactions use the loaded model and preserve focus',async()=>{
  const h=harness();await h.view.onOpen();h.click('budget');await h.settle();
  h.root.scrollTop=220;h.change('month','2026-08');await h.settle();assert.equal(h.view.budgetState.month,'2026-08');assert.equal(h.control('month').value,'2026-08');assert.equal(h.doc.activeElement,h.control('month'));assert.equal(h.root.scrollTop,220);
  h.change('month','2026-09');await h.settle();h.change('currency','EUR');await h.settle();assert.equal(h.control('currency').value,'EUR');h.change('currency','USD');await h.settle();
  h.toggle('Category limits',true);
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
  h.toggle('Category limits',true);
  h.root.all().find(e=>e.attrs['aria-label']==='Add income').fire('click');
  h.root.all().find(e=>e.attrs['aria-label']==='Edit Food').fire('click');
  h.click('expand-food');await h.settle();h.root.all().find(e=>e.className==='tps-finances-plan-transaction').fire('click');await Promise.resolve();
  assert.deepEqual(h.actions,[['add','income','USD'],['edit','food'],['open','fixture']]);assert.equal(h.counts.models,1);
});

test('data-read failures retain the existing error presentation',async()=>{
  const h=harness();h.setReader(()=>Promise.reject(Error('Read failed')));await h.view.onOpen();assert.ok(h.root.all().some(e=>e.className==='tps-finances-error'&&e.textContent==='Read failed'));assert.equal(h.view.renderPromise,null);
});

test('first open presents loading status before the model arrives and clears it after success or error',async()=>{
  const h=harness(true),pending=deferred();h.setReader(()=>pending.promise);
  const opening=h.view.onOpen();
  const loading=h.root.all().find(e=>e.className==='tps-finances-loading');
  assert.equal(loading?.textContent,'Loading finances…');assert.equal(loading?.getAttribute('role'),'status');
  await Promise.resolve();assert.equal(h.counts.models,1);
  pending.resolve(model());await opening;
  assert.ok(!h.root.all().includes(loading));assert.ok(h.root.all().some(e=>e.className==='tps-finances-summary'));
  const refreshPending=deferred();h.setReader(()=>refreshPending.promise);
  const refreshing=h.view.render();await Promise.resolve();
  assert.ok(!h.root.all().some(e=>e.className==='tps-finances-loading'),'refresh retains the displayed dashboard');
  refreshPending.reject(Error('Read failed'));await refreshing;
  assert.ok(h.root.all().some(e=>e.className==='tps-finances-error'&&e.textContent==='Read failed'));
  assert.equal(h.counts.models,2,'loading presentation adds no model read');
});

test('transaction source detail remains visible to touch layouts and accessible without hover',async()=>{
  const h=harness(true),m=model();m.transactions[0].name='Coffee shop';m.transactions[0].providerName='ACME COFFEE 123';m.transactions[0].tags=['food','receipt'];h.setModel(m);
  await h.view.onOpen();
  const row=h.root.all().find(e=>e.className.includes('tps-finances-row--clickable'));
  assert.match(row.getAttribute('aria-label'),/Coffee shop, imported as ACME COFFEE 123/);
  assert.equal(row.all().find(e=>e.className==='tps-finances-provider-name')?.textContent,'Imported as ACME COFFEE 123');
  assert.match(row.all().find(e=>e.className==='tps-finances-transaction-details')?.textContent,/2026-09-18 · Checking · Purchase · Groceries · food · receipt/);
  row.fire('click');assert.deepEqual(h.actions,[['open','fixture']]);
  assert.equal(h.counts.models,1);
});

test('narrow dashboard layout wraps transaction context and gives its controls touch targets',async()=>{
  const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  const narrow=css.slice(css.indexOf('@container (max-width: 650px)'),css.indexOf('@container (max-width: 520px)'));
  assert.match(css,/@media \(hover: none\)[\s\S]*?\.tps-finances-row-main \.tps-finances-provider-name \{ display: block/);
  for(const selector of ['.tps-finances-root .tps-finances-button','.tps-finances-view-routes button','.tps-finances-account-route','.tps-finances-budget-toolbar input','.tps-finances-budget-toolbar select','.tps-finances-plan-section button','.tps-finances-plan-section summary'])assert.ok(narrow.includes(selector),selector);
  assert.match(narrow,/\.tps-finances-plan-section summary \{ min-height: 44px; \}/);
  assert.match(narrow,/\.tps-finances-root \.tps-finances-button \{ min-width: 44px; \}/);
  assert.match(css,/@media \(max-width: 520px\)[\s\S]*?\.tps-finances-button\.tps-finances-browse-button \{[^}]*min-height: 44px;[^}]*font-size: var\(--font-ui-small\);[^}]*white-space: normal/);
  for(const selector of ['.tps-finances-classify-button','.tps-finances-plan-edit','.tps-finances-plan-toggle'])assert.ok(narrow.includes(selector),selector);
  assert.match(narrow,/\.tps-finances-plan-toggle \{ width: 44px; min-width: 44px; height: 44px; \}/);
  assert.match(narrow,/\.tps-finances-plan-row \{ grid-template-columns:repeat\(3,minmax\(0,1fr\)\) 44px; gap:8px; \}/);
  assert.match(narrow,/\.tps-finances-row--clickable \.tps-finances-transaction-details \{ white-space: normal/);
  assert.match(css,/@container \(max-width: 520px\)[\s\S]*?\.tps-finances-row--clickable \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 44px/);
  const assertRootAction=(h,label)=>{
    const root=h.root.all().find(e=>e.className.startsWith('tps-finances-root'));
    const action=root?.all().find(e=>e.attrs['aria-label']===label);
    assert.ok(action?.className.includes('tps-finances-button'),`${label} uses the root-scoped 44px button rule`);
  };
  const welcome=harness(true),empty=model();empty.accounts=[];empty.transactions=[];welcome.setModel(empty);
  await welcome.view.onOpen();assertRootAction(welcome,'Open connections');
  const manual=harness(true),accountModel=model();accountModel.accounts[0]={...accountModel.accounts[0],manual:true,type:'other',current:100};manual.setModel(accountModel);
  await manual.view.onOpen();assertRootAction(manual,'Open note');assertRootAction(manual,'Update value');
  assertRootAction(manual,'Browse all transactions');
});


test('closed Budget disclosures construct no transaction or category editor controls and one formatter',async t=>{
  await budgetOperations(async h=>{
    assert.equal(h.rows().length,0,'1000 flexible purchases and two review movements remain unconstructed');
    assert.ok(!h.root.all().some(el=>el.attrs['aria-label']==='Edit Food'),'closed category limits do not build editors');
    assert.ok(h.counts.nodes<250,`bounded closed surface: ${h.counts.nodes} created nodes`);
    assert.equal(h.snapshot().formatters,1,'one currency formatter is shared by the complete Budget render');
    assert.equal(h.snapshot().scans,1,'one calculation pass');assert.equal(h.counts.models,1);
    t.diagnostic(`closed 1000-purchase Budget: ${JSON.stringify(h.snapshot())}, transaction buttons=${h.rows().length}`);
  });
});

test('Budget disclosure bursts build only opened content without recalculation, root replacement or new formatters',async()=>{
  await budgetOperations(async h=>{
    const month=h.control('month'),rent=h.control('expand-rent'),before=h.snapshot();
    h.root.scrollTop=321;month.focus();
    for(let i=0;i<5;i++){
      h.toggle('flexible transactions',true);assert.equal(h.rows().length,1000);
      h.toggle('flexible transactions',false);assert.equal(h.rows().length,0);
      h.toggle('Review',true);assert.equal(h.rows().length,2);
      h.toggle('Review',false);assert.equal(h.rows().length,0);
    }
    const after=h.snapshot();
    for(const key of ['models','renders','rootClears','formatters','scans'])assert.equal(after[key],before[key],key);
    assert.ok(h.control('month')===month);assert.ok(h.control('expand-rent')===rent);
    assert.ok(h.doc.activeElement===month);assert.equal(h.root.scrollTop,321);
  });
});

test('one Budget row expands locally and retains the native control, focus, scroll and action owner',async t=>{
  await budgetOperations(async h=>{
    const rent=h.control('expand-rent'),month=h.control('month'),limits=h.details('Category limits'),before=h.snapshot();
    h.root.scrollTop=228;h.click('expand-rent');await h.settle();
    assert.equal(h.rows().length,1);assert.ok(h.control('expand-rent')===rent);assert.equal(rent.attrs['aria-expanded'],'true');
    assert.ok(h.control('month')===month);assert.ok(h.details('Category limits')===limits);
    assert.ok(h.doc.activeElement===rent);assert.equal(h.root.scrollTop,228);
    const after=h.snapshot();for(const key of ['models','renders','rootClears','formatters','scans'])assert.equal(after[key],before[key],key);
    assert.ok(after.nodes-before.nodes<=10,`one row creates ${after.nodes-before.nodes} nodes`);
    t.diagnostic(`one-row expansion deltas: ${JSON.stringify(Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]])))}`);
    h.rows()[0].fire('click');await Promise.resolve();assert.deepEqual(h.actions,[['open','rent-payment']]);
    h.click('expand-rent');assert.equal(h.rows().length,0);assert.ok(h.control('expand-rent')===rent);
  });
});

test('category limits lazily preserve row expansion while independent native rows remain unchanged',async()=>{
  await budgetOperations(async h=>{
    const rent=h.control('expand-rent'),before=h.snapshot();
    h.toggle('Category limits',true);const food=h.control('expand-food');
    h.root.all().find(el=>el.attrs['aria-label']==='Edit Food').fire('click');
    h.root.all().find(el=>el.textContent==='Add category limit').fire('click');
    h.click('expand-food');assert.equal(h.rows().length,1000);assert.ok(h.control('expand-food')===food);
    h.toggle('Category limits',false);assert.equal(h.rows().length,0);assert.ok(!h.root.all().includes(food));
    h.toggle('Category limits',true);assert.equal(h.rows().length,1000);assert.equal(h.control('expand-food').attrs['aria-expanded'],'true');
    assert.ok(h.control('expand-rent')===rent);
    const after=h.snapshot();for(const key of ['models','renders','rootClears','formatters','scans'])assert.equal(after[key],before[key],key);
    assert.deepEqual(h.actions,[['edit','food'],['add','category','USD']]);
  });
});

test('queued toggle deliveries and controls detached by refresh cannot rebuild or change the new Budget surface',async()=>{
  await budgetOperations(async h=>{
    h.toggle('Category limits',true);const oldFood=h.control('expand-food'),oldLimits=h.details('Category limits');
    const beforeQueued=h.snapshot();oldLimits.fire('toggle');oldLimits.fire('toggle');
    assert.equal(h.snapshot().nodes,beforeQueued.nodes,'unchanged open state creates no repeated controls');
    const latest=populatedBudget(2);latest.transactions[0]={...latest.transactions[0],name:'Fresh purchase',amount:-37};
    h.setModel(latest);await h.view.render();const month=h.control('month'),beforeDetached=h.snapshot();
    oldFood.fire('click');oldLimits.open=false;oldLimits.fire('toggle');
    assert.ok(h.control('month')===month,'detached controls do not replace current controls');assert.ok(h.view.budgetState.expanded.has('category-limits'));
    assert.ok(!h.view.budgetState.expanded.has('food'),'stale row click cannot toggle the current state');
    for(const key of ['nodes','models','renders','rootClears','formatters'])assert.equal(h.snapshot()[key],beforeDetached[key],key);
    h.click('expand-food');assert.equal(h.rows().length,2);assert.ok(h.rows().some(el=>el.all().some(child=>child.textContent==='Fresh purchase')));
  });
});

test('open disclosures and row details follow refreshed data, selected month and currency',async()=>{
  await budgetOperations(async h=>{
    h.toggle('flexible transactions',true);h.toggle('Review',true);h.click('expand-rent');
    const latest=populatedBudget(2);latest.transactions[0]={...latest.transactions[0],name:'Fresh purchase',amount:-37};
    latest.transactions.push({...latest.transactions[0],financeId:'euro-purchase',name:'Euro purchase',currency:'EUR',amount:-3});
    h.setModel(latest);await h.view.render();
    assert.equal(h.counts.models,2);assert.equal(h.rows().length,5);assert.equal(h.details('Review').open,true);
    assert.ok(h.rows().some(el=>el.all().some(child=>child.textContent==='Fresh purchase')));
    h.change('month','2026-10');assert.equal(h.rows().length,0);
    h.change('month','2026-09');h.change('currency','EUR');assert.equal(h.rows().length,1);
    assert.ok(h.rows()[0].all().some(child=>child.textContent==='Euro purchase'));
    h.change('currency','USD');assert.equal(h.rows().length,5);assert.equal(h.counts.models,2);
  });
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
test('retired inline records outside the finance folder stay idle while mapped records invalidate',async()=>{
  const h=eventHarness('Finances');await h.view.onOpen();await h.event('changed',new EventFile('Daily/New.md'),'[financeId:: new]');
  assert.equal(h.counts.models,1);
  h.owner.settings.propertyNames={keys:{type:'recordType'}};await h.event('changed',new EventFile('New.md',{recordType:'holding'}),'');assert.equal(h.counts.models,2);
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
test('metadata publication of a new atomic note schedules a model after an in-flight file snapshot',async()=>{
 const h=eventHarness('Finances');await h.view.onOpen();
 const pending=deferred(),latest=model(-23);let calls=0;
 h.setReader(sources=>{sources?.add('Finances/Accounts/Checking.md');return ++calls===1?pending.promise:Promise.resolve(latest)});
 const inFlight=h.view.render();await Promise.resolve();
 const published=h.event('changed',new EventFile('Finances/Transactions/New.md',{financeId:'new',type:'transaction'}),'');
 pending.resolve(model(-10));await Promise.all([inFlight,published]);
 assert.equal(h.counts.models,3,'initial, in-flight, then the metadata-triggered replacement');
 assert.equal(h.view.lastOverview,latest,'the later model wins over the captured file list');
});
test('classification-style explicit refresh and metadata event can cost one or two model builds',async t=>{
  const together=eventHarness();await together.view.onOpen();
  await Promise.all([together.event('changed',new EventFile('Journal.md'),'updated'),together.owner.refreshDashboard()]);
  assert.equal(together.counts.models,2,'same-turn event and explicit refresh share one model build');

  const during=eventHarness();await during.view.onOpen();const pending=deferred();let calls=0;
  during.setReader(sources=>{sources?.add('Journal.md');return ++calls===1?pending.promise:Promise.resolve(model(-19));});
  const event= during.event('changed',new EventFile('Journal.md'),'updated');await Promise.resolve();
  assert.equal(during.counts.models,2,'metadata event started one new model');
  const explicit=during.owner.refreshDashboard();pending.resolve(model(-2));await Promise.all([event,explicit]);
  assert.equal(during.counts.models,3,'explicit refresh during the read starts a second model');

  const later=eventHarness();await later.view.onOpen();await later.owner.refreshDashboard();
  await later.event('changed',new EventFile('Journal.md'),'updated');
  assert.equal(later.counts.models,3,'metadata event after explicit refresh starts a second model');
  t.diagnostic(`classification-style save: same-turn ${together.counts.models-1} model build; event during/after read ${during.counts.models-1}/${later.counts.models-1} builds`);
});

test('dashboard explicitly requests indexed properties on open and data refresh',async()=>{
 const h=harness(),sources=[];h.view.plugin.getDashboardModel=async(paths,source)=>{sources.push(source);paths.add('Account.md');return model();};
 await h.view.onOpen();await h.view.render();assert.deepEqual(sources,['metadata','metadata']);assert.ok(h.view.dependsOnSource('Account.md'));
});


function privacyHarness() {
  const h = harness(true), m = model(-43.21);
  m.accounts[0].current = 12345.67;
  m.accounts[0].mask = '1234';
  m.accounts[0].institutionName = 'Example Bank';
  m.holdings = [{ticker:'EXM',name:'Example holding',quantity:12.3456,price:78.91,value:974.56,currency:'USD'}];
  m.transactions.push({...m.transactions[0],financeId:'income',name:'Income',amount:876.54,subtype:'income',tags:['increase 12.5%']});
  h.setModel(m);
  h.text = () => h.root.all().map(el => el.textContent).join(' ');
  h.masked = () => h.root.all().filter(el => el.className.includes('tps-finances-private-value'));
  return h;
}

test('Overview privacy hides all amount categories from text and accessibility attributes', async () => {
  const h = privacyHarness(); await h.view.onOpen();
  assert.match(h.text(), /12,345.67/); assert.match(h.text(), /12.3456 shares/);
  h.click('amount-privacy');
  assert.equal(h.control('amount-privacy').getAttribute('aria-pressed'), 'true');
  assert.ok(h.masked().length >= 12, 'summary, balance, quantity, price, holding value and both transactions are covered');
  const serialized = JSON.stringify(h.root.all().map(el => ({text:el.textContent,attrs:el.attrs,title:el.title})));
  for (const value of ['12,345.67','12.3456','78.91','974.56','43.21','876.54']) assert.ok(!serialized.includes(value), value);
  for (const button of h.masked()) {
    assert.equal(button.tagName,'button');
    assert.equal(button.textContent,'••••');
    assert.equal(button.getAttribute('aria-pressed'),'false');
    assert.match(button.getAttribute('aria-label'),/^Reveal /);
  }
  assert.match(h.text(), /2026-09-18/); assert.match(h.text(), /12.5%/); assert.match(h.text(), /Checking •1234/);
  assert.equal(h.counts.models,1);
});

test('individual reveal uses only that value and never opens its transaction source', async () => {
  const h=privacyHarness();await h.view.onOpen();h.click('amount-privacy');
  const button=h.masked().find(el=>el.getAttribute('aria-label')==='Reveal amount for Purchase');
  assert.ok(button);button.fire('click');
  assert.match(button.textContent,/43.21/);assert.equal(button.getAttribute('aria-pressed'),'true');
  assert.equal(h.masked().filter(el=>el.getAttribute('aria-pressed')==='true').length,1);
  assert.deepEqual(h.actions,[]);
  for (const key of ['Enter',' ']) {
    const event=button.fire('keydown',{key});assert.equal(event.stopped,true);assert.equal(event.defaultPrevented,false,'native button activation remains available');
    button.fire('click');assert.deepEqual(h.actions,[]);
  }
  button.fire('click');assert.equal(button.textContent,'••••');
  const row=button.parentElement.parentElement;
  row.fire('click');assert.deepEqual(h.actions,[['open','fixture']]);
  assert.equal(h.counts.models,1);
});

test('privacy is Overview-only, survives refreshes while open and remasks individual reveals', async () => {
  const h=privacyHarness();await h.view.onOpen();h.click('amount-privacy');h.masked()[0].fire('click');
  h.click('budget');assert.equal(h.masked().length,0);assert.ok(!h.root.all().some(el=>el.getAttribute('data-budget-focus')==='amount-privacy'));assert.match(h.text(),/43.21/);
  h.click('overview');assert.ok(h.masked().every(el=>el.textContent==='••••'));
  h.masked()[0].fire('click');await h.view.render();assert.ok(h.masked().every(el=>el.textContent==='••••'));assert.equal(h.counts.models,2);
  h.click('amount-privacy');assert.equal(h.masked().length,0);assert.match(h.text(),/12,345.67/);
  for(let i=0;i<20;i++){h.click('amount-privacy');h.click('amount-privacy');}
  assert.equal(h.counts.models,2,'privacy bursts do not repeat model reads');
  assert.equal(h.doc.activeElement,h.control('amount-privacy'));
});

test('privacy is scoped to each open view and has accessible mobile controls', async () => {
  const h=privacyHarness();await h.view.onOpen();h.click('amount-privacy');
  const toggle=h.control('amount-privacy');
  assert.equal(toggle.textContent,'','compact icon control uses its accessible label');
  assert.equal(toggle.getAttribute('aria-label'),'Show amounts');
  assert.equal(toggle.parentElement.className,'tps-finances-title');
  const other=privacyHarness();await other.view.onOpen();assert.equal(other.masked().length,0);
  await h.view.onClose();await h.view.onOpen();assert.equal(h.masked().length,0,'closing the view ends its temporary privacy mode');
  const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  assert.match(css,/\.tps-finances-private-value[^}]*min-height: 44px/);
  assert.match(css,/\.tps-finances-private-value:focus-visible/);
  assert.match(css,/\.tps-finances-privacy-toggle[^}]*min-height: 44px/);
});
