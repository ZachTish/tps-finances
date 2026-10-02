import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse, stringify} from 'yaml';
import {readFileSync} from 'node:fs';
class File {constructor(path){this.path=path;this.basename=path.split('/').at(-1).replace(/\.md$/,'');this.extension=path.split('.').at(-1);this.stat={mtime:1,size:0};}}
globalThis.PropertyQA={File,parse,stringify};
const output=await build({stdin:{contents:['finance-properties','property-migration','atomic-finance-store','manual-finance','finance-store','settings-persistence'].map(name=>`export * from './src/${name}.ts';`).join('\n')+`\nexport {default as FinancePlugin} from './src/main.ts';\nexport {setLoggingEnabled} from './src/logger.ts';`,resolveDir:process.cwd()},bundle:true,write:false,external:['electron'],platform:'node',format:'esm',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export class Plugin{constructor(app){this.app=app}};export class PluginSettingTab{};export class ButtonComponent{};export class Modal{};export class Setting{};export class Notice{};export class SecretComponent{};export class ItemView{};export class Menu{};export class WorkspaceLeaf{};export const setIcon=()=>{};export const Platform={isDesktopApp:true};export const requestUrl=()=>{throw Error("Unexpected provider request")};export class App{};export const TFile=globalThis.PropertyQA.File;export const normalizePath=s=>s;export const parseYaml=globalThis.PropertyQA.parse;export const stringifyYaml=globalThis.PropertyQA.stringify;`}));}}]});
const {FinancePlugin,FinanceProperties,financeProperties,FINANCE_PROPERTY_KEYS,PROPERTY_GROUPS,normalizePropertyNames,propertyChanges,migrateProperties,previewPropertyMigration,previewGeneratedBaseClassificationChange,applyPropertyMigration,normalizePropertyMigration,AtomicFinanceStore,ManualFinanceStore,FinanceStore,auditLegacyTransactionMarkers,CoalescedSnapshotWriter,reconcilePersistedSnapshot,setLoggingEnabled,atomicBase,transactionsBaseBody}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const mapped=()=>new FinanceProperties({keys:Object.fromEntries(FINANCE_PROPERTY_KEYS.map(key=>[key,`custom ${key}`]))});
function harness(properties=new FinanceProperties()){
 const files=new Map(),contents=new Map();let failPath='';
 const fm=p=>{const match=contents.get(p)?.match(/^---\n([\s\S]*?)\n---/);return match?parse(match[1])||{}:{}};
 const vault={getAbstractFileByPath:p=>files.get(p),getMarkdownFiles:()=>[...files.values()].filter(f=>f instanceof File && f.extension==='md'),createFolder:async p=>files.set(p,{path:p}),create:async(p,c)=>{assert.ok(!files.has(p),'occupied');const f=new File(p);f.stat.size=c.length;files.set(p,f);contents.set(p,c);return f;},read:async f=>contents.get(f.path),cachedRead:async f=>contents.get(f.path),process:async(f,fn)=>{if(f.path===failPath)throw Error('disk failure');const next=fn(contents.get(f.path));contents.set(f.path,next);f.stat.mtime++;f.stat.size=next.length;return next;}};
 const plugin={settings:{propertyNames:properties.names,propertyMigration:null}};
 const app={vault,plugins:{plugins:{'tps-finances':plugin}},metadataCache:{getFileCache:f=>({frontmatter:fm(f.path)})},fileManager:{processFrontMatter:async(f,fn)=>{if(f.path===failPath)throw Error('disk failure');const raw=fm(f.path);fn(raw);contents.set(f.path,'---\n'+stringify(raw)+'---\n'+contents.get(f.path).replace(/^---\n[\s\S]*?\n---\n/,''));},trashFile:async f=>{files.delete(f.path);contents.delete(f.path);}}};
 return {app,plugin,files,contents,fm,store:new AtomicFinanceStore(app,''),manual:new ManualFinanceStore(app,''),add:async(path,raw,body='Personal body\n')=>vault.create(path,'---\n'+stringify(raw)+'---\n'+body),fail:path=>failPath=path};
}
const tx={financeId:'tx1',providerTransactionId:'provider1',financeAccountId:'account1',date:'2026-09-20',authorizedDate:'2026-09-19',name:'Coffee',merchantName:'Cafe',amount:-5,currency:'USD',pending:false,category:'FOOD',categoryDetail:'DINING',subtype:'',kind:'transaction'};
const account={financeAccountId:'account1',name:'Checking',institutionName:'Bank',currency:'USD',type:'depository',subtype:'checking',mask:'1234',current:200,available:150,limit:null};
const holding={financeAccountId:'account1',securityId:'ABC',name:'Fund',ticker:'ABC',type:'equity',quantity:2,price:50,value:100,costBasis:90,currency:'USD'};
const state={providerIdentityMap:{'transaction:provider1':'tx1'}};

test('every property can use exactly one configured key, with IDs and values intact',()=>{
 const p=mapped(),fields=Object.fromEntries(FINANCE_PROPERTY_KEYS.map((key,i)=>[key,[false,0,'',null,['list']][i%5]]));fields.financeId='id';
 const raw=p.write(fields);assert.deepEqual(p.read(raw),fields);
 for(const key of FINANCE_PROPERTY_KEYS){assert.ok(!(key in raw));assert.ok(p.key(key) in raw)}
 assert.equal(raw.financeId,'id');assert.equal(new Set(Object.values(PROPERTY_GROUPS).flat()).size,FINANCE_PROPERTY_KEYS.length);
});
test('old keys are not fallback aliases and remain untouched when migration was declined',()=>{
 const p=new FinanceProperties({keys:{type:'transactionType',amount:'total'}}),raw={type:'transaction',amount:4,custom:'keep'};
 assert.equal(p.read(raw).type,undefined);assert.equal(p.read(raw).amount,undefined);
 p.mutate(raw,f=>{f.title='New title'});assert.deepEqual(raw,{type:'transaction',amount:4,custom:'keep',title:'New title'});
 raw.transactionType='investmentTransaction';raw.total=12;p.mutate(raw,f=>{f.amount=13});
 assert.equal(raw.type,'transaction');assert.equal(raw.amount,4);assert.equal(raw.total,13);
});
test('configured names validate duplicates, blank names, identity collisions and reused current keys',()=>{
 for(const keys of [{type:''},{type:'a',kind:'a'},{type:'amount'},{type:'financeId'},{type:'__proto__'},{type:' a'},{type:'a\nb'}])assert.throws(()=>new FinanceProperties({keys}));
 assert.throws(()=>mapped().assertIdentityKey('custom type'),/identity/);
 assert.throws(()=>propertyChanges(new FinanceProperties({keys:{type:'custom'}}),new FinanceProperties({keys:{kind:'custom'}})),/currently used/);
 assert.deepEqual(normalizePropertyNames(),{keys:{}});
});
test('mutation callback failures are atomic',()=>{
 const raw={transactionType:'transaction',type:'keep',custom:'keep'},before=structuredClone(raw);
 assert.throws(()=>new FinanceProperties({keys:{type:'transactionType'}}).mutate(raw,f=>{f.amount=3;throw Error('guard')}),/guard/);assert.deepEqual(raw,before);
});
test('provider accounts, transaction updates and holdings use configured properties in root storage',async()=>{
 const p=mapped(),h=harness(p),paths=await h.store.upsertAccounts([account]);
 await h.store.applyTransactions([tx],[],[],state,paths);
 await h.store.updateTransactionMetadata('tx1','Dining',['food']);
 await h.app.fileManager.processFrontMatter(h.files.get('tx1.md'),raw=>{raw.receipt='keep';});h.contents.set('tx1.md',h.contents.get('tx1.md')+'Receipt body\n');
 await h.store.applyTransactions([],[{...tx,amount:-7}],[],state,paths);
 assert.equal(h.fm('tx1.md')['custom amount'],-7);assert.equal(h.fm('tx1.md')['custom categoryOverride'],'Dining');assert.deepEqual(h.fm('tx1.md')['custom tags'],['food']);assert.equal(h.fm('tx1.md').receipt,'keep');assert.match(h.contents.get('tx1.md'),/Receipt body/);
 assert.equal((await h.store.readTransactionRecords()).length,1);
 await h.store.writeSnapshot([account],[holding],paths,new Date('2026-09-20T12:00:00Z'));
 assert.equal(h.fm('ABC — Bank Checking •1234.md')['custom type'],'holding');assert.equal(h.fm('ABC — Bank Checking •1234.md')['custom title'],'ABC — Bank Checking •1234');assert.equal(h.fm(paths.get('account1'))['custom accountType'],'depository');
 await h.store.writeSnapshot([account],[],paths,new Date('2026-09-20T12:00:00Z'));assert.equal(h.fm('ABC — Bank Checking •1234.md')['custom active'],false);
 await h.store.applyTransactions([],[],['provider1'],state,paths);assert.ok(!h.files.has('tx1.md'));
 for(const f of h.app.vault.getMarkdownFiles()) for(const key of FINANCE_PROPERTY_KEYS)assert.ok(!(key in h.fm(f.path)),`${f.path}: ${key}`);
});
test('manual cash, transfers, assets and valuations round trip through configured names',async()=>{
 const h=harness(mapped());
 const a=await h.manual.createAccount({kind:'cash',name:'Wallet',currency:'USD',value:100,valuationDate:'2026-09-20',purchaseTransaction:'',liabilityAccount:'',assetType:''});
 const b=await h.manual.createAccount({kind:'asset',name:'Computer',currency:'USD',value:500,valuationDate:'2026-09-20',purchaseTransaction:'',liabilityAccount:'',assetType:'computer'});
 await h.manual.updateValue(b.path,450,'2026-09-20');assert.equal(h.fm(b.path)['custom current'],450);
 const file=await h.manual.createCashEntry({title:'Cash coffee',amount:5,date:'2026-09-20',accountPath:a.path,kind:'expense',category:'Food',tags:['coffee'],counterpart:'',linkedTransaction:''});
 assert.equal(h.fm(file.path)['custom amount'],-5);assert.equal(h.fm(file.path)['custom type'],'transaction');assert.ok(h.fm(file.path).financeId);assert.equal((await h.store.readTransactionRecords()).length,1);
});
test('budgets, savings links, rules and legacy snapshots use configured keys',async()=>{
 const p=mapped(),h=harness(p),paths=await h.store.upsertAccounts([account]);
 await h.store.createRule({id:'rule',name:'Coffee rule',enabled:false,priority:5,accountContains:'',nameContains:'Coffee',merchantContains:'',minAmount:0,maxAmount:10,category:'Food',tags:[]});assert.equal(h.store.readRules()[0].enabled,false);
 const budget={id:'budget',name:'Save',bucket:'savings',category:'',monthlyLimit:200,currency:'USD',accounts:[`[[${paths.get('account1').replace(/\.md$/,'')}]]`]};
 await h.store.saveBudgetEntry(budget);const original=(await h.store.readBudgetEntries())[0];assert.equal(original.monthlyLimit,200);await h.store.saveBudgetEntry({...budget,monthlyLimit:250},original);assert.equal((await h.store.readBudgetEntries())[0].monthlyLimit,250);
 await h.store.createBudget({id:'category',name:'Food budget',category:'Food',monthlyLimit:100});assert.equal(h.store.readBudgets()[0].monthlyLimit,100);
 const lines=new FinanceStore(h.app,'');const path=await lines.writeSnapshot([],[],new Map(),new Date('2026-09-20T12:00:00Z'));assert.equal(h.fm(path)['custom type'],'financeSnapshot');assert.equal(await lines.writeSnapshot([],[],new Map(),new Date('2026-09-20T12:00:00Z')),path);
});
test('generated Bases use only configured names; atomic-line columns stay unchanged',()=>{
 const p=mapped(),base=parse(p.base(atomicBase('','Holdings')));assert.match(base.filters.and[0],/note\["custom type"\]/);assert.doesNotMatch(base.filters.and[0],/if\(/);assert.equal(base.views[0].order[1],'custom account');assert.equal(base.views[0].sort[0].property,'custom value');
 const lines=parse(p.base(transactionsBaseBody('')));assert.equal(lines.views[0].order[0],'date');assert.equal(lines.filters.and[0],'file.ext == "md"');
});
test('migration preview identifies finance records only and changes no data',async()=>{
 const h=harness(),from=new FinanceProperties(),to=mapped();await h.add('Transaction.md',{financeId:'id',type:'transaction',amount:0,custom:'keep'});await h.add('Personal.md',{type:'transaction',amount:1});
 const before=[...h.contents];const {journal,conflicts}=await previewPropertyMigration(h.app,from,to,'');assert.deepEqual(conflicts,[]);assert.deepEqual(journal.notes.map(n=>n.path),['Transaction.md']);assert.deepEqual([...h.contents],before);
 await applyPropertyMigration(h.app,journal);assert.deepEqual(h.fm('Transaction.md'),{financeId:'id','custom type':'transaction','custom amount':0,custom:'keep'});assert.match(h.contents.get('Transaction.md'),/Personal body/);assert.equal(h.fm('Personal.md').amount,1);
});
test('destination conflicts block the complete batch before any note changes',async()=>{
 const h=harness(),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'recordType'}});
 await h.add('A.md',{financeId:'a',type:'transaction'});await h.add('B.md',{financeId:'b',type:'transaction',recordType:'other'});
 const before=[...h.contents],preview=await previewPropertyMigration(h.app,from,to,'');assert.equal(preview.conflicts.length,1);await assert.rejects(applyPropertyMigration(h.app,preview.journal),/different value/);assert.deepEqual([...h.contents],before);
});
test('interrupted migration resumes after reload without read aliases or lost values',async()=>{
 const h=harness(),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'recordType'}});
 await h.add('A.md',{financeId:'a',type:'transaction',amount:0});await h.add('B.md',{financeId:'b',type:'transaction',pending:false});
 const {journal}=await previewPropertyMigration(h.app,from,to,'');h.fail('B.md');await assert.rejects(applyPropertyMigration(h.app,journal),/disk failure/);assert.equal(h.fm('A.md').recordType,'transaction');assert.equal(h.fm('B.md').type,'transaction');
 h.plugin.settings.propertyMigration=JSON.parse(JSON.stringify(journal));assert.throws(()=>financeProperties(h.app),/Resume/);h.fail('');await applyPropertyMigration(h.app,normalizePropertyMigration(h.plugin.settings.propertyMigration));h.plugin.settings.propertyNames=to.names;h.plugin.settings.propertyMigration=null;
 assert.equal(h.fm('A.md').amount,0);assert.equal(h.fm('B.md').pending,false);assert.ok(!('type' in h.fm('B.md')));assert.equal(financeProperties(h.app).read(h.fm('B.md')).type,'transaction');
});
test('changed identity, missing notes and concurrent target edits cannot overwrite content',async()=>{
 const h=harness(),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'recordType'}});await h.add('A.md',{financeId:'a',type:'transaction'});const {journal}=await previewPropertyMigration(h.app,from,to,'');
 await h.app.fileManager.processFrontMatter(h.files.get('A.md'),r=>r.financeId='other');await assert.rejects(applyPropertyMigration(h.app,journal),/identity/);
 h.files.delete('A.md');await assert.rejects(applyPropertyMigration(h.app,journal),/missing/);
 const raw={type:'transaction',recordType:'transaction',custom:false};assert.equal(migrateProperties(raw,from,to),true);assert.deepEqual(raw,{recordType:'transaction',custom:false});assert.equal(migrateProperties(raw,from,to),false);
});
test('migration updates recognized generated Bases but preserves customized definitions',async()=>{
 const h=harness(),from=new FinanceProperties(),to=mapped();await h.store.ensureStructure();h.contents.set('Accounts.base','custom base');const {journal}=await previewPropertyMigration(h.app,from,to,'');await applyPropertyMigration(h.app,journal);
 assert.equal(h.contents.get('Accounts.base'),'custom base');assert.equal(parse(h.contents.get('Transactions.base')).views[0].order[1],'custom date');h.plugin.settings.propertyNames=to.names;await h.store.ensureStructure();assert.ok(!h.files.has('Transactions (Atomic notes).base'));
});
test('settings expose every group, preserve existing actions, and explicitly ask migration or decline',()=>{
 const source=readFileSync('src/settings.ts','utf8');for(const label of ['Data & routing','Rules & budgets','Properties'])assert.ok(source.includes(`title: "${label}"`));for(const action of ['Configure in GCM','Save property names','Discard edits','Resume migration','Migrate and save','Save without migrating','Cancel'])assert.ok(source.includes(`"${action}"`));assert.match(source,/api\?\.ui\?\.openCustomPropertySettings/);assert.match(source,/PROPERTY_GROUPS\[this.propertyGroup\]/);assert.match(source,/aria-label/);assert.doesNotMatch(source,/createEl\("details"/);
 const properties=readFileSync('src/finance-properties.ts','utf8');assert.doesNotMatch(properties,/aliases\(/);assert.doesNotMatch(readFileSync('src/types.ts','utf8'),/propertyDraft|propertyGroup/);
});
function pluginHarness(h){
 const plugin=new FinancePlugin(h.app);plugin.settings={propertyNames:h.plugin.settings.propertyNames,propertyMigration:null,financeFolder:'',recordMode:'atomic-note',legacyTransactionDiscovery:'discover'};h.app.plugins.plugins['tps-finances']=plugin;
 let disk=structuredClone(plugin.settings),failAt=0,saves=0;plugin.settingsWriter={save:async settings=>{saves++;if(saves===failAt)throw Error('settings write failure');disk=structuredClone(settings)}};plugin.refreshDashboard=async()=>{};
 plugin.loadData=async()=>structuredClone(disk);
 return {plugin,disk:()=>disk,failSave:n=>failAt=n};
}
test('atomic-only activation reads fresh vault bodies once and persists only after a clean audit',async()=>{
 const h=harness(),p=pluginHarness(h);for(let n=0;n<200;n++)await h.app.vault.create(`Archive/${n}.md`,'Ordinary note');
 let fresh=0,cached=0;const read=h.app.vault.read,cachedRead=h.app.vault.cachedRead;
 h.app.vault.read=async file=>{fresh++;return read(file)};h.app.vault.cachedRead=async file=>{cached++;return cachedRead(file)};
 await p.plugin.setLegacyTransactionDiscovery('atomic-only');
 assert.equal(fresh,200);assert.equal(cached,0);assert.equal(p.disk().legacyTransactionDiscovery,'atomic-only');
 assert.equal(p.plugin.settings.legacyTransactionDiscovery,'atomic-only');
});
test('already-converted notes retain migration provenance without blocking atomic-only activation',async()=>{
 const h=harness(new FinanceProperties({keys:{migrationSource:'originalEntry'}}));
 const paths=await h.store.upsertAccounts([account]);
 const source=`- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[${paths.get('account1').replace(/\.md$/,'')}]]] [amount:: -2] [currency:: USD]`;
 await h.app.vault.create('Day.md',source);
 assert.deepEqual(await h.store.migrateLegacyTransactionLedgers(),{moved:1,skipped:0});
 assert.equal(h.fm('legacy.md').originalEntry,source,'provenance remains available for interrupted-conversion retries');
 assert.equal(h.contents.get('Day.md'),'- [[legacy]]');
 const p=pluginHarness(h); // A fresh plugin instance sees notes converted by an earlier version.
 assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:0,firstPath:''});
 await p.plugin.setLegacyTransactionDiscovery('atomic-only');
 assert.equal(p.disk().legacyTransactionDiscovery,'atomic-only');
 await p.plugin.setLegacyTransactionDiscovery('discover');
 await h.app.vault.create('Later.md',source.replace('legacy','later'));
 assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:1,firstPath:'Later.md'});
 await assert.rejects(p.plugin.setLegacyTransactionDiscovery('atomic-only'),/1 inline financeId marker remain; first file: Later\.md/);
});
test('audit preserves extra YAML, code and body markers beside valid migration provenance',async()=>{
 const source='- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 for(const extra of ['yaml','code','body']){
  const h=harness();
  const file=await h.add('Converted.md',{type:'transaction',financeId:'legacy',date:'2026-09-20',account:'[[Checking]]',amount:-2,migrationSource:source});
  if(extra==='yaml')await h.app.fileManager.processFrontMatter(file,raw=>{raw.example='[financeId:: extra]'});
  else h.contents.set(file.path,h.contents.get(file.path)+(extra==='code'?'```text\n[financeId:: extra]\n```\n':'[financeId:: extra]\n'));
  assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:1,firstPath:'Converted.md'},extra);
 }
});
test('encoded provenance cannot exempt a separate YAML comment marker',async()=>{
 const h=harness();
 const source='- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 const encoded=source.replace('[financeId::','\\u005bfinanceId::');
 await h.app.vault.create('Escaped.md',`---\ntype: transaction\nfinanceId: legacy\ndate: 2026-09-20\naccount: "[[Checking]]"\namount: -2\nmigrationSource: "${encoded}" # [financeId:: extra]\n---\n`);
 assert.equal(h.fm('Escaped.md').migrationSource,source);
 assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:1,firstPath:'Escaped.md'});
});
test('a previously converted folded YAML provenance value is exempt without editing it',async()=>{
 const h=harness();
 const source='- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 const content=`---\ntype: transaction\nfinanceId: legacy\ndate: 2026-09-20\naccount: "[[Checking]]"\namount: -2\nmigrationSource: >-\n  ${source}\n---\n`;
 await h.app.vault.create('Prior.md',content);
 assert.equal(h.fm('Prior.md').migrationSource,source);
 assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:0,firstPath:''});
 assert.equal(h.contents.get('Prior.md'),content);
});
test('audit does not exempt migration provenance on a malformed atomic transaction',async()=>{
 const h=harness();
 const source='- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 await h.add('Incomplete.md',{type:'transaction',financeId:'legacy',date:'bad-date',account:'[[Checking]]',amount:-2,migrationSource:source});
 assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:1,firstPath:'Incomplete.md'});
});
test('atomic-only activation blocks all raw financeId markers, even malformed, duplicated, or in YAML and code',async()=>{
 const h=harness(),p=pluginHarness(h);
 await h.app.vault.create('Day.md','- [financeId:: broken]\n- [financeId:: broken]');
 await h.app.vault.create('Frontmatter.md','---\nitems:\n  - "[financeId:: hidden]"\n---\n```\n[financeId:: example]\n```');
 assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:4,firstPath:'Day.md'});
 await assert.rejects(p.plugin.setLegacyTransactionDiscovery('atomic-only'),/4 inline financeId markers remain; first file: Day\.md/);
 assert.equal(p.plugin.settings.legacyTransactionDiscovery,'discover');assert.equal(p.disk().legacyTransactionDiscovery,'discover');
});
test('atomic-only activation refuses a vault changed during its fresh read',async()=>{
 const h=harness(),p=pluginHarness(h);const file=await h.app.vault.create('Journal.md','No markers');
 const read=h.app.vault.read;h.app.vault.read=async current=>{const content=await read(current);if(current===file)file.stat.mtime++;return content};
 await assert.rejects(p.plugin.setLegacyTransactionDiscovery('atomic-only'),/vault changed during transaction verification/);
 assert.equal(p.plugin.settings.legacyTransactionDiscovery,'discover');assert.equal(p.disk().legacyTransactionDiscovery,'discover');
});
test('an interrupted conversion cannot certify atomic-only discovery even when its atomic note exists',async()=>{
 const h=harness(),p=pluginHarness(h),paths=await h.store.upsertAccounts([account]);
 const source=`- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[${paths.get('account1').replace(/\.md$/,'')}]]] [amount:: -2] [currency:: USD]`;
 await h.app.vault.create('Day.md',source);h.fail('Day.md');
 await assert.rejects(h.store.migrateLegacyTransactionLedgers(),/disk failure/);
 assert.ok(h.app.vault.getMarkdownFiles().some(file=>h.fm(file.path).financeId==='legacy'));
 assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:1,firstPath:'Day.md'});
 await assert.rejects(p.plugin.setLegacyTransactionDiscovery('atomic-only'),/first file: Day\.md/);
 assert.equal(p.disk().legacyTransactionDiscovery,'discover');assert.equal(h.contents.get('Day.md'),source);
});
test('a failed settings save rolls back discovery, and switching to line records clears atomic-only discovery',async()=>{
 const h=harness(),p=pluginHarness(h);p.failSave(1);
 await assert.rejects(p.plugin.setLegacyTransactionDiscovery('atomic-only'),/settings write failure/);
 assert.equal(p.plugin.settings.legacyTransactionDiscovery,'discover');assert.equal(p.disk().legacyTransactionDiscovery,'discover');
 p.failSave(0);await p.plugin.setLegacyTransactionDiscovery('atomic-only');
 await p.plugin.setRecordMode('atomic-line');
 assert.equal(p.plugin.settings.legacyTransactionDiscovery,'discover');assert.equal(p.disk().legacyTransactionDiscovery,'discover');
 assert.equal(p.plugin.settings.recordMode,'atomic-line');
});
test('a failed record-format save preserves the previously certified atomic-only mode',async()=>{
 const h=harness(),p=pluginHarness(h);await h.store.ensureStructure();
 const base=h.contents.get('Transactions.base');
 await p.plugin.setLegacyTransactionDiscovery('atomic-only');p.failSave(2);
 await assert.rejects(p.plugin.setRecordMode('atomic-line'),/settings write failure/);
 assert.equal(p.plugin.settings.recordMode,'atomic-note');assert.equal(p.plugin.settings.legacyTransactionDiscovery,'atomic-only');
 assert.equal(p.disk().recordMode,'atomic-note');assert.equal(p.disk().legacyTransactionDiscovery,'atomic-only');
 assert.equal(h.contents.get('Transactions.base'),base,'a failed settings save does not alter the generated Base');
});
test('a later coalesced settings failure cannot roll back a discovery mode already saved to disk',async()=>{
 const h=harness(),p=pluginHarness(h);let disk=structuredClone(p.disk()),writes=0,later;
 let refreshes=0;p.plugin.refreshDashboard=async()=>{refreshes++};
 p.plugin.settingsWriter=new CoalescedSnapshotWriter({
  initialSnapshot:structuredClone(p.plugin.settings),
  readLatest:async()=>structuredClone(disk),
  writeMerged:async value=>{
   writes++;
   if(writes===1){
    disk=structuredClone(value);
    p.plugin.settings.enableLogging=true;
    later=p.plugin.saveSettings().then(()=>null,error=>error);
   }else throw Error('debug settings write failure');
  },
  normalize:value=>structuredClone(value),
  reconcile:(requested,persisted)=>{p.plugin.settings=reconcilePersistedSnapshot(p.plugin.settings,requested,persisted)},
 });
 p.plugin.loadData=async()=>structuredClone(disk);
 await assert.rejects(p.plugin.setLegacyTransactionDiscovery('atomic-only'),/debug settings write failure/);
 assert.match(String(await later),/debug settings write failure/);
 assert.equal(writes,2);assert.equal(disk.legacyTransactionDiscovery,'atomic-only');
 assert.equal(p.plugin.settings.legacyTransactionDiscovery,'atomic-only','memory follows persisted discovery after shared-cycle rejection');
 assert.equal(refreshes,1,'the visible dashboard adopts the already-persisted mode');
 setLoggingEnabled(false);
});
test('atomic-only dashboard and API ignore externally added inline entries until discovery is restored',async()=>{
 const h=harness(),p=pluginHarness(h),paths=await h.store.upsertAccounts([account]);
 await h.store.applyTransactions([tx],[],[],state,paths);
 p.plugin.getConnectedItems=()=>[];p.plugin.getRelayStatus=()=>null;p.plugin.getPlaidSetupStatus=()=>({state:'ready'});
 await p.plugin.setLegacyTransactionDiscovery('atomic-only');
 assert.equal(p.plugin.createStore().legacyDiscovery,'atomic-only');
 const source=`- Old purchase [type:: transaction] [financeId:: later] [date:: 2026-09-20] [account:: [[${paths.get('account1').replace(/\.md$/,'')}]]] [amount:: -2] [currency:: USD]`;
 await h.app.vault.create('Day.md',source);
 const reads=[];const cachedRead=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads.push(file.path);return cachedRead(file)};
 const store=p.plugin.createStore();
 assert.deepEqual((await store.readTransactionRecords()).map(t=>t.path),['tx1.md']);
 assert.ok(!reads.includes('Day.md'),'atomic source API skips the legacy transaction scan');
 reads.length=0;assert.deepEqual((await store.readTransactionRecords('metadata')).map(t=>t.path),['tx1.md']);
 assert.ok(!reads.includes('Day.md'),'atomic display skips the legacy transaction scan');
 reads.length=0;const atomic=await p.plugin.getDashboardModel();assert.deepEqual(atomic.transactions.map(t=>t.financeId),['tx1']);
 assert.ok(reads.includes('Day.md'),'an independent root-folder budget reader still inspects ambiguous files');
 const indexed=await p.plugin.getDashboardModel(new Set(),'metadata');assert.deepEqual(indexed.transactions.map(t=>t.financeId),['tx1']);
 await p.plugin.setLegacyTransactionDiscovery('discover');
 const restored=await p.plugin.getDashboardModel();assert.deepEqual(restored.transactions.map(t=>t.financeId).sort(),['later','tx1']);
 reads.length=0;await p.plugin.createStore().readTransactionRecords();assert.ok(reads.includes('Day.md'));
});
test('saving with migration renames first, then commits settings; no previous names are retained',async()=>{
 const h=harness(),p=pluginHarness(h),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'transactionType'}});await h.add('A.md',{financeId:'a',type:'transaction',amount:-4});
 await p.plugin.changePropertyNames(from,to,true);assert.equal(h.fm('A.md').transactionType,'transaction');assert.ok(!('type' in h.fm('A.md')));assert.deepEqual(p.disk().propertyNames,to.names);assert.equal(p.disk().propertyMigration,null);assert.ok(!('previous' in p.disk().propertyNames));
});
test('declining migration saves strict new names without touching old note values',async()=>{
 const h=harness(),p=pluginHarness(h),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'transactionType'}});await h.add('A.md',{financeId:'a',type:'transaction',amount:-4});const before=h.contents.get('A.md');
 await p.plugin.changePropertyNames(from,to,false);assert.equal(h.contents.get('A.md'),before);assert.equal(financeProperties(h.app).read(h.fm('A.md')).type,undefined);assert.equal((await h.store.readTransactionRecords()).length,0);assert.deepEqual(p.disk().propertyNames,to.names);
});
test('journal is durable before writes; initial settings failure leaves all notes unchanged',async()=>{
 const h=harness(),p=pluginHarness(h),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'transactionType'}});await h.add('A.md',{financeId:'a',type:'transaction'});const before=h.contents.get('A.md');p.failSave(1);await assert.rejects(p.plugin.changePropertyNames(from,to,true),/settings write failure/);assert.equal(h.contents.get('A.md'),before);assert.equal(p.plugin.settings.propertyMigration,null);
});
test('final settings failure leaves a resumable journal and blocks provider syncing',async()=>{
 const h=harness(),p=pluginHarness(h),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'transactionType'}});await h.add('A.md',{financeId:'a',type:'transaction'});p.failSave(2);await assert.rejects(p.plugin.changePropertyNames(from,to,true),/settings write failure/);assert.equal(h.fm('A.md').transactionType,'transaction');assert.ok(p.disk().propertyMigration);assert.deepEqual(p.plugin.settings.propertyNames,from.names);await assert.rejects(p.plugin.syncAll('test'),/Resume/);
 await p.plugin.resumePropertyMigration();assert.equal(p.disk().propertyMigration,null);assert.deepEqual(p.disk().propertyNames,to.names);assert.ok(!('type' in h.fm('A.md')));
});
test('a newer saved mapping invalidates an older settings confirmation',async()=>{
 const h=harness(),p=pluginHarness(h);p.plugin.settings.propertyNames={keys:{type:'newType'}};await assert.rejects(p.plugin.changePropertyNames(new FinanceProperties(),mapped(),true),/settings changed/);assert.deepEqual(p.disk().propertyNames,{keys:{}});
});
test('concurrent destination edits are checked within the atomic frontmatter mutation',async()=>{
 const h=harness(),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'transactionType'}});await h.add('A.md',{financeId:'a',type:'transaction'});const {journal}=await previewPropertyMigration(h.app,from,to,'');const process=h.app.fileManager.processFrontMatter;
 h.app.fileManager.processFrontMatter=async(f,fn)=>{await process(f,raw=>{raw.transactionType='new edit'});return process(f,fn)};
 await assert.rejects(applyPropertyMigration(h.app,journal),/different value/);assert.equal(h.fm('A.md').type,'transaction');assert.equal(h.fm('A.md').transactionType,'new edit');
});
test('resuming rechecks the current GCM identity key before changing notes',async()=>{
 const h=harness(),p=pluginHarness(h),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'transactionType'}});await h.add('A.md',{financeId:'a',type:'transaction'});const {journal}=await previewPropertyMigration(h.app,from,to,'');p.plugin.settings.propertyMigration=journal;h.app.plugins.plugins['tps-global-context-menu']={settings:{nativeRecordIdentityPropertyKey:'transactionType'}};
 await assert.rejects(p.plugin.resumePropertyMigration(),/identity property/);assert.equal(h.fm('A.md').type,'transaction');assert.ok(!('transactionType' in h.fm('A.md')));
});
test('unindexed malformed finance notes are reported instead of silently omitted from migration',async()=>{
 const h=harness();await h.app.vault.create('Bad.md','---\nfinanceId: b\ntype: [invalid\n---\n');h.app.metadataCache.getFileCache=()=>null;const result=await previewPropertyMigration(h.app,new FinanceProperties(),mapped(),'');assert.match(result.conflicts[0],/Invalid frontmatter/);
});
test('a stale metadata cache cannot hide a newly created finance record from the preview',async()=>{
 const h=harness();await h.add('New.md',{financeId:'new',type:'transaction'});h.app.metadataCache.getFileCache=()=>({frontmatter:{kind:'ordinary'}});const result=await previewPropertyMigration(h.app,new FinanceProperties(),mapped(),'');assert.deepEqual(result.journal.notes.map(n=>n.path),['New.md']);
});
test('collision checks distinguish YAML null and non-finite values and compare nested values without key-order sensitivity',()=>{
 const from=new FinanceProperties(),to=new FinanceProperties({keys:{amount:'total',tags:'labels'}});
 for(const value of [NaN,Infinity,-Infinity]){const raw={amount:value,total:null};assert.throws(()=>migrateProperties(raw,from,to),/different value/);assert.equal(raw.total,null);assert.ok(Object.is(raw.amount,value));}
 const raw={tags:[{a:1,b:false}],labels:[{b:false,a:1}]};migrateProperties(raw,from,to);assert.ok(!('tags' in raw));assert.deepEqual(raw.labels,[{a:1,b:false}]);
});

