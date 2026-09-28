import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

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
const result = await build({entryPoints:['src/dashboard-view.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'obsidian-dashboard-test',setup(b) {
    b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`
      export class ItemView { constructor(leaf) { this.contentEl = leaf.root; } }
      export class Notice {} export class Menu {} export class WorkspaceLeaf {}
      export const Platform = {isDesktopApp:true,isMobile:false}; export const setIcon=()=>{};
    `}));
  },
}]});
const {TPSFinancesView} = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const model = (amount = -10) => ({accounts:[{path:'Checking.md',name:'Checking',currency:'USD',type:'depository',subtype:'checking'}],holdings:[],connectedItems:0,plaidSetupState:'missing-credentials',budgets:[],budgetEntries:[
  {id:'food',name:'Food',bucket:'category',monthlyLimit:100,category:'Groceries',currency:'USD'},
  {id:'euro',name:'Euro spending',bucket:'flex',monthlyLimit:100,category:'',currency:'EUR'},
],transactions:[{financeId:'fixture',name:'Purchase',date:'2026-09-18',amount,currency:'USD',category:'Groceries',subtype:'purchase',type:'transaction',accountPath:'Checking',account:'Checking',pending:false}],lastSyncAt:''});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness() {
  const doc={activeElement:null},root=new Element('div',{},doc),counts={models:0,paint:0};
  let current=model(),reader=()=>Promise.resolve(current);
  const actions=[];
  const plugin={getDashboardModel(){counts.models++;return reader();},addMonthlyBudget(...args){actions.push(['add',...args]);},editMonthlyBudget(value){actions.push(['edit',value.id]);},async openTransactionSource(value){actions.push(['open',value.financeId]);}};
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
