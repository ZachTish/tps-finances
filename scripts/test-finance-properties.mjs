import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse, stringify} from 'yaml';
import {readFileSync} from 'node:fs';
class File {constructor(path){this.path=path;this.basename=path.split('/').at(-1).replace(/\.md$/,'');this.extension=path.split('.').at(-1);this.stat={mtime:1,size:0};}}
globalThis.PropertyQA={File,parse,stringify};
const output=await build({stdin:{contents:['finance-properties','property-migration','atomic-finance-store','manual-finance','finance-store','settings-persistence'].map(name=>`export * from './src/${name}.ts';`).join('\n')+`\nexport {default as FinancePlugin} from './src/main.ts';\nexport {setLoggingEnabled} from './src/logger.ts';`,resolveDir:process.cwd()},bundle:true,write:false,external:['electron'],platform:'node',format:'esm',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export class Plugin{constructor(app){this.app=app}};export class PluginSettingTab{};export class ButtonComponent{};export class Modal{open(){globalThis.PropertyQAModal=this}};export class Setting{};export class Notice{};export class SecretComponent{};export class ItemView{};export class Menu{};export class WorkspaceLeaf{};export const setIcon=()=>{};export const Platform={isDesktopApp:true};export const requestUrl=()=>{throw Error("Unexpected provider request")};export class App{};export const TFile=globalThis.PropertyQA.File;export const normalizePath=s=>s;export const parseYaml=globalThis.PropertyQA.parse;export const stringifyYaml=globalThis.PropertyQA.stringify;`}));}}]});
const {FinancePlugin,FinanceProperties,financeProperties,financeKindCodec,FINANCE_PROPERTY_KEYS,PROPERTY_GROUPS,normalizePropertyNames,propertyChanges,migrateProperties,previewPropertyMigration,previewGeneratedBaseClassificationChange,applyPropertyMigration,normalizePropertyMigration,AtomicFinanceStore,ManualFinanceStore,FinanceStore,auditLegacyTransactionMarkers,CoalescedSnapshotWriter,reconcilePersistedSnapshot,setLoggingEnabled,atomicBase,accountsBaseBody,transactionsBaseBody}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
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

function configurePrimaryIdentity(h, key='recordId', kinds) {
 h.app.plugins.plugins['tps-global-context-menu']={
  settings:{nativeRecordIdentityPropertyKey:'misleadingSavedKey'},
  api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:key})},...(kinds?{frontmatterKinds:kinds}:{})},
 };
 return financeProperties(h.app);
}

test('identity and field names cannot overwrite classification or caseless legacy ID aliases',()=>{
 for(const key of ['FinanceId','FinanceAccountID','TPSID','SecurityID'])assert.throws(()=>new FinanceProperties({keys:{merchant:key}}),/property name/);
 assert.throws(()=>new FinanceProperties({keys:{merchant:'LABEL',title:'label'}}),/already used/);
 for(const definition of [{kindList:{key:'recordId',value:'transaction/money'}},{scalar:{key:'RECORDID',value:'money'}},{parentKind:'transaction',key:'recordId',value:'money'}]){
  const kinds={version:2,definition:()=>definition,propertyKey:()=>null,decode:f=>f,encode:f=>f};
  assert.throws(()=>new FinanceProperties(undefined,kinds,'recordId'),/identity property/);
 }
});

test('configured primary identity replaces only each Finance record own ID, retaining foreign keys',()=>{
 const properties=new FinanceProperties(undefined,undefined,'recordId');
 for(const [kind,ownId] of [['account','financeAccountId'],['transaction','financeId'],['investmentTransaction','financeId'],['financeRule','financeRuleId'],['financeBudget','financeBudgetId']]){
  const fields={kind,[ownId]:`own-${kind}`,title:'Keep title',custom:false,...(ownId!=='financeAccountId'?{financeAccountId:'account-foreign'}:{})};
  const raw=properties.write(fields);
  assert.equal(raw.recordId,fields[ownId],kind);
  assert.ok(!(ownId in raw),`${kind} must not duplicate its primary ID`);
  assert.equal(raw.tpsId,undefined);
  const decoded=properties.read(raw);assert.equal(decoded[ownId],fields[ownId]);
  if(ownId!=='financeAccountId'){assert.equal(raw.financeAccountId,'account-foreign');assert.equal(decoded.financeAccountId,'account-foreign');}
  assert.equal(raw.custom,false);
 }
 const holding=properties.write({kind:'holding',type:'holding',recordId:'holding-own',financeAccountId:'account-foreign',securityId:'security-foreign'});
 assert.equal(holding.recordId,'holding-own');assert.equal(holding.financeAccountId,'account-foreign');assert.equal(holding.securityId,'security-foreign');
});

test('existing legacy IDs stay legacy while equal primary duplicates converge and conflicts fail closed',()=>{
 const properties=new FinanceProperties(undefined,undefined,'recordId');
 for(const [kind,ownId] of [['account','financeAccountId'],['transaction','financeId'],['investmentTransaction','financeId'],['financeRule','financeRuleId'],['financeBudget','financeBudgetId']]){
  const legacy={kind,[ownId]:'legacy-own',custom:'Keep'};
  assert.equal(properties.read(legacy)[ownId],'legacy-own');assert.deepEqual(legacy,{kind,[ownId]:'legacy-own',custom:'Keep'},'read is not remediation');
  properties.mutate(legacy,fields=>{fields.title='Edited legacy'});
  assert.deepEqual(legacy,{kind,[ownId]:'legacy-own',custom:'Keep',title:'Edited legacy'},'an ordinary edit cannot adopt a legacy ID');
  const equal={...legacy,recordId:'legacy-own'};properties.mutate(equal,fields=>{fields.title='Edited'});
  assert.equal(equal.recordId,'legacy-own');assert.ok(!(ownId in equal));assert.equal(equal.custom,'Keep');
  const conflicting={...legacy,recordId:'different'},before=structuredClone(conflicting);
  assert.throws(()=>properties.read(conflicting),/identity|identifier|conflict/i,kind);
  assert.throws(()=>properties.mutate(conflicting,fields=>{fields.title='Must not save'}),/identity|identifier|conflict/i,kind);
  assert.deepEqual(conflicting,before);
 }
 for(const reserved of ['financeId','financeAccountId','financeBudgetId','financeRuleId','securityId'])assert.throws(()=>new FinanceProperties(undefined,undefined,reserved),/identity property/);
});

test('existing identities cannot be retargeted or created through Finance edits',()=>{
 const properties=new FinanceProperties(undefined,undefined,'recordId');
 for(const [kind,ownId] of [['account','financeAccountId'],['transaction','financeId'],['investmentTransaction','financeId'],['financeRule','financeRuleId'],['financeBudget','financeBudgetId']]){
  for(const original of [{kind,[ownId]:'owned'},{kind,recordId:'owned'}]){
   const before=structuredClone(original);
   assert.throws(()=>properties.mutate(original,fields=>{fields[ownId]='retargeted'}),/identity changed/);assert.deepEqual(original,before);
   assert.throws(()=>properties.write({kind,[ownId]:'retargeted'},original),/identity changed/);assert.deepEqual(original,before);
   properties.mutate(original,fields=>{delete fields[ownId];fields.title='Keep owner'});
   assert.equal(original[ownId]||original.recordId,'owned','omitting an identity from an edit does not remove it');
   assert.equal(Object.keys(original).filter(key=>[ownId,'recordId'].includes(key)).length,1);
  }
  for(const assignment of [ownId,'recordId']){
   const identityless={kind,title:'Existing note',custom:'Keep'},before=structuredClone(identityless);
   assert.throws(()=>properties.mutate(identityless,fields=>{fields[assignment]='newly-claimed'}),/identity is missing/);assert.deepEqual(identityless,before);
   assert.throws(()=>properties.write({kind,[assignment]:'newly-claimed'},identityless),/identity is missing/);
  }
  const physicalKey=ownId.toUpperCase(),raw={kind,[physicalKey]:'legacy-case',custom:'Keep'};
  properties.mutate(raw,fields=>{fields.title='Edited';fields.recordId='legacy-case'});
  assert.deepEqual(raw,{kind,[physicalKey]:'legacy-case',custom:'Keep',title:'Edited'},'equal supplied primary ID does not adopt or rename the legacy key');
 }
 for(const kind of ['holding','ledger']){
  const identityless={kind,financeAccountId:'foreign-account',securityId:'foreign-security'},before=structuredClone(identityless);
  assert.throws(()=>properties.mutate(identityless,fields=>{fields.recordId='newly-claimed'}),/identity is missing/);assert.deepEqual(identityless,before);
  const primary={...identityless,recordId:'existing-primary'};properties.mutate(primary,fields=>{delete fields.recordId;fields.title='Edit'});
  assert.equal(primary.recordId,'existing-primary');assert.equal(primary.financeAccountId,'foreign-account');assert.equal(primary.securityId,'foreign-security');
  const casePrimary={...identityless,RECORDID:'case-primary'};properties.mutate(casePrimary,fields=>{fields.title='Edit'});
  assert.equal(casePrimary.RECORDID,'case-primary');assert.equal(casePrimary.recordId,undefined,'a generic record retains its authored primary-key spelling');
 }
});

test('generated own-ID presence filters retain legacy-only visibility without expanding foreign keys',()=>{
 const properties=new FinanceProperties(undefined,undefined,'recordId');
 for(const [kind,self] of [['account','financeAccountId'],['transaction','financeId'],['financeRule','financeRuleId'],['financeBudget','financeBudgetId']]){
  const source=stringify({filters:{and:[`kind == "${kind}"`,`${self} != null`]},views:[{type:'table',name:'Generated'}]});
  const result=properties.base(source),predicate=parse(result).filters.and[1];
  assert.equal(predicate,`(note["recordId"] != null || note["${self}"] != null)`);
  const matches=new Function('note',`return ${predicate};`);
  assert.equal(matches({recordId:'primary'}),true);assert.equal(matches({[self]:'legacy'}),true);assert.equal(matches({}),false);
  assert.equal(properties.base(result),result,'quoted legacy references are not remapped on a second generated pass');
 }
 for(const kind of ['transaction','holding']){
  const source=stringify({filters:{and:[`kind == "${kind}"`,'financeAccountId != null','securityId != null']},views:[{type:'table',name:'Generated'}]});
  assert.deepEqual(parse(properties.base(source)).filters.and,[`kind == "${kind}"`,'financeAccountId != null','securityId != null']);
 }
});

test('the native storage profile owns identity even when saved GCM settings disagree',()=>{
 const h=harness(),properties=configurePrimaryIdentity(h);
 const raw=properties.write({kind:'transaction',type:'transaction',financeId:'profile-owned',financeAccountId:'account-foreign'});
 assert.equal(raw.recordId,'profile-owned');assert.equal(raw.financeId,undefined);assert.equal(raw.misleadingSavedKey,undefined);
 assert.equal(properties.read(raw).financeId,'profile-owned');
});

test('property rename migration guards the configured primary identity at the current source boundary',async()=>{
 const h=harness();configurePrimaryIdentity(h);
 await h.add('A.md',{kind:'transaction',recordId:'original',amount:-5});
 const from=new FinanceProperties(),to=new FinanceProperties({keys:{amount:'total'}});
 const {journal}=await previewPropertyMigration(h.app,from,to,'');assert.equal(journal.identityKey,'recordId');
 const process=h.app.fileManager.processFrontMatter;
 h.app.fileManager.processFrontMatter=async(file,mutate)=>{
  await process(file,raw=>{raw.recordId='reidentified'});
  return process(file,mutate);
 };
 await assert.rejects(applyPropertyMigration(h.app,journal),/changed identity/);
 assert.equal(h.fm('A.md').recordId,'reidentified');assert.equal(h.fm('A.md').amount,-5);assert.equal(h.fm('A.md').total,undefined);
});

test('property rename migration rejects a changed configured identity key before any writes',async()=>{
 const h=harness();configurePrimaryIdentity(h);
 await h.add('A.md',{kind:'transaction',recordId:'original',amount:-5});
 const {journal}=await previewPropertyMigration(h.app,new FinanceProperties(),new FinanceProperties({keys:{amount:'total'}}),'');
 configurePrimaryIdentity(h,'newId');const before=h.contents.get('A.md');
 await assert.rejects(applyPropertyMigration(h.app,journal),/identity configuration changed/);
 assert.equal(h.contents.get('A.md'),before);
});

test('primary identity rejects malformed values and case duplicates without editing the note',()=>{
 const properties=new FinanceProperties(undefined,undefined,'recordId');
 for(const value of [0,true,['id'],'',' id '])assert.throws(()=>properties.read({kind:'transaction',recordId:value}),/identity property/);
 const raw={kind:'transaction',RecordID:'case-owned',FINANCEID:'case-owned',financeAccountId:'foreign',bodyMarker:'Keep'};
 assert.equal(properties.read(raw).financeId,'case-owned');properties.mutate(raw,fields=>{fields.title='Edit'});
 assert.deepEqual(raw,{kind:'transaction',recordId:'case-owned',financeAccountId:'foreign',bodyMarker:'Keep',title:'Edit'});
 const duplicate={kind:'transaction',recordId:'same',RecordID:'same'};assert.throws(()=>properties.read(duplicate),/Duplicate Finance identity/);assert.deepEqual(duplicate,{kind:'transaction',recordId:'same',RecordID:'same'});
});

test('an unavailable or non-property GCM storage profile blocks Finance rather than choosing saved settings',()=>{
 const h=harness();
 h.app.plugins.plugins['tps-global-context-menu']={settings:{nativeRecordIdentityPropertyKey:'recordId'}};
 assert.throws(()=>financeProperties(h.app),/Global Context Menu/);
 h.app.plugins.plugins['tps-global-context-menu'].api={nativeRecords:{getStorageProfile:()=>({identityMode:'body',identityPropertyKey:'recordId'})}};
 assert.throws(()=>financeProperties(h.app),/shared identity property/);assert.equal(h.files.size,0);
});

test('account import rejects unavailable GCM authority and repeatedly reuses its arbitrarily named kind-list account',async()=>{
 const h=harness(),kinds=configurableListCodec();kinds.setListKey('kind');kinds.configure('account','entity/account');
 configurePrimaryIdentity(h,'tpsId',kinds);
 const path='Inbox/An independently renamed account.md',body='Keep this account body exactly.\n';
 await h.add(path,{kind:['entity/account'],tpsId:account.financeAccountId,financeAccountId:account.financeAccountId,title:'My account',accountName:account.name,accountType:account.type,currency:account.currency},body);
 const original=h.contents.get(path);let creates=0,writes=0;
 const create=h.app.vault.create,process=h.app.fileManager.processFrontMatter;
 h.app.vault.create=async(...args)=>{creates++;return create(...args);};
 h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args);};
 delete h.app.plugins.plugins['tps-global-context-menu'].api;
 await assert.rejects(h.store.upsertAccounts([account]),/Global Context Menu/);
 assert.equal(creates,0);assert.equal(writes,0);assert.equal(h.contents.get(path),original);
 configurePrimaryIdentity(h,'tpsId',kinds);
 for(let attempt=0;attempt<5;attempt++){
  const paths=await h.store.upsertAccounts([{...account,current:account.current+attempt}]);
  assert.equal(paths.get(account.financeAccountId),path);
 }
 assert.equal(creates,0);assert.equal(writes,5);assert.deepEqual(h.app.vault.getMarkdownFiles().map(file=>file.path),[path]);
 assert.equal(h.fm(path).tpsId,account.financeAccountId);assert.deepEqual(h.fm(path).kind,['entity/account']);
 assert.equal(h.fm(path).current,account.current+4);assert.ok(h.contents.get(path).endsWith(body));
});

test('primary-only kind-list records remain visible at root and same-mtime identity changes are current',async()=>{
 const h=harness(),kinds=configurableListCodec();configurePrimaryIdentity(h,'recordId',kinds);
 const file=await h.add('Inbox/Readable title.md',{recordId:'first',classifications:['transaction/money'],when:'2026-09-20',account:'[[Checking]]',financeAccountId:'account-foreign',amount:-5,currency:'USD'});
 for(let index=0;index<1000;index++)await h.add(`Other/${index}.md`,{title:`Ordinary ${index}`});
 let reads=0,writes=0,scans=0;const read=h.app.vault.cachedRead,process=h.app.fileManager.processFrontMatter,list=h.app.vault.getMarkdownFiles;
 h.app.vault.cachedRead=async target=>{reads++;return read(target)};
 h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args)};
 h.app.vault.getMarkdownFiles=()=>{scans++;return list()};
 for(let index=0;index<20;index++){
  const rows=await h.store.readTransactionRecords('metadata');assert.deepEqual(rows.map(row=>parseLineId(row.line)),['first']);
 }
 assert.equal(reads,0);assert.equal(writes,0);assert.equal(scans,20,'reuse existing per-request inventory, without another scan');
 const oldStats={...file.stat};await process(file,raw=>{raw.recordId='other'});Object.assign(file.stat,oldStats);
 assert.deepEqual((await h.store.readTransactionRecords('metadata')).map(row=>parseLineId(row.line)),['other']);
 assert.equal(reads,0);assert.equal(writes,0);
 const content=h.contents.get(file.path);h.files.delete(file.path);h.contents.delete(file.path);file.path='Inbox/Renamed.md';file.basename='Renamed';h.files.set(file.path,file);h.contents.set(file.path,content);
 const renamed=await h.store.readTransactionRecords('metadata');assert.deepEqual(renamed.map(row=>[parseLineId(row.line),row.path]),[['other','Inbox/Renamed.md']]);assert.equal(renamed[0].sourceFile,file);
 h.files.delete(file.path);h.contents.delete(file.path);assert.deepEqual(await h.store.readTransactionRecords('metadata'),[]);
 const replacement=await h.add('Inbox/Renamed.md',{recordId:'replacement',classifications:['transaction/money'],when:'2026-09-20',account:'[[Checking]]',financeAccountId:'account-foreign',amount:-9,currency:'USD'});
 const current=await h.store.readTransactionRecords('metadata');assert.equal(parseLineId(current[0].line),'replacement');assert.equal(current[0].sourceFile,replacement);assert.notEqual(current[0].sourceFile,file);
 assert.equal(reads,0);assert.equal(writes,0,'rename/delete/display never canonicalizes source');
});

function parseLineId(line){return /\[financeId::\s*([^\]]+)\]/.exec(line)?.[1]?.trim();}

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
 assert.throws(()=>normalizePropertyNames({keys:{currency:null}}),/Choose a plain, nonempty property name/);
});
test('explicit canonical property names survive normalization without changing note or Base behavior',()=>{
 const keys=Object.fromEntries(FINANCE_PROPERTY_KEYS.map(key=>[key,key]));
 assert.deepEqual(normalizePropertyNames({keys}),{keys});
 const properties=new FinanceProperties({keys});
 assert.deepEqual(properties.names,{keys});
 assert.equal(properties.customized,false);
 assert.deepEqual(propertyChanges(new FinanceProperties(),properties),[]);
 const note='---\nkind: account\ncurrency: USD\n---\nPersonal body\n';
 assert.equal(properties.note(note),note);
 const base='filters:\n  and:\n    - kind == "account"\nviews: []\n';
 assert.equal(properties.base(base),base);
 const changed=new FinanceProperties({keys:{...keys,amount:'total'}});
 assert.equal(changed.customized,true);
 assert.deepEqual(propertyChanges(properties,changed),[{from:'amount',to:'total'}]);
 assert.equal(changed.read(changed.write({amount:0,currency:'USD'})).amount,0);
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
 assert.equal(h.fm(file.path)['custom amount'],-5);assert.equal(h.fm(file.path)['custom type'],'transaction');assert.ok(h.fm(file.path).tpsId);assert.equal((await h.store.readTransactionRecords()).length,1);
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
 const p=mapped(),base=parse(p.base(atomicBase('','Holdings')));assert.match(base.filters.and[0],/note\["custom kind"\]/);assert.doesNotMatch(base.filters.and[0],/if\(/);assert.equal(base.views[0].order[1],'custom account');assert.equal(base.views[0].sort[0].property,'custom value');
 const transactions=parse(p.base(atomicBase('','Transactions')));assert.match(transactions.filters.and[0],/custom kind/);assert.match(transactions.filters.and[0],/investmentTransaction/);assert.ok(transactions.filters.and.includes('financeId != null'));
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
 const source=readFileSync('src/settings.ts','utf8');for(const label of ['Data & storage','Rules & budgets','Properties'])assert.ok(source.includes(`title: "${label}"`));for(const action of ['Configure in GCM','Save property names','Discard edits','Resume migration','Migrate and save','Save without migrating','Cancel'])assert.ok(source.includes(`"${action}"`));assert.match(source,/api\?\.ui\?\.openCustomPropertySettings/);assert.match(source,/PROPERTY_GROUPS\[this.propertyGroup\]/);assert.match(source,/aria-label/);assert.doesNotMatch(source,/createEl\("details"/);
 const properties=readFileSync('src/finance-properties.ts','utf8');assert.doesNotMatch(properties,/aliases\(/);assert.doesNotMatch(readFileSync('src/types.ts','utf8'),/propertyDraft|propertyGroup/);
});
test('property editor keeps a sparse explicit map and exposes a generic reset control',()=>{
 const source=readFileSync('src/settings.ts','utf8');
 assert.match(source,/this\.propertyDraft = \{ \.\.\.this\.propertyBaseline\.names\.keys \}/);
 assert.match(source,/setValue\(this\.propertyDraft!\[key\] \?\? key\)/);
 assert.match(source,/addToggle\(toggle => \{/);
 assert.match(source,/delete this\.propertyDraft!\[key\]/);
 assert.match(source,/Store \$\{propertyLabel\(key\)\} name explicitly/);
 assert.match(source,/JSON\.stringify\(from\.names\) === JSON\.stringify\(to\.names\)/);
 assert.match(source,/Finances omits it when the configured kind values differ/);
});
function pluginHarness(h){
 const plugin=new FinancePlugin(h.app);plugin.settings={propertyNames:h.plugin.settings.propertyNames,propertyMigration:null,financeFolder:'',recordMode:'atomic-note',legacyTransactionDiscovery:'discover'};h.app.plugins.plugins['tps-finances']=plugin;
 let disk=structuredClone(plugin.settings),failAt=0,saves=0;plugin.settingsWriter={save:async settings=>{saves++;if(saves===failAt)throw Error('settings write failure');disk=structuredClone(settings)}};plugin.refreshDashboard=async()=>{};
 plugin.loadData=async()=>structuredClone(disk);
 return {plugin,disk:()=>disk,failSave:n=>failAt=n};
}
test('explicit legacy review reads current notes once and clears upgrade markers only after a clean audit',async()=>{
 const h=harness(),p=pluginHarness(h);for(let n=0;n<200;n++)await h.app.vault.create(`Archive/${n}.md`,'Ordinary note');
 let fresh=0,cached=0;const read=h.app.vault.read,cachedRead=h.app.vault.cachedRead;
 h.app.vault.read=async file=>{fresh++;return read(file)};h.app.vault.cachedRead=async file=>{cached++;return cachedRead(file)};
 assert.equal(p.plugin.legacyReviewRequired(),true);
 assert.deepEqual(await p.plugin.reviewLegacyTransactionMarkers(),{markers:0,firstPath:''});
 assert.deepEqual({fresh,cached},{fresh:200,cached:0});
 assert.equal(p.disk().recordMode,'atomic-note');assert.equal(p.disk().legacyTransactionDiscovery,'atomic-only');
 assert.equal(p.plugin.legacyReviewRequired(),false);
});
test('old line and discovery settings gate writes while the active store stays whole-note only',async()=>{
 const h=harness(),p=pluginHarness(h);p.plugin.settings.recordMode='atomic-line';
 const source='- Purchase [type:: transaction] [financeId:: old] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 await h.app.vault.create('Day.md',source);
 let requests=0;p.plugin.requestFinance=async()=>{requests++;return true};
 assert.equal(p.plugin.createStore() instanceof AtomicFinanceStore,true);
 await assert.rejects(p.plugin.syncAll('test'),/Review older inline transactions/);
 await assert.rejects(p.plugin.addCashTransaction(),/Review older inline transactions/);
 assert.equal(requests,0,'no provider request starts before legacy review');
 assert.deepEqual(await p.plugin.reviewLegacyTransactionMarkers(),{markers:1,firstPath:'Day.md'});
 assert.equal(p.plugin.legacyReviewRequired(),true);assert.equal(p.disk().recordMode,'atomic-note');
 assert.equal(p.disk().legacyTransactionDiscovery,'discover');assert.equal(h.contents.get('Day.md'),source);
});
test('missing legacy setting keys normalize to writable whole-note mode without a warning',async()=>{
 const h=harness(),plugin=new FinancePlugin(h.app);plugin.settings={financeFolder:''};
 let saved,requests=0;plugin.settingsWriter={save:async value=>{saved=structuredClone(value)}};
 await plugin.saveSettings();
 assert.equal(saved.recordMode,'atomic-note');assert.equal(saved.legacyTransactionDiscovery,'atomic-only');
 assert.equal(plugin.legacyReviewRequired(),false);assert.equal(plugin.createStore() instanceof AtomicFinanceStore,true);
 plugin.requestFinance=async()=>{requests++;return true};
 await plugin.syncAll('test');assert.equal(requests,1);
});
test('converted provenance does not hide another inline marker from explicit review',async()=>{
 const h=harness(new FinanceProperties({keys:{migrationSource:'originalEntry'}}));
 const paths=await h.store.upsertAccounts([account]);
 const source=`- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[${paths.get('account1').replace(/\.md$/,'')}]]] [amount:: -2] [currency:: USD]`;
 await h.app.vault.create('Day.md',source);
 assert.deepEqual(await h.store.migrateLegacyTransactionLedgers(),{moved:1,skipped:0});
 assert.equal(h.fm('legacy.md').originalEntry,source);
 const p=pluginHarness(h);assert.deepEqual(await p.plugin.reviewLegacyTransactionMarkers(),{markers:0,firstPath:''});
 await h.app.vault.create('Later.md',source.replace('legacy','later'));
 assert.deepEqual(await p.plugin.reviewLegacyTransactionMarkers(),{markers:1,firstPath:'Later.md'});
});
test('legacy audit counts extra YAML, code, malformed and body markers without changing notes',async()=>{
 const h=harness();
 const source='- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 const converted=await h.add('Converted.md',{type:'transaction',financeId:'legacy',date:'2026-09-20',account:'[[Checking]]',amount:-2,migrationSource:source});
 await h.app.fileManager.processFrontMatter(converted,raw=>{raw.example='[financeId:: extra]'});
 await h.app.vault.create('Code.md','```text\n[financeId:: example]\n```');
 await h.app.vault.create('Day.md','- [financeId:: broken]');
 const before=new Map(h.contents);
 assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:3,firstPath:'Converted.md'});
 assert.deepEqual(h.contents,before);
});
test('encoded and folded migration provenance is checked conservatively',async()=>{
 const source='- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 const h=harness();
 const encoded=source.replace('[financeId::','\\u005bfinanceId::');
 await h.app.vault.create('Escaped.md',`---\ntype: transaction\nfinanceId: legacy\ndate: 2026-09-20\naccount: "[[Checking]]"\namount: -2\nmigrationSource: "${encoded}" # [financeId:: extra]\n---\n`);
 assert.deepEqual(await auditLegacyTransactionMarkers(h.app),{markers:1,firstPath:'Escaped.md'});
 const folded=harness();await folded.app.vault.create('Prior.md',`---\ntype: transaction\nfinanceId: legacy\ndate: 2026-09-20\naccount: "[[Checking]]"\namount: -2\nmigrationSource: >-\n  ${source}\n---\n`);
 assert.deepEqual(await auditLegacyTransactionMarkers(folded.app),{markers:0,firstPath:''});
});
test('changed source or interrupted conversion cannot clear the review gate',async()=>{
 const h=harness(),p=pluginHarness(h),file=await h.app.vault.create('Journal.md','No markers');
 const read=h.app.vault.read;h.app.vault.read=async current=>{const content=await read(current);if(current===file)file.stat.mtime++;return content};
 await assert.rejects(p.plugin.reviewLegacyTransactionMarkers(),/vault changed during transaction verification/);
 assert.equal(p.plugin.legacyReviewRequired(),true);
 const later=harness(),review=pluginHarness(later),paths=await later.store.upsertAccounts([account]);
 const source=`- Old purchase [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[${paths.get('account1').replace(/\.md$/,'')}]]] [amount:: -2] [currency:: USD]`;
 await later.app.vault.create('Day.md',source);later.fail('Day.md');
 await assert.rejects(later.store.migrateLegacyTransactionLedgers(),/disk failure/);
 assert.deepEqual(await review.plugin.reviewLegacyTransactionMarkers(),{markers:1,firstPath:'Day.md'});
 assert.equal(review.plugin.legacyReviewRequired(),true);assert.equal(later.contents.get('Day.md'),source);
});
test('failed review-settings save keeps writes gated',async()=>{
 const h=harness(),p=pluginHarness(h);p.failSave(1);
 await assert.rejects(p.plugin.reviewLegacyTransactionMarkers(),/settings write failure/);
 assert.equal(p.plugin.legacyReviewRequired(),true);assert.equal(p.disk().legacyTransactionDiscovery,'discover');
});
test('review state follows persisted settings when a later coalesced write fails',async()=>{
 const h=harness(),p=pluginHarness(h);let disk=structuredClone(p.disk()),writes=0,later,refreshes=0;
 p.plugin.refreshDashboard=async()=>{refreshes++};
 p.plugin.settingsWriter=new CoalescedSnapshotWriter({
  initialSnapshot:structuredClone(p.plugin.settings),readLatest:async()=>structuredClone(disk),
  writeMerged:async value=>{writes++;if(writes===1){disk=structuredClone(value);p.plugin.settings.enableLogging=true;later=p.plugin.saveSettings().then(()=>null,error=>error)}else throw Error('debug settings write failure')},
  normalize:value=>structuredClone(value),reconcile:(requested,persisted)=>{p.plugin.settings=reconcilePersistedSnapshot(p.plugin.settings,requested,persisted)},
 });
 p.plugin.loadData=async()=>structuredClone(disk);
 await assert.rejects(p.plugin.reviewLegacyTransactionMarkers(),/debug settings write failure/);
 assert.match(String(await later),/debug settings write failure/);
 assert.equal(writes,2);assert.equal(disk.legacyTransactionDiscovery,'atomic-only');
 assert.equal(p.plugin.legacyReviewRequired(),false);assert.equal(refreshes,1);
 setLoggingEnabled(false);
});
test('dashboard and API never discover inline entries, including after legacy review',async()=>{
 const h=harness(),p=pluginHarness(h),paths=await h.store.upsertAccounts([account]);
 await h.store.applyTransactions([tx],[],[],state,paths);
 p.plugin.getConnectedItems=()=>[];p.plugin.getRelayStatus=()=>null;p.plugin.getPlaidSetupStatus=()=>({state:'ready'});
 const source=`- Old purchase [type:: transaction] [financeId:: later] [date:: 2026-09-20] [account:: [[${paths.get('account1').replace(/\.md$/,'')}]]] [amount:: -2] [currency:: USD]`;
 await h.app.vault.create('Day.md',source);
 const reads=[];const cachedRead=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads.push(file.path);return cachedRead(file)};
 const store=p.plugin.createStore();
 assert.deepEqual((await store.readTransactionRecords()).map(t=>t.path),['tx1.md']);
 assert.ok(!reads.includes('Day.md'));
 reads.length=0;assert.deepEqual((await store.readTransactionRecords('metadata')).map(t=>t.path),['tx1.md']);
 assert.ok(!reads.includes('Day.md'));
 const model=await p.plugin.getDashboardModel(new Set(),'metadata');assert.deepEqual(model.transactions.map(t=>t.financeId),['tx1']);
 assert.equal(model.legacyReviewRequired,true);
 assert.deepEqual(await p.plugin.reviewLegacyTransactionMarkers(),{markers:1,firstPath:'Day.md'});
 assert.deepEqual((await p.plugin.createStore().readTransactionRecords()).map(t=>t.path),['tx1.md']);
 assert.equal(h.contents.get('Day.md'),source);
});
test('dashboard display ignores 10,000 unrelated notes without body reads or writes',async()=>{
 const h=harness(),p=pluginHarness(h);p.plugin.settings.financeFolder='Finances';
 await h.add('Finances/Transactions/selected.md',classificationFields('selected',{account:'[[Finances/Accounts/Checking]]'}));
 for(let i=0;i<10000;i++)await h.app.vault.create(`Archive/ordinary-${i}.md`,'Ordinary note');
 p.plugin.getConnectedItems=()=>[];p.plugin.getRelayStatus=()=>null;p.plugin.getPlaidSetupStatus=()=>({state:'ready'});
 let scans=0,reads=0,writes=0;const list=h.app.vault.getMarkdownFiles,read=h.app.vault.cachedRead,process=h.app.vault.process;
 h.app.vault.getMarkdownFiles=()=>{scans++;return list()};h.app.vault.cachedRead=async file=>{reads++;return read(file)};h.app.vault.process=async(...args)=>{writes++;return process(...args)};
 const model=await p.plugin.getDashboardModel(new Set(),'metadata');
 assert.deepEqual(model.transactions.map(row=>row.financeId),['selected']);
 assert.deepEqual({scans,reads,writes},{scans:1,reads:0,writes:0});
});
test('classification never writes a missing atomic transaction into an inline note',async()=>{
 const h=harness(),p=pluginHarness(h);const original='- Cash purchase [type:: transaction] [financeId:: missing-manual] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 await h.app.vault.create('Day.md',original);let reads=0,writes=0;
 const cachedRead=h.app.vault.cachedRead,process=h.app.vault.process;
 h.app.vault.cachedRead=async file=>{reads++;return cachedRead(file)};h.app.vault.process=async(...args)=>{writes++;return process(...args)};
 const save=(financeId='missing-manual')=>{globalThis.PropertyQAModal=null;p.plugin.editTransactionClassification({financeId,manual:true});return globalThis.PropertyQAModal.save('Food',['cash'])};
 await assert.rejects(save(),/The transaction could not be found\./);
 assert.deepEqual({reads,writes},{reads:0,writes:0});assert.equal(h.contents.get('Day.md'),original);
 await h.add('Cash.md',{financeId:'atomic-manual',type:'transaction',financeSource:'manual',account:'[[Checking]]',date:'2026-09-20',amount:-3,currency:'USD'});
 await save('atomic-manual');assert.equal(h.fm('Cash.md').categoryOverride,'Food');assert.deepEqual(h.fm('Cash.md').tags,['cash']);
 assert.equal(h.contents.get('Day.md'),original);
});
const classificationFields=(financeId,extra={})=>({financeId,type:'transaction',date:'2026-09-20',account:'[[Checking]]',amount:-3,currency:'USD',...extra});
async function displayedTransaction(h,p,financeId){
 p.plugin.getConnectedItems=()=>[];p.plugin.getRelayStatus=()=>null;p.plugin.getPlaidSetupStatus=()=>({state:'ready'});
 return (await p.plugin.getDashboardModel(undefined,'metadata')).transactions.find(row=>row.financeId===financeId);
}
function classificationSave(plugin,row,category='Food',tags=['cash']){
 globalThis.PropertyQAModal=null;
 plugin.editTransactionClassification(row);
 assert.ok(globalThis.PropertyQAModal);
 return globalThis.PropertyQAModal.save(category,tags);
}
test('atomic-only classification targets one rendered file without reading 10,000 other note bodies',async t=>{
 const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 for(let i=0;i<10000;i++)await h.add(`Transactions/tx-${i}.md`,classificationFields(`tx-${i}`));
 const row=await displayedTransaction(h,p,'tx-5000');
 assert.equal(row.sourceFile,h.files.get(row.sourcePath));
 assert.equal(Object.getOwnPropertyDescriptor(row,'sourceFile').enumerable,false,'file binding stays out of the public model shape');
 let scans=0,metadata=0,cached=0,fresh=0,frontmatterWrites=0,legacyWrites=0;
 const getMarkdownFiles=h.app.vault.getMarkdownFiles,cachedRead=h.app.vault.cachedRead,read=h.app.vault.read;
 const getFileCache=h.app.metadataCache.getFileCache,processFrontMatter=h.app.fileManager.processFrontMatter,process=h.app.vault.process;
 h.app.vault.getMarkdownFiles=()=>{scans++;return getMarkdownFiles()};
 h.app.metadataCache.getFileCache=file=>{metadata++;return getFileCache(file)};
 h.app.vault.cachedRead=async file=>{cached++;return cachedRead(file)};
 h.app.vault.read=async file=>{fresh++;return read(file)};
 h.app.fileManager.processFrontMatter=async(...args)=>{frontmatterWrites++;return processFrontMatter(...args)};
 h.app.vault.process=async(...args)=>{legacyWrites++;return process(...args)};
 const saveStarted=performance.now();await classificationSave(p.plugin,row);const saveMs=performance.now()-saveStarted;
 assert.deepEqual({scans,metadata,cached,fresh,frontmatterWrites,legacyWrites},{scans:0,metadata:0,cached:0,fresh:0,frontmatterWrites:1,legacyWrites:0});
 assert.equal(h.fm(row.sourcePath).categoryOverride,'Food');assert.deepEqual(h.fm(row.sourcePath).tags,['cash']);
 assert.equal(h.fm('Transactions/tx-5001.md').categoryOverride,undefined);
 scans=metadata=cached=fresh=frontmatterWrites=legacyWrites=0;
 const refreshStarted=performance.now();const refreshed=await p.plugin.getDashboardModel(new Set(),'metadata');const refreshMs=performance.now()-refreshStarted;
 assert.equal(refreshed.transactions.length,10000);
 assert.equal(scans,1,'one model uses one shared Markdown file list');assert.equal(metadata,30000,'root readers memoize one lookup and atomic discovery rechecks candidates twice');assert.equal(cached,0);assert.equal(fresh,0);assert.equal(frontmatterWrites,0);assert.equal(legacyWrites,0);
 t.diagnostic(`synthetic 10k save: ${saveMs.toFixed(1)} ms, 0 enumerations/metadata/body reads, 1 frontmatter write; model refresh: ${refreshMs.toFixed(1)} ms, ${scans} enumerations, ${metadata} metadata lookups, ${cached} cached reads, ${fresh} fresh reads, 0 writes`);
});
test('folder-mode save is path-bound while dashboard and home summaries use indexed display reads',async t=>{
 const h=harness(),p=pluginHarness(h);p.plugin.settings.financeFolder='Finances';await p.plugin.reviewLegacyTransactionMarkers();
 for(let i=0;i<10000;i++)await h.add(`Finances/Transactions/tx-${i}.md`,classificationFields(`tx-${i}`));
 const row=await displayedTransaction(h,p,'tx-5000');assert.equal(row.sourceFile,h.files.get(row.sourcePath));
 let scans=0,metadata=0,cached=0,fresh=0,writes=0;
 const getMarkdownFiles=h.app.vault.getMarkdownFiles,getFileCache=h.app.metadataCache.getFileCache,cachedRead=h.app.vault.cachedRead,read=h.app.vault.read,processFrontMatter=h.app.fileManager.processFrontMatter;
 h.app.vault.getMarkdownFiles=()=>{scans++;return getMarkdownFiles()};h.app.metadataCache.getFileCache=file=>{metadata++;return getFileCache(file)};
 h.app.vault.cachedRead=async file=>{cached++;return cachedRead(file)};h.app.vault.read=async file=>{fresh++;return read(file)};
 h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return processFrontMatter(...args)};
 const reset=()=>{scans=metadata=cached=fresh=writes=0};
 const saveStarted=performance.now();await classificationSave(p.plugin,row);const saveMs=performance.now()-saveStarted;
 assert.deepEqual({scans,metadata,cached,fresh,writes},{scans:0,metadata:0,cached:0,fresh:0,writes:1});reset();
 const refreshStarted=performance.now();const model=await p.plugin.getDashboardModel(new Set(),'metadata');const refreshMs=performance.now()-refreshStarted;
 assert.equal(model.transactions.length,10000);assert.equal(scans,1);assert.equal(metadata,10000,'transaction folder candidates need only their inspection lookup');assert.equal(cached,0);assert.equal(fresh,0);assert.equal(writes,0);
 const refreshCounts={scans,metadata,cached,fresh,writes};reset();
 const sourceStarted=performance.now();await p.plugin.getDashboardModel();const sourceMs=performance.now()-sourceStarted;
 assert.equal(scans,1);assert.equal(cached,10000,'the old source-backed home model reads every atomic body');assert.equal(metadata,0,'folder candidates need no metadata preflight for source reads');const sourceCounts={scans,metadata,cached,fresh,writes};reset();
 const element={empty(){},addClass(){},createDiv(){return this},createEl(){return this},createSpan(){return this},addEventListener(){}};
 const homeStarted=performance.now();await p.plugin.renderHomeSummary(element);const homeMs=performance.now()-homeStarted;
 assert.equal(scans,1);assert.equal(cached,0,'read-only home display uses the indexed model');assert.equal(metadata,10000);assert.equal(fresh,0);assert.equal(writes,0);
 t.diagnostic(`synthetic folder 10k save: ${saveMs.toFixed(1)} ms, 0 enumerations/metadata/body reads, 1 frontmatter write; model refresh: ${refreshMs.toFixed(1)} ms, ${JSON.stringify(refreshCounts)}; old source model: ${sourceMs.toFixed(1)} ms, ${JSON.stringify(sourceCounts)}; home summary: ${homeMs.toFixed(1)} ms, ${JSON.stringify({scans,metadata,cached,fresh,writes})}`);
});
test('model-scoped discovery enumerates once with 90,000 indexed unrelated notes',async t=>{
 for(const folder of ['', 'Finances']){
  const h=harness(),p=pluginHarness(h);p.plugin.settings.financeFolder=folder;await p.plugin.reviewLegacyTransactionMarkers();
  const transactionPath=folder?'Finances/Transactions/selected.md':'Transactions/selected.md';
  await h.add(transactionPath,classificationFields('selected'));
  for(let i=0;i<90000;i++)await h.app.vault.create(`Other/ordinary-${i}.md`,'Ordinary note\n');
  const getFileCache=h.app.metadataCache.getFileCache,ordinary={frontmatter:{kind:'task'}};
  h.app.metadataCache.getFileCache=file=>file.path.startsWith('Other/')?ordinary:getFileCache(file);
  let scans=0,metadata=0,cached=0,fresh=0;
  const getMarkdownFiles=h.app.vault.getMarkdownFiles,cachedRead=h.app.vault.cachedRead,read=h.app.vault.read,cache=h.app.metadataCache.getFileCache;
  h.app.vault.getMarkdownFiles=()=>{scans++;return getMarkdownFiles()};
  h.app.metadataCache.getFileCache=file=>{metadata++;return cache(file)};
  h.app.vault.cachedRead=async file=>{cached++;return cachedRead(file)};
  h.app.vault.read=async file=>{fresh++;return read(file)};
  const model=await p.plugin.getDashboardModel(new Set(),'metadata');
  assert.deepEqual(model.transactions.map(row=>row.financeId),['selected']);
  assert.equal(scans,1);assert.equal(metadata,folder?90001:180003);assert.equal(cached,0);assert.equal(fresh,0);
  t.diagnostic(`synthetic 90k unrelated ${folder||'root'}: ${scans} enumeration, ${metadata} metadata lookups, ${cached} cached reads, ${fresh} fresh reads`);
 }
});
test('model snapshot keeps atomic discovery fresh when metadata changes or disappears between readers',async()=>{
 for(const phase of ['late-candidate','vanished-inspection']){
  const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
  const path=phase==='late-candidate'?'Accounts/Edited transaction.md':'Inbox/Edited transaction.md';
  const fields=classificationFields('edited',{account:'[[Accounts/Checking]]'});
  await h.add(path,fields);
  let targetLookups=0,scans=0,bodyReads=0;
  const originalCache=h.app.metadataCache.getFileCache,originalList=h.app.vault.getMarkdownFiles,originalRead=h.app.vault.cachedRead;
  h.app.metadataCache.getFileCache=file=>{
   if(file.path!==path)return originalCache(file);
   targetLookups++;
   if(phase==='late-candidate'&&targetLookups===1)return {frontmatter:{kind:'account'}};
   if(phase==='vanished-inspection'&&targetLookups===2)return null;
   return originalCache(file);
  };
  h.app.vault.getMarkdownFiles=()=>{scans++;return originalList()};
  h.app.vault.cachedRead=async file=>{bodyReads++;return originalRead(file)};
  const model=await p.plugin.getDashboardModel(new Set(),'metadata');
  assert.deepEqual(model.transactions.map(row=>row.financeId),['edited'],phase);
  assert.equal(scans,1);assert.equal(targetLookups,phase==='late-candidate'?3:2);
  assert.equal(bodyReads,phase==='late-candidate'?0:1,'only a missing inspection cache needs current source');
 }
});
test('one model keeps its file list while a later model sees a note created during the read',async()=>{
 const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 const snapshot=await h.add('Snapshots/Latest.md',{type:'financeSnapshot',date:'2026-09-20'});
 const originalRead=h.app.vault.cachedRead;let created=false,scans=0;
 const originalList=h.app.vault.getMarkdownFiles;
 h.app.vault.getMarkdownFiles=()=>{scans++;return originalList()};
 h.app.vault.cachedRead=async file=>{
  if(file===snapshot&&!created){created=true;await h.add('Transactions/New.md',classificationFields('new'));}
  return originalRead(file);
 };
 const first=await p.plugin.getDashboardModel(new Set(),'metadata');
 assert.equal(created,true);assert.deepEqual(first.transactions,[]);assert.equal(scans,1);
 const second=await p.plugin.getDashboardModel(new Set(),'metadata');
 assert.deepEqual(second.transactions.map(row=>row.financeId),['new']);assert.equal(scans,2);
});
test('model snapshot still rejects duplicate atomic IDs before presenting a model',async()=>{
 const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 await h.add('Transactions/First.md',classificationFields('same'));
 await h.add('Transactions/Second.md',classificationFields('same'));
 let writes=0;const process=h.app.fileManager.processFrontMatter;
 h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args)};
 await assert.rejects(p.plugin.getDashboardModel(new Set(),'metadata'),/Duplicate atomic transaction identity/);
 assert.equal(writes,0);
});
test('rendered manual cash classification uses the same atomic-only target',async()=>{
 const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 const cash=await h.manual.createAccount({kind:'cash',name:'Wallet',currency:'USD',value:100,valuationDate:'2026-09-20',purchaseTransaction:'',liabilityAccount:'',assetType:''});
 const file=await h.manual.createCashEntry({title:'Lunch',amount:3,date:'2026-09-20',accountPath:cash.path,kind:'expense',category:'',tags:[],counterpart:'',linkedTransaction:''});
 const row=await displayedTransaction(h,p,h.fm(file.path).tpsId);assert.equal(row.manual,true);assert.equal(row.sourceFile,file);
 let scans=0,reads=0;const getMarkdownFiles=h.app.vault.getMarkdownFiles,cachedRead=h.app.vault.cachedRead;
 h.app.vault.getMarkdownFiles=()=>{scans++;return getMarkdownFiles()};h.app.vault.cachedRead=async target=>{reads++;return cachedRead(target)};
 await classificationSave(p.plugin,row);
 assert.deepEqual({scans,reads},{scans:0,reads:0});assert.equal(h.fm(file.path).categoryOverride,'Food');
});
test('atomic-only classification keeps the ID lookup for a plain dashboard row',async()=>{
 const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 await h.add('Selected.md',classificationFields('plain'));const row=await displayedTransaction(h,p,'plain'),plain={...row};
 assert.equal(plain.sourceFile,undefined);
 let scans=0,reads=0;const getMarkdownFiles=h.app.vault.getMarkdownFiles,cachedRead=h.app.vault.cachedRead;
 h.app.vault.getMarkdownFiles=()=>{scans++;return getMarkdownFiles()};h.app.vault.cachedRead=async file=>{reads++;return cachedRead(file)};
 await classificationSave(p.plugin,plain);
 assert.deepEqual({scans,reads},{scans:1,reads:1});assert.equal(h.fm('Selected.md').categoryOverride,'Food');
});
test('atomic-only classification rejects a same-path replacement after render or modal open',async()=>{
 for(const replaceAfterModal of [false,true]){
  const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
  await h.add('Selected.md',classificationFields('selected'));
  const row=await displayedTransaction(h,p,'selected'),original=row.sourceFile;
  if(replaceAfterModal){globalThis.PropertyQAModal=null;p.plugin.editTransactionClassification(row);assert.ok(globalThis.PropertyQAModal);}
  h.files.delete('Selected.md');h.contents.delete('Selected.md');
  await h.add('Selected.md',classificationFields('selected',{custom:'replacement'}));
  assert.notEqual(h.files.get('Selected.md'),original);
  const save=replaceAfterModal?globalThis.PropertyQAModal.save('Food',['cash']):classificationSave(p.plugin,row);
  await assert.rejects(save,/transaction changed or moved/);
  assert.equal(h.fm('Selected.md').categoryOverride,undefined);
 }
});
test('atomic-only classification rejects moved, retargeted and concurrently reclassified notes',async()=>{
 for(const change of ['moved','identity','type','classification','boundary']){
  const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
  const file=await h.add('Selected.md',classificationFields('selected',{categoryOverride:'Old',tags:['old']}));
  const row=await displayedTransaction(h,p,'selected');
  globalThis.PropertyQAModal=null;p.plugin.editTransactionClassification(row);const modal=globalThis.PropertyQAModal;
  assert.ok(modal);
  if(change==='moved'){
   h.files.delete('Selected.md');h.contents.set('Moved.md',h.contents.get('Selected.md'));h.contents.delete('Selected.md');file.path='Moved.md';h.files.set('Moved.md',file);
  }else if(change==='boundary'){
   const process=h.app.fileManager.processFrontMatter;
   h.app.fileManager.processFrontMatter=(target,update)=>process(target,raw=>{raw.financeId='other';update(raw)});
  }else await h.app.fileManager.processFrontMatter(file,raw=>{
   if(change==='identity')raw.financeId='other';
   if(change==='type')raw.type='investmentTransaction';
   if(change==='classification'){raw.categoryOverride='Newer';raw.tags=['newer'];}
  });
  const before=new Map(h.contents);
  await assert.rejects(modal.save('Food',['cash']),/transaction changed or moved/,change);
  assert.deepEqual(h.contents,before,`${change} must not overwrite the newer source`);
 }
});
test('scalar YAML tags are displayed and concurrent scalar edits block classification',async()=>{
 const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 const file=await h.add('Selected.md',classificationFields('selected',{tags:'cash, receipt'}));
 const row=await displayedTransaction(h,p,'selected');assert.deepEqual(row.manualTags,['#cash','#receipt']);
 globalThis.PropertyQAModal=null;p.plugin.editTransactionClassification(row);const modal=globalThis.PropertyQAModal;
 await h.app.fileManager.processFrontMatter(file,raw=>{raw.tags='newer'});
 const before=h.contents.get(file.path);
 await assert.rejects(modal.save('Food',['cash']),/transaction changed or moved/);
 assert.equal(h.contents.get(file.path),before);
});
test('nonstring YAML array tags do not break displayed classification or its write guard',async()=>{
 const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 await h.add('Selected.md',classificationFields('mixed-tags',{tags:[42,null]}));
 const row=await displayedTransaction(h,p,'mixed-tags');assert.deepEqual(row.manualTags,['#42','#null']);
 await classificationSave(p.plugin,row,'Food',['receipt']);
 assert.equal(h.fm('Selected.md').categoryOverride,'Food');assert.deepEqual(h.fm('Selected.md').tags,['receipt']);
});
test('path-bound classification honors mapped category and scalar tag property names',async()=>{
 const properties=mapped(),h=harness(properties),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 await h.add('Selected.md',properties.write(classificationFields('mapped',{tags:'cash, receipt'})));
 const row=await displayedTransaction(h,p,'mapped');assert.deepEqual(row.manualTags,['#cash','#receipt']);
 await classificationSave(p.plugin,row,'Food',['receipt']);
 assert.equal(h.fm('Selected.md')[properties.key('categoryOverride')],'Food');
 assert.deepEqual(h.fm('Selected.md')[properties.key('tags')],['receipt']);
});
test('path-bound classification updates only the selected duplicate; full ID reads still reject duplicates',async()=>{
 const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 await h.add('Selected.md',classificationFields('same'));const row=await displayedTransaction(h,p,'same');
 await h.add('Duplicate.md',classificationFields('same'));
 await classificationSave(p.plugin,row);
 assert.equal(h.fm('Selected.md').categoryOverride,'Food');assert.equal(h.fm('Duplicate.md').categoryOverride,undefined);
 await assert.rejects(p.plugin.createStore().readTransactionRecords(),/Duplicate atomic transaction identity/);
});
test('inline entries do not appear as dashboard classification targets',async()=>{
 const h=harness(),p=pluginHarness(h);
 const source='- Cash [type:: transaction] [financeId:: line-manual] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 await h.app.vault.create('Day.md',source);
 assert.equal(await displayedTransaction(h,p,'line-manual'),undefined);
 assert.equal(h.contents.get('Day.md'),source);
});
test('a vanished atomic row never falls back to an inline entry with the same ID',async()=>{
 const h=harness(),p=pluginHarness(h);await h.add('Selected.md',classificationFields('recover'));
 const row=await displayedTransaction(h,p,'recover');assert.equal(row.sourceFile,h.files.get('Selected.md'));
 h.files.delete('Selected.md');h.contents.delete('Selected.md');
 const source='- Purchase [type:: transaction] [financeId:: recover] [date:: 2026-09-20] [account:: [[Checking]]] [amount:: -2]';
 await h.app.vault.create('Day.md',source);
 let writes=0;const process=h.app.vault.process;h.app.vault.process=async(...args)=>{writes++;return process(...args)};
 await assert.rejects(classificationSave(p.plugin,row),/transaction changed or moved/);
 assert.equal(writes,0);assert.equal(h.contents.get('Day.md'),source);
});
test('saving with migration renames first, then commits settings; no previous names are retained',async()=>{
 const h=harness(),p=pluginHarness(h),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'transactionType'}});await h.add('A.md',{financeId:'a',type:'transaction',amount:-4});
 await p.plugin.changePropertyNames(from,to,true);assert.equal(h.fm('A.md').transactionType,'transaction');assert.ok(!('type' in h.fm('A.md')));assert.deepEqual(p.disk().propertyNames,to.names);assert.equal(p.disk().propertyMigration,null);assert.ok(!('previous' in p.disk().propertyNames));
});
test('declining migration saves strict new names without touching old note values',async()=>{
 const h=harness(),p=pluginHarness(h),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'transactionType'}});await h.add('A.md',{financeId:'a',type:'transaction',amount:-4});const before=h.contents.get('A.md');
 await p.plugin.changePropertyNames(from,to,false);assert.equal(h.contents.get('A.md'),before);assert.equal(financeProperties(h.app).read(h.fm('A.md')).type,undefined);assert.equal((await h.store.readTransactionRecords()).length,0);assert.deepEqual(p.disk().propertyNames,to.names);
});
test('pin-only property saves and resets keep other pins without scanning or rewriting notes',async()=>{
 const h=harness(),p=pluginHarness(h),fields=['institution','accountName','accountType','currency','current','available','limit','providerTitle','providerName','merchant','account','amount','pending','subtype'];
 const keys=Object.fromEntries(fields.map(key=>[key,key]));
 await h.add('Account.md',{financeAccountId:'account',type:'account',currency:'USD'});
 const before=h.contents.get('Account.md');
 h.app.vault.getMarkdownFiles=()=>{throw Error('Unexpected vault scan')};
 await p.plugin.changePropertyNames(new FinanceProperties(),new FinanceProperties({keys}),false);
 assert.deepEqual(p.disk().propertyNames,{keys});
 assert.equal(h.contents.get('Account.md'),before);
 assert.equal(new FinanceProperties(p.disk().propertyNames).customized,false);
 const rest={...keys};delete rest.currency;
 await p.plugin.changePropertyNames(new FinanceProperties({keys}),new FinanceProperties({keys:rest}),false);
 assert.deepEqual(p.disk().propertyNames,{keys:rest});
 assert.equal(h.contents.get('Account.md'),before);
});
test('failed pin-only settings save reconciles the persisted property map',async()=>{
 const h=harness(),p=pluginHarness(h),to=new FinanceProperties({keys:{currency:'currency'}});
 p.failSave(1);
 await assert.rejects(p.plugin.changePropertyNames(new FinanceProperties(),to,false),/settings write failure/);
 assert.deepEqual(p.plugin.settings.propertyNames,{keys:{}});
 assert.deepEqual(p.disk().propertyNames,{keys:{}});
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
 const h=harness(),p=pluginHarness(h),from=new FinanceProperties(),to=new FinanceProperties({keys:{type:'transactionType'}});await h.add('A.md',{financeId:'a',type:'transaction'});const {journal}=await previewPropertyMigration(h.app,from,to,'');p.plugin.settings.propertyMigration=journal;h.app.plugins.plugins['tps-global-context-menu']={settings:{nativeRecordIdentityPropertyKey:'transactionType'},api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'transactionType'})}}};
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
 const h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:codec}};
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
 const h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:codec}};
 const paths=await h.store.upsertAccounts([account]);assert.equal(h.fm(paths.get('account1')).kind,undefined);assert.ok(h.fm(paths.get('account1')).tags.includes('accounts'));
 await h.store.applyTransactions([tx],[],[],structuredClone(state),paths);
 await h.store.applyTransactions([],[{...tx,amount:-9}],[],structuredClone(state),paths);
 assert.equal(h.fm('tx1.md').kind,undefined);assert.equal((await h.store.readTransactionRecords()).length,1);assert.deepEqual(await h.store.readTransactionRecords('metadata'),await h.store.readTransactionRecords());
 const base=financeProperties(h.app).base('filters:\n  and:\n    - kind == "transaction"\n    - note.kind != "account"\nviews: []\n');
 assert.match(base,/file\.hasTag\("kind\/financial\/transaction"\)/);assert.match(base,/!file\.hasTag\("accounts"\)/);assert.doesNotMatch(base,/undefined/);
});
function configurableListCodec(){
 const paths={account:'entity/bank','finance-transaction':'transaction/money','investment-transaction':'transaction/investment',holding:'entity/position',ledger:'note/snapshot','finance-rule':'note/rule','finance-budget':'note/budget'};
 const scalar={account:'account','finance-transaction':'transaction','investment-transaction':'investmentTransaction',holding:'holding',ledger:'ledger','finance-rule':'financeRule','finance-budget':'financeBudget'};
 const aliases={account:[{tag:'kind/account/entity'}],'finance-transaction':[{tag:'kind/financial/transaction'}]};
 const disabled=new Set();
 let listKey='classifications',scheduleKey='when';
 const readDefinitions=kind=>paths[kind]?[{kindList:{key:listKey,value:paths[kind]}},{scalar:{key:'kind',value:scalar[kind]}},...(aliases[kind]||[])]:[];
 const matches=(raw,kind)=>readDefinitions(kind).some(d=>'kindList'in d?raw[d.kindList.key]?.includes(d.kindList.value):'scalar'in d?raw[d.scalar.key]===d.scalar.value:raw.tags?.includes(d.tag));
 return {
  version:2,definition:kind=>readDefinitions(kind)[0]||null,readDefinitions,matches,
  propertyKey:id=>id==='scheduled'?scheduleKey:id==='kind'?listKey:null,
  encode:(fields,existing)=>{
   const kind=fields.kind,definition=readDefinitions(kind)[0];if(!definition)return {...fields};
   if(disabled.has(kind))throw Error(`Writer disabled for ${kind}`);
   const next={...fields};delete next.kind;
   const old=existing?.[listKey];if(old!==undefined&&!Array.isArray(old)&&old!==scalar[kind])throw Error('Incompatible existing kind');
   next[listKey]=[...new Set([...(Array.isArray(old)?old:[]),...(Array.isArray(next[listKey])?next[listKey]:[]),definition.kindList.value])];
   const retired=new Set(Object.keys(paths).filter(candidate=>paths[candidate]===definition.kindList.value)
    .flatMap(candidate=>aliases[candidate]||[]).filter(alias=>'tag'in alias).map(alias=>alias.tag));
   if(Array.isArray(next.tags)){
    const kept=next.tags.filter(tag=>!retired.has(tag));
    if(kept.length!==next.tags.length){if(kept.length)next.tags=kept;else delete next.tags;}
   }
   return next;
  },
  decode:(fields,expectedKind)=>{const kinds=Object.keys(paths).filter(kind=>matches(fields,kind));if(expectedKind&&kinds.includes(expectedKind))return {...fields,kind:expectedKind};if(expectedKind&&kinds.length)throw Error('Expected record kind does not match its configured classification.');if(kinds.length>1)return {...fields};return kinds.length?{...fields,kind:kinds[0]}:{...fields};},
  configure:(kind,path)=>{paths[kind]=path;},addAlias:(kind,definition)=>{aliases[kind]=[...(aliases[kind]||[]),definition];},setScheduleKey:key=>{scheduleKey=key;},setListKey:key=>{listKey=key;},setWriterEnabled:(kind,enabled)=>{if(enabled)disabled.delete(kind);else disabled.add(kind);},
 };
}
test('GCM v2 owns configurable kind lists and Scheduled key, while old scalar, tag and date forms remain readable',()=>{
 const codec=configurableListCodec(),properties=new FinanceProperties({keys:{kind:'oldKind',date:'oldDate'}},financeKindCodec(codec));
 const created=properties.write({kind:'transaction',type:'transaction',date:'2026-10-03',amount:-4});
 assert.deepEqual(created.classifications,['transaction/money']);assert.equal(created.when,'2026-10-03');
 assert.ok(!('oldKind'in created)&&!('oldDate'in created)&&!('date'in created));
 assert.equal(properties.read(created).kind,'transaction');assert.equal(properties.read(created).date,'2026-10-03');
 assert.equal(properties.read({oldKind:'account',oldDate:'2026-10-01'}).kind,'account');
 assert.equal(properties.read({kind:'transaction',date:'2026-10-02'}).date,'2026-10-02');
 assert.equal(properties.read({tags:['kind/financial/transaction'],date:'2026-10-01'}).kind,'transaction');
 const raw={classifications:['transaction/money','user/other'],when:'2026-10-03',type:'transaction',financeId:'tx',amount:-4};
 properties.mutate(raw,f=>{f.amount=-5;});assert.deepEqual(raw.classifications,['transaction/money','user/other']);assert.equal(raw.when,'2026-10-03');assert.equal(raw.amount,-5);
 codec.configure('finance-transaction','transaction/new-choice');codec.setScheduleKey('plannedAt');
 const changed=new FinanceProperties(undefined,financeKindCodec(codec)).write({kind:'transaction',type:'transaction',date:'2026-10-04'});
 assert.deepEqual(changed.classifications,['transaction/new-choice']);assert.equal(changed.plannedAt,'2026-10-04');
 codec.setScheduleKey('amount');assert.throws(()=>new FinanceProperties(undefined,financeKindCodec(codec)),/conflicts with a Finance field/);
 codec.setScheduleKey('plannedAt');codec.setListKey('amount');
 assert.throws(()=>new FinanceProperties(undefined,financeKindCodec(codec)),/Record classification property.*conflicts with a Finance field/);
});
test('shared visible Finance kinds decode through existing configured transaction type',()=>{
 const codec=configurableListCodec();
 codec.setListKey('kind');
 codec.configure('finance-transaction','transaction/financial');
 codec.configure('investment-transaction','transaction/financial');
 const properties=new FinanceProperties({keys:{type:'recordType'}},financeKindCodec(codec));
 for(const recordType of ['transaction','investmentTransaction']){
  const raw=properties.write({kind:recordType,type:recordType,date:'2026-10-03',financeId:'tx'});
  assert.deepEqual(raw.kind,['transaction/financial']);
  assert.equal(raw.recordType,recordType);
  assert.equal(properties.read(raw).kind,recordType);
  assert.equal(properties.read(raw).type,recordType);
 }
 assert.deepEqual(codec.decode({kind:['transaction/financial']}).kind,['transaction/financial']);
 assert.throws(()=>properties.read({kind:['transaction/financial'],financeId:'undecidable'}),/classification is ambiguous/);
});
test('legacy shared Finance classification uses configured path and the existing transaction type',()=>{
 const codec=configurableListCodec();
 codec.setListKey('kind');
 codec.configure('finance-transaction','transaction/financial');
 codec.configure('investment-transaction','transaction/financial');
 const properties=new FinanceProperties(undefined,financeKindCodec(codec));
 const legacy={tags:['kind/financial/transaction'],type:'investmentTransaction',financeId:'investment-1',date:'2026-09-30'};
 assert.equal(properties.read(legacy).kind,'investmentTransaction');
 assert.equal(properties.read(legacy).date,'2026-09-30');
 assert.deepEqual(legacy.tags,['kind/financial/transaction']);
 const updated=structuredClone(legacy);
 properties.mutate(updated,fields=>{fields.amount=6;});
 assert.deepEqual(updated.kind,['transaction/financial']);
 assert.ok(!('tags'in updated)&&!('date'in updated));
 assert.equal(updated.when,'2026-09-30');
 assert.equal(properties.read(updated).kind,'investmentTransaction');
 const labeled={...structuredClone(legacy),tags:['kind/financial/transaction','manual']};
 properties.mutate(labeled,fields=>{fields.amount=6;});
 assert.deepEqual(labeled.tags,['manual']);
 codec.configure('investment-transaction','transaction/investment');
 assert.throws(()=>properties.read(legacy),/Expected record kind/);
 codec.configure('investment-transaction','transaction/financial');
 assert.throws(()=>properties.read({...legacy,kind:['entity/food']}),/Expected record kind/);
 assert.throws(()=>properties.read({...legacy,Kind:['entity/food']}),/Expected record kind/);
 assert.throws(()=>properties.read({...legacy,Kind:'unrelated'}),/Expected record kind/);
});
test('distinct configured Finance kinds identify transactions and holdings without a type property',async()=>{
 const codec=configurableListCodec();codec.setListKey('kind');
 codec.configure('finance-transaction','transaction/financial');
 codec.configure('investment-transaction','transaction/financial/investment');
 codec.configure('holding','entity/holding');
 const h=harness(new FinanceProperties({keys:{type:'recordType'}}));
 h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:codec}};
 const paths=await h.store.upsertAccounts([account]);
 const investment={...tx,financeId:'investment-1',providerTransactionId:'investment-provider',kind:'investmentTransaction',investmentType:''};
 await h.store.applyTransactions([tx,investment],[],[],structuredClone(state),paths);
 const ordinary=h.fm('tx1.md'),trade=h.fm('investment-1.md');
 assert.deepEqual(ordinary.kind,['transaction/financial']);
 assert.deepEqual(trade.kind,['transaction/financial/investment']);
 for(const raw of [ordinary,trade]){assert.ok(!('type'in raw));assert.ok(!('recordType'in raw));}
 const properties=financeProperties(h.app);
 assert.equal(properties.read(ordinary).type,'transaction');
 assert.equal(properties.read(trade).type,'investmentTransaction');
 assert.equal(properties.read(trade).investmentType,undefined,'an optional investment field is not used for identity');
 assert.throws(()=>properties.write({kind:'transaction',type:'investmentTransaction',date:'2026-09-20'}),/type conflicts/);
 const lines=await h.store.readTransactionRecords();
 assert.equal(lines.length,2);assert.ok(lines.some(record=>record.line.includes('[type:: investmentTransaction]')));
 let writes=0;const process=h.app.fileManager.processFrontMatter;
 h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args);};
 await h.store.applyTransactions([tx,investment],[],[],structuredClone(state),paths);
 assert.equal(writes,0,'unchanged provider records do not reenter the write queue');
 await h.store.applyTransactions([],[{...investment,amount:-9}],[],structuredClone(state),paths);
 assert.equal(h.fm('investment-1.md').amount,-9);assert.ok(!('recordType'in h.fm('investment-1.md')));
 const legacy={...h.fm('investment-1.md'),recordType:'investmentTransaction'};
 properties.mutate(legacy,fields=>{fields.amount=-10;});
 assert.equal(legacy.amount,-10);assert.ok(!('recordType'in legacy));
 const cash=await h.manual.createAccount({kind:'cash',name:'Wallet',currency:'USD',value:20,valuationDate:'2026-09-20',purchaseTransaction:'',liabilityAccount:'',assetType:''});
 const manual=await h.manual.createCashEntry({title:'Coffee',amount:5,date:'2026-09-20',accountPath:cash.path,kind:'expense',category:'',tags:[],counterpart:'',linkedTransaction:''});
 assert.deepEqual(h.fm(manual.path).kind,['transaction/financial']);assert.ok(!('recordType'in h.fm(manual.path)));
 await h.store.writeSnapshot([account],[holding],paths,new Date('2026-09-20T12:00:00Z'));
 const position=h.fm('ABC — Bank Checking •1234.md');
 assert.deepEqual(position.kind,['entity/holding']);assert.equal(position.holdingType,'equity');assert.ok(!('recordType'in position));
 assert.equal(properties.read(position).type,'holding');
 const plugin=pluginHarness(h).plugin;plugin.settings.legacyTransactionDiscovery='atomic-only';
 plugin.getConnectedItems=()=>[];plugin.getRelayStatus=()=>null;plugin.getPlaidSetupStatus=()=>({state:'ready'});
 const model=await plugin.getDashboardModel();
 assert.ok(model.transactions.some(record=>record.financeId==='investment-1'&&record.type==='investmentTransaction'));
 assert.ok(model.transactions.some(record=>record.financeId==='tx1'&&record.type==='transaction'));
 assert.equal(model.holdings[0].type,'equity');
 const transactionsBase=parse(properties.base(atomicBase('','Transactions')));
 assert.match(transactionsBase.filters.and[0],/transaction\/financial/);
 assert.match(transactionsBase.filters.and[0],/transaction\/financial\/investment/);
 assert.doesNotMatch(transactionsBase.filters.and[0],/type|file\.hasTag/);
 const holdingsBase=parse(properties.base(atomicBase('','Holdings')));
 assert.match(holdingsBase.filters.and[0],/entity\/holding/);
 assert.doesNotMatch(holdingsBase.filters.and[0],/type|file\.hasTag/);
});
test('a read-only legacy transaction type alias identifies old Wallet notes without affecting distinct investment kinds',()=>{
 const codec=configurableListCodec();codec.setListKey('kind');
 codec.configure('finance-transaction','transaction/financial');
 codec.configure('investment-transaction','transaction/financial/investment');
 codec.addAlias('finance-transaction',{scalar:{key:'type',value:'transaction'}});
 const properties=new FinanceProperties(undefined,financeKindCodec(codec));
 const wallet={type:'transaction',financeId:'wallet-1',amount:-4,date:'2026-09-30'};
 assert.equal(properties.read(wallet).kind,'transaction');
 assert.equal(properties.read(wallet).type,'transaction');
 const migrated={...wallet};properties.mutate(migrated,fields=>{fields.amount=-5;});
 assert.deepEqual(migrated.kind,['transaction/financial']);
 assert.ok(!('type'in migrated));
 assert.equal(properties.read(migrated).type,'transaction');
 const investment={kind:['transaction/financial/investment'],financeId:'investment-1',amount:-10};
 assert.equal(properties.read(investment).kind,'investmentTransaction');
 assert.equal(properties.read(investment).type,'investmentTransaction');
 assert.ok(!('type'in properties.write({kind:'investmentTransaction',type:'investmentTransaction',financeId:'investment-2'})));
});
test('GCM v2 Finance sync and generated views follow configured mappings without losing rule order',async()=>{
 const codec=configurableListCodec(),h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:codec}};
 const paths=await h.store.upsertAccounts([account]);
 assert.deepEqual(h.fm(paths.get('account1')).classifications,['entity/bank']);
 await h.store.applyTransactions([tx],[],[],structuredClone(state),paths);
 assert.deepEqual(h.fm('tx1.md').classifications,['transaction/money']);assert.equal(h.fm('tx1.md').when,'2026-09-20');assert.ok(!('date'in h.fm('tx1.md')));
 await h.store.updateTransactionMetadata('tx1','Dining',['food']);
 assert.equal((await h.store.readTransactionRecords('metadata')).length,1);
 const existing=h.files.get('tx1.md');await h.app.fileManager.processFrontMatter(existing,raw=>{raw.classifications.push('user/other');});
 await h.store.applyTransactions([],[{...tx,amount:-7}],[],structuredClone(state),paths);
 assert.deepEqual(h.fm('tx1.md').classifications,['transaction/money','user/other']);
 await h.store.createRule({id:'rule',name:'Coffee rule',enabled:true,priority:7,accountContains:'',nameContains:'Coffee',merchantContains:'',minAmount:null,maxAmount:null,category:'Food',tags:[]});
 assert.equal(h.store.readRules()[0].priority,7);assert.equal(h.fm('Coffee rule.md').priority,7);assert.deepEqual(h.fm('Coffee rule.md').classifications,['note/rule']);
 await h.store.saveBudgetEntry({id:'budget',name:'Food budget',bucket:'category',category:'Food',monthlyLimit:100,currency:'USD',accounts:[]});
 assert.deepEqual(h.fm('Food budget.md').classifications,['note/budget']);assert.equal((await h.store.readBudgetEntries())[0].id,'budget');
 await h.store.writeSnapshot([account],[holding],paths,new Date('2026-09-20T12:00:00Z'));
 assert.deepEqual(h.fm('ABC — Bank Checking •1234.md').classifications,['entity/position']);
 const snapshot=await new FinanceStore(h.app,'').writeSnapshot([],[],new Map(),new Date('2026-09-20T12:00:00Z'));
 assert.deepEqual(h.fm(snapshot).classifications,['note/snapshot']);assert.equal(h.fm(snapshot).when,'2026-09-20');
 const manual=await h.manual.createAccount({kind:'cash',name:'Wallet',currency:'USD',value:20,valuationDate:'2026-09-20',purchaseTransaction:'',liabilityAccount:'',assetType:''});
 assert.deepEqual(h.fm(manual.path).classifications,['entity/bank']);
 const base=parse(financeProperties(h.app).base(atomicBase('','Transactions')));
 assert.equal(base.views[0].sort[0].property,'when');assert.ok(base.views[0].order.includes('when'));
 const accountBase=parse(financeProperties(h.app).base(accountsBaseBody('')));
 assert.match(accountBase.filters.and[0],/classifications.*contains.*entity\/bank/);
 assert.doesNotMatch(accountBase.filters.and[0],/kind.*account|kind\/account\/entity/);
});
test('GCM v2 reads old account and transaction markers before migration without duplicating an account',async()=>{
 const codec=configurableListCodec(),h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:codec}};
 await h.add('Accounts/Old.md',{kind:'account',financeAccountId:'account1',title:'Old account',accountName:'Checking',accountType:'depository',currency:'USD'},'Keep account body\n');
 await h.add('Transactions/Old.md',{type:'transaction',financeId:'old-tx',financeAccountId:'account1',account:'[[Accounts/Old]]',date:'2026-09-18',amount:-3,currency:'USD',tags:['kind/financial/transaction']},'Keep transaction body\n');
 assert.equal((await h.store.readTransactionRecords('metadata')).length,1);
 const paths=await h.store.upsertAccounts([account]);assert.equal(paths.get('account1'),'Accounts/Old.md');
 assert.equal(h.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('Accounts/')).length,1);
 assert.deepEqual(h.fm('Accounts/Old.md').classifications,['entity/bank']);assert.match(h.contents.get('Accounts/Old.md'),/Keep account body/);
 assert.equal(financeProperties(h.app).read(h.fm('Transactions/Old.md')).date,'2026-09-18');
 assert.equal(financeProperties(h.app).read(h.fm('Transactions/Old.md')).kind,'transaction');
});
test('GCM v2 refuses dated Finance writes when Scheduled is unconfigured, while legacy dates stay readable',async()=>{
 const codec=configurableListCodec(),h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:codec}};
 const paths=await h.store.upsertAccounts([account]);
 codec.setScheduleKey(null);
 const properties=financeProperties(h.app);
 assert.equal(properties.read({kind:'transaction',date:'2026-09-20'}).date,'2026-09-20');
 assert.throws(()=>properties.write({kind:'transaction',type:'transaction',date:'2026-09-20'}),/Configure the Scheduled custom-property key/);
 const before=new Map(h.contents);
 await assert.rejects(h.store.applyTransactions([tx],[],[],structuredClone(state),paths),/Configure the Scheduled custom-property key/);
 assert.deepEqual(h.contents,before);
 assert.ok(!h.files.has('tx1.md'));
});
test('GCM v2 disabled classification writers refuse Finance note creation without a fallback path',async()=>{
 const codec=configurableListCodec(),h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:codec}};
 const paths=await h.store.upsertAccounts([account]);
 await h.store.ensureStructure();
 codec.setWriterEnabled('finance-transaction',false);
 assert.equal(financeProperties(h.app).read({kind:'transaction',date:'2026-09-18'}).kind,'transaction');
 const before=new Map(h.contents);
 await assert.rejects(h.store.applyTransactions([tx],[],[],structuredClone(state),paths),/Writer disabled for finance-transaction/);
 assert.deepEqual(h.contents,before);
 assert.ok(!h.files.has('tx1.md'));
});
test('repeated GCM v2 transaction display reads do not enter the note write queue',async()=>{
 const h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:configurableListCodec()}};
 const paths=await h.store.upsertAccounts([account]);await h.store.applyTransactions([tx],[],[],structuredClone(state),paths);
 for(let i=0;i<128;i++)await h.add(`Inbox/Unrelated ${i}.md`,{title:`Unrelated ${i}`,kind:['note/other']});
 let scans=0,cached=0,fresh=0,writes=0;
 const list=h.app.vault.getMarkdownFiles,read=h.app.vault.cachedRead,disk=h.app.vault.read,process=h.app.fileManager.processFrontMatter;
 h.app.vault.getMarkdownFiles=()=>{scans++;return list();};
 h.app.vault.cachedRead=async file=>{cached++;return read(file);};h.app.vault.read=async file=>{fresh++;return disk(file);};
 h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args);};
 for(let i=0;i<3;i++)assert.deepEqual((await h.store.readTransactionRecords('metadata')).map(row=>row.path),['tx1.md']);
 assert.deepEqual({scans,cached,fresh,writes},{scans:3,cached:0,fresh:0,writes:0});
});
test('classification change previews only exact generated Bases and leaves customized Bases alone',async()=>{
 const h=harness();
 const definitions={account:{tag:'kind/finance/account'}};
 h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:{definition:k=>definitions[k]||null,encode:f=>f,decode:f=>f}}};
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
test('GCM v2 classification previews generated Bases with the proposed primary list path only',async()=>{
 const codec=configurableListCodec(),h=harness();h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:codec}};
 await h.store.ensureStructure();
 const from=codec.definition('account');
 const before=h.contents.get('Accounts.base');
 const changes=await previewGeneratedBaseClassificationChange(h.app,'',{recordKind:'account',from,to:{kindList:{key:'classifications',value:'entity/new-choice'}}});
 const accountChange=changes.find(change=>change.path==='Accounts.base');
 assert.ok(accountChange);assert.equal(accountChange.before,before);
 assert.match(accountChange.after,/entity\/new-choice/);
 assert.doesNotMatch(accountChange.after,/kind.*account|kind\/account\/entity/);
 assert.equal(h.contents.get('Accounts.base'),before);
});
test('finance classification rejects subkind keys owned by finance fields or record IDs',async()=>{
 const h=harness(new FinanceProperties({keys:{amount:'totalAmount'}}));
 const from={tag:'kind/finance/transaction'};
 h.app.plugins.plugins['tps-global-context-menu']={settings:{nativeRecordIdentityPropertyKey:'recordId'},api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'recordId'})},frontmatterKinds:{definition:k=>k==='finance-transaction'?from:null,encode:f=>f,decode:f=>f}}};
 const change=key=>({recordKind:'finance-transaction',from,to:{parentKind:'transaction',key,value:'financial'}});
 for(const key of ['AMOUNT','totalamount','FINANCEID','financeaccountid','FINANCEBUDGETID','FINANCERULEID','SECURITYID','recordID','TPSID']){
  await assert.rejects(previewGeneratedBaseClassificationChange(h.app,'',change(key)),/conflicts with a Finance field or record ID/,key);
 }
 assert.deepEqual(await previewGeneratedBaseClassificationChange(h.app,'',change('transactionKind')),[]);
 assert.deepEqual(await previewGeneratedBaseClassificationChange(h.app,'',{...change('AMOUNT'),recordKind:'other'}),[]);
});