test('GCM kind classifications cover account creation, transaction import/update, manual cash and generated account filters',async()=>{
 const defs={account:{parentKind:'entity',key:'entityKind',value:'account'},'finance-transaction':{parentKind:'transaction',key:'transactionKind',value:'financial'},'investment-transaction':{parentKind:'transaction',key:'transactionKind',value:'investment'},holding:{parentKind:'entity',key:'entityKind',value:'holding'}};
 const codec={definition:k=>defs[k]||null,encode:f=>{const d=defs[f.kind];return d?{...f,kind:d.parentKind,[d.key]:d.value}:{...f}},decode:f=>{const entry=Object.entries(defs).find(([,d])=>f.kind===d.parentKind&&f[d.key]===d.value);if(!entry)return {...f};const result={...f,kind:entry[0]};delete result[entry[1].key];return result}};
 const h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{frontmatterKinds:codec}};
 const paths=await h.store.upsertAccounts([account]);assert.equal(h.fm(paths.get('account1')).kind,'entity');assert.equal(h.fm(paths.get('account1')).entityKind,'account');
 await h.store.applyTransactions([tx],[],[],structuredClone(state),paths);
 assert.equal(h.fm('tx1.md').kind,'transaction');assert.equal(h.fm('tx1.md').transactionKind,'financial');
 await h.store.applyTransactions([],[{...tx,amount:-9}],[],structuredClone(state),paths);
 assert.equal(h.fm('tx1.md').transactionKind,'financial');assert.equal((await h.store.readTransactionRecords()).length,1);
 const cash=await h.manual.createAccount({kind:'cash',name:'Wallet',currency:'USD',value:20,valuationDate:'2026-09-26',purchaseTransaction:'',liabilityAccount:'',assetType:''});assert.equal(h.fm(cash.path).entityKind,'account');
 const props=financeProperties(h.app);
 assert.deepEqual(props.read(props.write({kind:'investmentTransaction',type:'investmentTransaction',amount:7})),{kind:'investmentTransaction',type:'investmentTransaction',amount:7});
 const dotted=new FinanceProperties({keys:{kind:'recordKind'}},codec).base('filters:\n  and:\n    - note.kind == "account"\nviews: []\n');assert.doesNotMatch(dotted,/note\.\(/);assert.match(dotted,/recordKind/);
 const base=new FinanceProperties(undefined,codec).base('filters:\n  and:\n    - kind == "account"\nviews: []\n');assert.match(base,/entityKind/);assert.match(base,/entity/);
});

