import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

class Element {
  constructor(tag='div',options={},parent=null) {
    Object.assign(this,{tag,tagName:tag.toUpperCase(),parent,children:[],attrs:{...options.attr},events:{},text:options.text||'',cls:options.cls||'',dataset:{},scrollTop:0,open:false});
    for(const [key,value] of Object.entries(this.attrs)) if(key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;
  }
  createEl(tag,options={}){const node=new Element(tag,options,this);this.children.push(node);return node;}
  createDiv(options){return this.createEl('div',options);}
  createSpan(options){return this.createEl('span',options);}
  empty(){this.children=[];}
  all(){return this.children.flatMap(node=>[node,...node.all()]);}
  get textContent(){return this.text+this.children.map(node=>node.textContent).join('');}
  setText(value){this.text=value;}
  addClass(value){this.cls+=' '+value;}
  setAttribute(key,value){this.attrs[key]=value;}
  addEventListener(name,callback){this.events[name]=callback;}
  focus(){this.focused=true;}
  scrollIntoView(){this.scrolled=true;}
  contains(node){return this.all().includes(node);}
  querySelectorAll(selector){return this.all().filter(node=>selector==='details[open]'?node.tag==='details'&&node.open
    :selector==='details[data-finance-disclosure]'?node.tag==='details'&&node.dataset.financeDisclosure
    :selector.startsWith('.')?node.cls.split(' ').includes(selector.slice(1)):selector.split(',').map(tag=>tag.trim()).includes(node.tag));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
class Setting {
  constructor(parent){this.settingEl=parent.createDiv({cls:'setting-item'});this.settingEl.setting=this;this.controls=[];}
  setName(name){this.name=name;this.settingEl.createDiv({cls:'setting-item-name',text:name});return this;}
  setDesc(description){this.description=description;return this;}
  add(tag,callback){const element=this.settingEl.createEl(tag),control={inputEl:element,selectEl:element,toggleEl:element,buttonEl:element,options:{},
    setValue(value){this.value=value;element.value=value;return this;},setPlaceholder(){return this;},setCta(){return this;},setTooltip(value){this.tooltip=value;return this;},
    setButtonText(value){this.label=value;return this;},setDisabled(value){this.disabled=value;return this;},addOption(value,label){this.options[value]=label;return this;},
    onChange(fn){this.change=fn;return this;},onClick(fn){this.click=fn;return this;}};this.controls.push(control);callback(control);return this;}
  addButton(fn){return this.add('button',fn);}addText(fn){return this.add('input',fn);}addToggle(fn){return this.add('input',fn);}addDropdown(fn){return this.add('select',fn);}
}
const openedModals=[];
class Modal {
  constructor(){this.contentEl=new Element();this.titleEl=new Element();this.scope={register(){}};}
  open(){openedModals.push(this);this.onOpen();}
  close(){this.onClose?.();}
}
const obsidian={App:class{},TFile:class{},parseYaml(){throw Error('Unexpected parse');},stringifyYaml(){throw Error('Unexpected serialization');},Setting,Modal,Notice:class{},ToggleComponent:class{},PluginSettingTab:class{constructor(app){this.app=app;this.containerEl=new Element();}}};
function load(file,bindings){const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,id=>{assert.ok(id in bindings,id);return bindings[id];});return module.exports;}
const properties=load('src/finance-properties.ts',{obsidian});
const migrations=load('src/property-migration.ts',{obsidian,'./bounded-work':{},'./finance-properties':properties,'./finance-store':{},'./atomic-finance-store':{},'./finance-paths':{}});
const {TPSFinancesSettingTab}=load('src/settings.ts',{obsidian,'./finance-properties':properties,'./property-migration':{...migrations,async previewPropertyMigration(app,from,to,root){app.counts.previews++;return {journal:{notes:[],from:from.names,to:to.names,root},conflicts:[]};}}});
const priorFrame=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=fn=>fn();test.after(()=>{globalThis.requestAnimationFrame=priorFrame;});
const label=key=>key==='kind'?'Record kind':key==='type'?'Record type':key.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase()).replace(/(?<=.)[A-Z]/g,x=>x.toLowerCase());
const poison=new Proxy({}, {get(){throw Error('Settings accessed vault or provider state');}});
function harness(){
  const counts={saves:0,previews:0,mappings:[],legacyChecks:0,conversions:0,idReviews:0,idWrites:0,resumes:0,dashboards:[],rules:0,budgets:0,folders:[],gcm:0};
  const app={counts,plugins:{plugins:{}},vault:poison,metadataCache:poison,secretStorage:poison};
  const plugin={settings:{financeFolder:'',enableLogging:false,propertyNames:{keys:{}},propertyMigration:null,privateState:{keep:'untouched'}},legacyReviewRequired:()=>false,
    async saveSettings(){counts.saves++;},async setFinanceFolder(value){counts.folders.push(value);},async openFinanceBase(value){counts.dashboards.push(value);},addCategorizationRule(){counts.rules++;},addMonthlyBudget(){counts.budgets++;},
    async reviewLegacyTransactionMarkers(){counts.legacyChecks++;return {markers:0};},async migrateAtomicTransactions(){counts.conversions++;},
    async previewFinanceIdentityConsolidation(){counts.idReviews++;return {notes:[],bases:[],conflicts:[]};},async consolidateFinanceIdentities(){counts.idWrites++;},
    async changePropertyNames(from,to,migrate){counts.mappings.push({from:from.names,to:to.names,migrate});plugin.settings.propertyNames=to.names;},
    async resumePropertyMigration(){counts.resumes++;plugin.settings.propertyMigration=null;}};
  app.plugins.plugins['tps-finances']=plugin;
  const tab=new TPSFinancesSettingTab(app,plugin),root=tab.containerEl;
  const rows=()=>root.all().filter(node=>node.setting).map(node=>node.setting),row=name=>{const value=rows().find(row=>row.name===name);assert.ok(value,name);return value;};
  const route=name=>{const button=root.all().find(node=>node.attrs['aria-label']===name&&node.tag==='button');assert.ok(button,name);button.events.click();};
  const group=name=>row('Property group').controls[0].change(name);
  const action=(name,button)=>{const control=row(name).controls.find(control=>control.label===button);assert.ok(control,button);return control.click();};
  tab.display();return {tab,app,plugin,counts,root,rows,row,route,group,action};
}
function disclosure(node){for(let parent=node.parent;parent;parent=parent.parent)if(parent.tag==='details')return parent;return null;}

test('all 57 mappings remain reachable; 30 current fields precede 27 imported/older fields, with no open work',()=>{
  const h=harness(),before=structuredClone(h.plugin.settings),baseline=structuredClone(h.counts);h.route('Properties');
  const normal=[],earlier=[];
  for(const [group,keys] of Object.entries(properties.PROPERTY_GROUPS)){
    h.group(group);const details=h.root.all().filter(node=>node.tag==='details');assert.ok(details.length<=1);assert.ok(details.every(node=>!disclosure(node)));
    for(const key of keys){const row=h.row(label(key));assert.equal(row.controls.length,2,key);assert.equal(row.controls[0].value,key);assert.equal(row.controls[1].value,false);
      (disclosure(row.settingEl)?earlier:normal).push(key);assert.ok(row.description,key);}
  }
  assert.equal(normal.length,30);assert.equal(earlier.length,27);assert.equal(new Set([...normal,...earlier]).size,57);
  assert.deepEqual(earlier.filter(key=>['accountName','categoryOverride','transactionLogTarget','migrationSource'].includes(key)).sort(),['accountName','categoryOverride','migrationSource','transactionLogTarget']);
  for(let i=0;i<20;i++){h.route('Data & storage');h.route('Rules & budgets');h.route('Properties');for(const group of Object.keys(properties.PROPERTY_GROUPS))h.group(group);}
  assert.deepEqual(h.plugin.settings,before);assert.deepEqual(h.counts,baseline);assert.equal(openedModals.length,0);
});

test('every current and earlier mapping retains its name pin, draft, reset, and explicit save behavior',async()=>{
  const h=harness();h.route('Properties');
  for(const [group,keys] of Object.entries(properties.PROPERTY_GROUPS)){
    h.group(group);
    for(const key of keys){const row=h.row(label(key));row.controls[1].change(true);}
  }
  assert.equal(h.counts.mappings.length,0);await h.action('Property names','Save property names');
  assert.equal(h.counts.previews,0);assert.equal(h.counts.mappings.length,1);assert.equal(h.counts.mappings[0].migrate,false);
  assert.deepEqual(h.plugin.settings.propertyNames.keys,Object.fromEntries(properties.FINANCE_PROPERTY_KEYS.map(key=>[key,key])));
  h.group('Transactions');const details=h.root.querySelector('details[data-finance-disclosure]');details.open=true;
  h.row('Provider title').controls[0].change('import label');h.group('Common');h.group('Transactions');assert.equal(h.row('Provider title').controls[0].value,'import label');
  h.root.querySelector('details[data-finance-disclosure]').open=true;
  h.row('Provider title').controls[1].change(false);assert.equal(h.root.querySelector('details[data-finance-disclosure]').open,true);
  assert.equal(h.row('Provider title').controls[0].inputEl.focused,true);assert.equal(h.row('Provider title').controls[0].value,'providerTitle');
  h.row('Provider title').controls[0].change('import label');await h.action('Property names','Save property names');assert.equal(h.counts.previews,1);assert.equal(h.counts.mappings.length,1);
  const modal=openedModals.pop();assert.match(modal.titleEl.textContent,/Migrate existing/);modal.contentEl.all().find(node=>node.text==='Cancel').onclick();
  assert.equal(h.counts.mappings.length,1);await h.action('Property names','Discard edits');assert.equal(h.row('Provider title').controls[0].value,'providerTitle');
});

test('current GCM keys remain managed there while saved Finance aliases stay readable and unchanged',async()=>{
  const h=harness();h.plugin.settings.propertyNames.keys={kind:'olderKind',date:'olderDate'};
  h.app.plugins.plugins['tps-global-context-menu']={api:{frontmatterKinds:{version:2,propertyKey:key=>key==='scheduled'?'when':'recordKinds'},ui:{openCustomPropertySettings(){h.counts.gcm++;return true;}}}};
  h.route('Properties');assert.equal(h.row('Scheduled').controls.length,0);assert.match(h.row('Scheduled').description,/when.*olderDate/);
  assert.equal(h.row('Record kind').controls.length,0);assert.match(h.row('Record kind').description,/recordKinds.*olderKind/);
  assert.match(h.row('Record type').description,/omits it/);assert.deepEqual(h.plugin.settings.propertyNames.keys,{kind:'olderKind',date:'olderDate'});
  await h.action('Record classification','Configure in GCM');assert.equal(h.counts.gcm,1);assert.equal(h.counts.previews,0);assert.equal(h.counts.saves,0);
});

test('current Data controls precede one older-record disclosure; every maintenance action stays explicit',async()=>{
  const h=harness();assert.deepEqual(h.rows().map(row=>row.name),['Bank connections','Finance folder','Debug logging','Legacy inline transactions','Record IDs']);
  assert.equal(disclosure(h.row('Finance folder').settingEl),null);const earlier=disclosure(h.row('Record IDs').settingEl);assert.ok(earlier);assert.equal(earlier.open,false);
  earlier.open=true;await h.action('Legacy inline transactions','Check old entries');assert.equal(h.counts.legacyChecks,1);assert.equal(h.root.querySelector('details[data-finance-disclosure]').open,true);
  await h.action('Legacy inline transactions','Convert to transaction notes');await h.action('Record IDs','Review existing IDs');
  assert.equal(h.counts.conversions,1);assert.equal(h.counts.idReviews,1);assert.equal(h.counts.idWrites,0);assert.equal(h.counts.saves,0);
  await h.row('Finance folder').controls[0].change('Books');await h.row('Debug logging').controls[0].change(true);
  assert.deepEqual(h.counts.folders,['Books']);assert.equal(h.counts.saves,1);assert.deepEqual(h.plugin.settings.privateState,{keep:'untouched'});
});

test('rule/budget shortcuts and migration resume retain their original owners',async()=>{
  const h=harness();h.route('Rules & budgets');await h.action('Categorization rules','Add rule');await h.action('Monthly budgets','Open Budgets Base');await h.action('Monthly budgets','Add budget');
  assert.deepEqual(h.counts.dashboards,['Budgets']);assert.equal(h.counts.rules,1);assert.equal(h.counts.budgets,1);
  h.plugin.settings.propertyMigration={pending:true};h.route('Properties');assert.equal(h.rows().some(row=>row.name==='Property names'),false);assert.equal(h.counts.resumes,0);
  await h.action('Property migration paused','Resume migration');assert.equal(h.counts.resumes,1);assert.ok(h.row('Property names'));assert.equal(h.counts.previews,0);
});

test('disclosures are native, single-depth and mobile styling remains Finance-scoped',()=>{
  const h=harness();h.route('Properties');h.group('Holdings');const detail=h.root.querySelector('details[data-finance-disclosure]');assert.equal(detail.children[0].tag,'summary');
  assert.equal(disclosure(detail),null);assert.equal(detail.open,false);assert.match(h.row('Quantity').description,/TishOS controls import output/);
  const css=readFileSync('styles.css','utf8');assert.match(css,/\.tps-finances-settings-compatibility > summary:focus-visible/);assert.match(css,/overflow-x: auto/);assert.match(css,/flex-direction: column/);assert.doesNotMatch(css,/\.tps-settings-/);
});