test('dashboard collects exact contributing paths without treating inline entries as records',async()=>{
 for(const properties of [new FinanceProperties(),mapped()]){
  const h=harness(properties),paths=await h.store.upsertAccounts([account]);await h.store.applyTransactions([tx],[],[],state,paths);await h.store.writeSnapshot([account],[holding],paths,new Date('2026-09-20T12:00:00Z'));
  const ledger=new FinanceStore(h.app,'');const snapshot=await ledger.writeSnapshot([],[],new Map(),new Date('2026-09-20T12:00:00Z'));
  await h.store.createRule({id:'rule',name:'Rule',enabled:true,priority:1,accountContains:'',nameContains:'Coffee',merchantContains:'',minAmount:null,maxAmount:null,category:'Food',tags:[]});await h.store.createBudget({id:'budget',name:'Budget',category:'Food',monthlyLimit:100});
  await h.app.vault.create('Journal.md',`- Old [type:: transaction] [financeId:: legacy] [date:: 2026-09-20] [account:: [[${paths.get('account1').slice(0,-3)}]]] [amount:: -2] [currency:: USD]`);await h.add('Unrelated.md',{title:'Unrelated'});
  const p=new FinancePlugin(h.app);p.settings={...h.plugin.settings,financeFolder:'',recordMode:'atomic-note'};p.getConnectedItems=()=>[];p.getRelayStatus=()=>null;p.getPlaidSetupStatus=()=>({state:'ready'});
  let reads=0,scans=0;const read=h.app.vault.cachedRead,list=h.app.vault.getMarkdownFiles;h.app.vault.cachedRead=async f=>{reads++;return read(f)};h.app.vault.getMarkdownFiles=()=>{scans++;return list()};
  const without=await p.getDashboardModel(),baseline={reads,scans};reads=0;scans=0;const sources=new Set(),withSources=await p.getDashboardModel(sources);assert.deepEqual(withSources,without);assert.deepEqual({reads,scans},baseline,'dependency collection adds no I/O');
  const expected=h.app.vault.getMarkdownFiles().map(f=>f.path).filter(path=>path!=='Unrelated.md'&&path!=='Journal.md');assert.deepEqual([...sources].sort(),expected.sort());assert.ok(sources.has(snapshot));assert.ok(!sources.has('Journal.md'));
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
test('model snapshot preserves complete source and indexed results with mapped GCM kinds in root and folder modes',async()=>{
 const defs={account:{parentKind:'entity',key:'entityKind',value:'account'},'finance-transaction':{parentKind:'transaction',key:'transactionKind',value:'financial'},holding:{parentKind:'entity',key:'entityKind',value:'holding'},'finance-rule':{parentKind:'rule',key:'ruleKind',value:'finance'},'finance-budget':{parentKind:'budget',key:'budgetKind',value:'finance'}};
 const codec={definition:k=>defs[k]||null,encode:f=>{const d=defs[f.kind];return d?{...f,kind:d.parentKind,[d.key]:d.value}:{...f}},decode:f=>{const entry=Object.entries(defs).find(([,d])=>f.kind===d.parentKind&&f[d.key]===d.value);if(!entry)return {...f};const result={...f,kind:entry[0]};delete result[entry[1].key];return result}};
 for(const folder of ['', 'Finances']){
  const h=harness(mapped()),p=pluginHarness(h);p.plugin.settings.financeFolder=folder;await p.plugin.reviewLegacyTransactionMarkers();
  h.app.plugins.plugins['tps-global-context-menu']={api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:codec}};
  const prefix=folder?`${folder}/`:'';
  const add=(section,name,fields)=>h.add(`${prefix}${section}/${name}.md`,financeProperties(h.app).write(fields));
  await add('Accounts','Checking',{kind:'account',financeAccountId:'checking',accountName:'Checking',accountType:'depository',accountSubtype:'checking',currency:'USD',current:100,available:100});
  await add('Holdings','Fund',{kind:'holding',type:'holding',financeAccountId:'checking',securityId:'fund',name:'Fund',ticker:'FND',quantity:2,price:50,value:100,currency:'USD',active:true});
  await add('Transactions','Coffee',{...classificationFields('coffee',{account:`[[${prefix}Accounts/Checking]]`,categoryOverride:'Dining',tags:['cafe']}),kind:'transaction'});
  await add('Rules','Coffee rule',{kind:'financeRule',financeRuleId:'rule',title:'Coffee rule',enabled:true,priority:1,nameContains:'Coffee',category:'Dining',tags:['matched']});
  await add('Budgets','Dining',{kind:'financeBudget',financeBudgetId:'budget',title:'Dining',category:'Dining',monthlyLimit:100,currency:'USD'});
  await add('Snapshots','Latest',{type:'financeSnapshot',date:'2026-09-20'});
  const sourcePaths=new Set(),indexedPaths=new Set();
  const source=await p.plugin.getDashboardModel(sourcePaths,'source');
  const indexed=await p.plugin.getDashboardModel(indexedPaths,'metadata');
  assert.deepEqual(indexed,source,`${folder||'root'} indexed model matches current source`);
  assert.deepEqual([...indexedPaths].sort(),[...sourcePaths].sort());
  assert.deepEqual([...indexedPaths].sort(),['Accounts/Checking','Budgets/Dining','Holdings/Fund','Rules/Coffee rule','Snapshots/Latest','Transactions/Coffee'].map(path=>`${prefix}${path}.md`).sort());
  assert.equal(indexed.accounts.length,1);assert.equal(indexed.accounts[0].financeAccountId,'checking');assert.equal(indexed.accounts[0].current,100);
  assert.equal(indexed.holdings.length,1);assert.equal(indexed.holdings[0].securityId,'fund');assert.equal(indexed.holdings[0].value,100);
  assert.equal(indexed.transactions.length,1);assert.equal(indexed.transactions[0].financeId,'coffee');assert.equal(indexed.transactions[0].category,'Dining');
  assert.equal(indexed.transactions[0].ruleId,'rule');assert.deepEqual(indexed.transactions[0].tags,['#cafe','#matched']);
  assert.equal(indexed.budgetEntries?.length,1);assert.equal(indexed.budgetEntries[0].id,'budget');assert.equal(indexed.budgets.length,1);
 }
});
test('root ambiguous budget metadata still reads source and stale ordinary metadata waits for indexing',async()=>{
 const h=harness(),p=pluginHarness(h);await p.plugin.reviewLegacyTransactionMarkers();
 const ambiguous=await h.add('Budgets/Ambiguous.md',{kind:'financeBudget',financeBudgetId:'ambiguous',title:'Ambiguous',category:'Dining',monthlyLimit:20});
 const stale=await h.add('Budgets/Stale.md',{kind:'financeBudget',financeBudgetId:'stale',title:'Stale',category:'Dining',monthlyLimit:30});
 const originalCache=h.app.metadataCache.getFileCache,originalRead=h.app.vault.cachedRead;
 h.app.metadataCache.getFileCache=file=>file===ambiguous?null:file===stale?{frontmatter:{kind:'task'}}:originalCache(file);
 const paths=[];h.app.vault.cachedRead=async file=>{paths.push(file.path);return originalRead(file)};
 const first=await p.plugin.getDashboardModel(new Set(),'metadata');
 assert.deepEqual(first.budgetEntries?.map(entry=>entry.id),['ambiguous']);
 assert.deepEqual(paths,['Budgets/Ambiguous.md','Budgets/Ambiguous.md'],'an unindexed root note is inspected for atomic identity and budget content');
 h.app.metadataCache.getFileCache=file=>file===ambiguous?null:originalCache(file);
 paths.length=0;
 const second=await p.plugin.getDashboardModel(new Set(),'metadata');
 assert.deepEqual(second.budgetEntries?.map(entry=>entry.id).sort(),['ambiguous','stale']);
 assert.deepEqual(paths,['Budgets/Ambiguous.md','Budgets/Ambiguous.md']);
});