test('tag mappings support finance import, repeat updates and generated Base predicates',async()=>{
 const tags={account:'accounts', 'finance-transaction':'kind/financial/transaction'};
 const codec={definition:k=>tags[k]?{tag:tags[k]}:null,encode:f=>{if(!tags[f.kind])return {...f};const out={...f,tags:[...new Set([...(f.tags||[]),tags[f.kind]])]};delete out.kind;return out;},decode:f=>({...f,...(Object.entries(tags).find(([,tag])=>f.tags?.includes(tag))?{kind:Object.entries(tags).find(([,tag])=>f.tags?.includes(tag))[0]}:{})})};
 const h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{frontmatterKinds:codec}};
 const paths=await h.store.upsertAccounts([account]);assert.equal(h.fm(paths.get('account1')).kind,undefined);assert.ok(h.fm(paths.get('account1')).tags.includes('accounts'));
 await h.store.applyTransactions([tx],[],[],structuredClone(state),paths);
 await h.store.applyTransactions([],[{...tx,amount:-9}],[],structuredClone(state),paths);
 assert.equal(h.fm('tx1.md').kind,undefined);assert.equal((await h.store.readTransactionRecords()).length,1);assert.deepEqual(await h.store.readTransactionRecords('metadata'),await h.store.readTransactionRecords());
 const base=financeProperties(h.app).base('filters:\n  and:\n    - kind == "transaction"\n    - note.kind != "account"\nviews: []\n');
 assert.match(base,/file\.hasTag\("kind\/financial\/transaction"\)/);assert.match(base,/!file\.hasTag\("accounts"\)/);assert.doesNotMatch(base,/undefined/);
});
test('classification change previews only exact generated Bases and leaves customized Bases alone',async()=>{
 const h=harness();
 const definitions={account:{tag:'kind/finance/account'}};
 h.app.plugins.plugins['tps-global-context-menu']={api:{frontmatterKinds:{definition:k=>definitions[k]||null,encode:f=>f,decode:f=>f}}};
 await h.store.ensureStructure();
 assert.match(h.contents.get('Accounts.base'),/file\.hasTag\("kind\/finance\/account"\)/);
 h.contents.set('Transactions.base','user-authored Base');
 const changes=await previewGeneratedBaseClassificationChange(h.app,'',{recordKind:'account',from:definitions.account,to:{parentKind:'entity',key:'entityKind',value:'account'}});
 const account=changes.find(change=>change.path==='Accounts.base');
 assert.ok(account);assert.equal(account.before,h.contents.get('Accounts.base'));
 assert.match(account.after,/entityKind/);assert.doesNotMatch(account.after,/file\.hasTag\("kind\/finance\/account"\)/);
 assert.ok(!changes.some(change=>change.path==='Transactions.base'));
 assert.equal(h.contents.get('Transactions.base'),'user-authored Base');
});
test('finance classification rejects subkind keys owned by finance fields or record IDs',async()=>{
 const h=harness(new FinanceProperties({keys:{amount:'totalAmount'}}));
 const from={tag:'kind/finance/transaction'};
 h.app.plugins.plugins['tps-global-context-menu']={settings:{nativeRecordIdentityPropertyKey:'recordId'},api:{frontmatterKinds:{definition:k=>k==='finance-transaction'?from:null,encode:f=>f,decode:f=>f}}};
 const change=key=>({recordKind:'finance-transaction',from,to:{parentKind:'transaction',key,value:'financial'}});
 for(const key of ['AMOUNT','totalamount','FINANCEID','financeaccountid','FINANCEBUDGETID','FINANCERULEID','SECURITYID','recordID','TPSID']){
  await assert.rejects(previewGeneratedBaseClassificationChange(h.app,'',change(key)),/conflicts with a Finance field or record ID/,key);
 }
 assert.deepEqual(await previewGeneratedBaseClassificationChange(h.app,'',change('transactionKind')),[]);
 assert.deepEqual(await previewGeneratedBaseClassificationChange(h.app,'',{...change('AMOUNT'),recordKind:'other'}),[]);
});


test('dashboard collects exact contributing paths during existing reads, including mapped and legacy records',async()=>{
 for(const properties of [new FinanceProperties(),mapped()]){
  const h=harness(properties),paths=await h.store.upsertAccounts([account]);await h.store.applyTransactions([tx],[],[],state,paths);await h.store.writeSnapshot([account],[holding],paths,new Date('2026-09-20T12:00:00Z'));
  const ledger=new FinanceStore(h.app,'');const snapshot=await ledger.writeSnapshot([],[],new Map(),new Date('2026-09-20T12:00:00Z'));
  await h.store.createRule({id:'rule',name:'Rule',enabled:true,priority:1,accountContains:'',nameContains:'Coffee',merchantContains:'',minAmount:null,maxAmount:null,category:'Food',tags:[]});await h.store.createBudget({id:'budget',name:'Budget',category:'Food',monthlyLimit:100});
  await h.app.vault.create('Journal.md',`- Old [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[${paths.get('account1').slice(0,-3)}]]] [amount:: -2] [currency:: USD]`);await h.add('Unrelated.md',{title:'Unrelated'});
  const p=new FinancePlugin(h.app);p.settings={...h.plugin.settings,financeFolder:'',recordMode:'atomic-note'};p.getConnectedItems=()=>[];p.getRelayStatus=()=>null;p.getPlaidSetupStatus=()=>({state:'ready'});
  let reads=0,scans=0;const read=h.app.vault.cachedRead,list=h.app.vault.getMarkdownFiles;h.app.vault.cachedRead=async f=>{reads++;return read(f)};h.app.vault.getMarkdownFiles=()=>{scans++;return list()};
  const without=await p.getDashboardModel(),baseline={reads,scans};reads=0;scans=0;const sources=new Set(),withSources=await p.getDashboardModel(sources);assert.deepEqual(withSources,without);assert.deepEqual({reads,scans},baseline,'dependency collection adds no I/O');
  const expected=h.app.vault.getMarkdownFiles().map(f=>f.path).filter(path=>path!=='Unrelated.md');assert.deepEqual([...sources].sort(),expected.sort());assert.ok(sources.has(snapshot));assert.ok(sources.has('Journal.md'));
 }
});

test('indexed dashboard preserves mapped results while default API remains source-backed',async()=>{
 for(const properties of [new FinanceProperties(),mapped()]){
  const h=harness(properties),paths=await h.store.upsertAccounts([account]);await h.store.applyTransactions([tx],[],[],state,paths);
  const p=new FinancePlugin(h.app);p.settings={...h.plugin.settings,financeFolder:'',recordMode:'atomic-note'};p.getConnectedItems=()=>[];p.getRelayStatus=()=>null;p.getPlaidSetupStatus=()=>({state:'ready'});
  let reads=0;const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async f=>{reads++;return read(f);};
  const current=await p.getDashboardModel(),sourceReads=reads;reads=0;const sources=new Set(),indexed=await p.getDashboardModel(sources,'metadata');
  assert.deepEqual(indexed,current);assert.equal(reads,sourceReads-1);assert.ok(sources.has('tx1.md'));assert.ok(sources.has(paths.get('account1')));
 }
});
