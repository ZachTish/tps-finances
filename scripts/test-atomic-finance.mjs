import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse as parseYaml} from 'yaml';
globalThis.AtomicQAParseYaml=parseYaml;
class File {constructor(path){this.path=path;this.basename=path.split('/').at(-1).replace(/\.md$/,'');this.extension=path.split('.').at(-1);}}
globalThis.AtomicQAFile=File;
const output=await build({entryPoints:['src/atomic-finance-store.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export class App{};export const TFile=globalThis.AtomicQAFile;export const normalizePath=s=>s;export const parseYaml=s=>globalThis.AtomicQAParseYaml(s);export const stringifyYaml=s=>JSON.stringify(s)+'\\n';`}));}}]});
const {AtomicFinanceStore,legacyFields}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
function harness(){
 const nodes=new Map(),text=new Map();let failTrash=false,failSource=false;
 const fm=p=>{const m=(text.get(p)||'').match(/^---\n([\s\S]*?)\n---/);return !m?{}:m[1].trim().startsWith('{')?JSON.parse(m[1]):Object.fromEntries(m[1].split('\n').map(line=>{const i=line.indexOf(':');return [line.slice(0,i),line.slice(i+1).trim()]}))};
 const vault={getAbstractFileByPath:p=>nodes.get(p),getMarkdownFiles:()=>[...nodes.values()].filter(n=>n instanceof File&&n.path.endsWith('.md')),createFolder:async p=>nodes.set(p,{path:p}),create:async(p,c)=>{if(nodes.has(p))throw Error('occupied');const f=new File(p);nodes.set(p,f);text.set(p,c);return f;},read:async f=>text.get(f.path),cachedRead:async f=>text.get(f.path),process:async(f,fn)=>{if(failSource&&f.path==='Day.md')throw Error('source write failure');const next=fn(text.get(f.path));text.set(f.path,next);return next;}};
 const app={vault,metadataCache:{getFileCache:f=>({frontmatter:fm(f.path)})},fileManager:{processFrontMatter:async(f,fn)=>{const old=text.get(f.path),data=fm(f.path);fn(data);text.set(f.path,'---\n'+JSON.stringify(data)+'\n---\n'+old.replace(/^---\n[\s\S]*?\n---\n/,''));},trashFile:async f=>{if(failTrash)throw Error('trash failure');nodes.delete(f.path);text.delete(f.path);}}};
 return {app,nodes,text,fm,store:new AtomicFinanceStore(app,'Finances'),failTrash:()=>failTrash=true,failSource:()=>failSource=true,restoreSource:()=>failSource=false};
}
const tx={financeId:'local-1',providerTransactionId:'provider-1',financeAccountId:'account-1',date:'2026-09-13',authorizedDate:'2026-09-12',name:'Groceries',merchantName:'Market',amount:-12.5,currency:'USD',pending:true,category:'FOOD',categoryDetail:'GROCERY',subtype:'',kind:'transaction'};
const path='Finances/Transactions/local-1.md';


const line='- Market [type:: transaction] [financeId:: old-1] [date:: 2026-09-13] [account:: [[Finances/Accounts/Checking]]] [amount:: -20] [currency:: USD] [pending:: false] [tags:: food/healthy]';
async function legacy(h){await h.app.vault.create('Finances/Accounts/Checking.md','---\n'+JSON.stringify({kind:'account'})+'\n---\n');await h.app.vault.create('Day.md','Keep my introduction\n'+line+'\nKeep my ending\n');}
test('legacy conversion preserves source context and writes ordinary link',async()=>{const h=harness();await legacy(h);const result=await h.store.migrateLegacyTransactionLedgers();assert.equal(result.moved,1);assert.equal(h.fm('Finances/Transactions/old-1.md').amount,-20);assert.deepEqual(h.fm('Finances/Transactions/old-1.md').tags,['food/healthy']);assert.equal(h.text.get('Day.md'),'Keep my introduction\n- [[Finances/Transactions/old-1]]\nKeep my ending\n');assert.equal((await h.store.migrateLegacyTransactionLedgers()).moved,0);});
test('interrupted source replacement resumes using verified existing destination',async()=>{const h=harness();await legacy(h);h.failSource();await assert.rejects(h.store.migrateLegacyTransactionLedgers(),/source write failure/);assert.match(h.text.get('Day.md'),/financeId:: old-1/);assert.ok(h.nodes.has('Finances/Transactions/old-1.md'));h.restoreSource();assert.equal((await h.store.migrateLegacyTransactionLedgers()).moved,1);});
test('ambiguous migrated identity preserves both representations',async()=>{const h=harness();await legacy(h);await seedExistingTransactions(h, [{...tx,financeId:'old-1'}]);const r=await h.store.migrateLegacyTransactionLedgers();assert.equal(r.skipped,1);assert.match(h.text.get('Day.md'),/financeId:: old-1/);});
test('legacy conversion rejects an invalid amount',async()=>{const h=harness();assert.equal(legacyFields(line.replace('-20','nonsense')),null);});
test('atomic Bases use core table view; customized legacy Base is preserved',async()=>{const h=harness();await h.app.vault.create('Finances/Transactions.base','custom base');await h.store.ensureStructure();assert.equal(h.text.get('Finances/Transactions.base'),'custom base');const base=JSON.parse(h.text.get('Finances/Transactions (Atomic notes).base'));assert.equal(base.views[0].type,'table');assert.match(base.filters.and[0],/Finances\/Transactions/);});
test('edited destination after interrupted migration prevents source retirement',async()=>{const h=harness();await legacy(h);h.failSource();await assert.rejects(h.store.migrateLegacyTransactionLedgers());h.restoreSource();await h.app.fileManager.processFrontMatter(h.nodes.get('Finances/Transactions/old-1.md'),fm=>{fm.amount=-100;});assert.equal((await h.store.migrateLegacyTransactionLedgers()).skipped,1);assert.match(h.text.get('Day.md'),/financeId:: old-1/);});

test('migration refreshes legacy records created after an earlier dashboard read',async()=>{const h=harness();await h.store.readTransactionRecords();await legacy(h);assert.equal((await h.store.migrateLegacyTransactionLedgers()).moved,1);});

test('atomic dashboard excludes records owned by a different finance collection',async()=>{
 const h=harness();await seedExistingTransactions(h, [tx]);
 const other=JSON.parse(h.text.get(path).match(/^---\n([\s\S]*?)\n---/)[1]);other.id='elsewhere';other.account='[[Other/Accounts/Checking]]';
 await h.app.vault.create('Other/Transactions/elsewhere.md','---\n'+JSON.stringify(other)+'\n---\n');
 assert.equal((await h.store.readTransactionRecords()).length,1);
});

test('root rules and budgets are typed and do not overwrite ordinary notes',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 await h.app.vault.create('Personal.md','---\n'+JSON.stringify({category:'Food',monthlyLimit:100,tags:['personal'],date:'2099-01-01'})+'\n---\n');
 await root.createBudget({id:'budget',name:'Food budget',category:'Food',monthlyLimit:500});
 await root.createRule({id:'rule',name:'Food rule',enabled:true,priority:100,accountContains:'',nameContains:'Market',merchantContains:'',minAmount:null,maxAmount:null,category:'Food',tags:[]});
 assert.equal(root.readRules().length,1);assert.equal(root.readBudgets().length,1);
 assert.ok(h.nodes.has('Food budget.md'));assert.ok(h.nodes.has('Food rule.md'));
});

test('parallel identity reads preserve the vault order of dashboard records',async()=>{
 const h=harness();await seedExistingTransactions(h, [tx,{...tx,financeId:'second'}]);
 const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{if(file.path===path)await new Promise(resolve=>setTimeout(resolve,5));return read(file);};
 assert.deepEqual((await h.store.readTransactionRecords()).map(r=>r.path),[path,'Finances/Transactions/second.md']);
});

async function oldTitle(h,title='BANK MARKET 1234') {
 await seedExistingTransactions(h, [tx]);
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>{f.title=title;delete f.providerName;delete f.providerTitle;});
}
test('unknown legacy titles need explicit review and preview performs no writes',async()=>{
 const h=harness();await oldTitle(h);const before=new Map(h.text);
 const [change]=await h.store.reviewTransactionTitles();assert.equal(change.before,'BANK MARKET 1234');assert.equal(change.after,'Market');assert.deepEqual(h.text,before);
 h.text.set(path,h.text.get(path)+'Receipt details');
 await h.store.applyTransactionTitle(change);
 assert.equal(h.fm(path).title,'Market');assert.equal(h.fm(path).providerName,'BANK MARKET 1234');assert.equal(h.fm(path).providerTitle,'Market');assert.match(h.text.get(path),/Receipt details/);
 assert.deepEqual(await h.store.reviewTransactionTitles(),[]);
});
test('review detects changed titles, merchants, identities, and paths without overwriting them',async()=>{
 for(const [key,value] of [['title','Changed'],['merchant','Another'],['id','other'],['financeSource','manual'],['account','[[Elsewhere]]']]) {
  const h=harness();await oldTitle(h);const [change]=await h.store.reviewTransactionTitles();
  await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>f[key]=value);const before=new Map(h.text);
  await assert.rejects(h.store.applyTransactionTitle(change),/Transaction changed/);assert.deepEqual(h.text,before);
 }
 const h=harness();await oldTitle(h);const [change]=await h.store.reviewTransactionTitles();h.nodes.delete(path);await assert.rejects(h.store.applyTransactionTitle(change),/moved or disappeared/);
});
test('manual records are excluded from title review',async()=>{
 const h=harness();await oldTitle(h);await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>f.financeSource='manual');
 assert.deepEqual(await h.store.reviewTransactionTitles(),[]);const before=new Map(h.text);
 assert.deepEqual(h.text,before);
});
test('failed review writes leave the proposal reusable',async()=>{
 const h=harness();await oldTitle(h);const [change]=await h.store.reviewTransactionTitles(),process=h.app.fileManager.processFrontMatter;
 h.app.fileManager.processFrontMatter=async()=>{throw Error('disk failed')};await assert.rejects(h.store.applyTransactionTitle(change),/disk failed/);
 h.app.fileManager.processFrontMatter=process;await h.store.applyTransactionTitle(change);assert.equal(h.fm(path).title,'Market');
});

test('record review removes empty placeholders without changing custom titles, user fields, body or financial values',async()=>{
 const h=harness();await seedExistingTransactions(h, [tx]);
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>Object.assign(f,{
  title:'Weekly groceries',securityId:'',quantity:null,price:null,fees:0,investmentType:'  ',customEmpty:'',
  tags:['food'],categoryOverride:'Groceries',pending:false
 }));
 h.text.set(path,h.text.get(path)+'Keep [[Receipt]] and this body.\n');
 const before=h.fm(path),content=new Map(h.text);
 assert.deepEqual(await h.store.reviewTransactionTitles(),[]);
 const [change]=await h.store.reviewTransactionTitles(true);
 assert.deepEqual(h.text,content);assert.equal(change.before,change.after);
 assert.deepEqual(change.removeFields,['securityId','quantity','price','investmentType']);
 await h.store.applyTransactionTitle(change);
 const expected={...before};for(const key of change.removeFields)delete expected[key];
 assert.deepEqual(h.fm(path),expected);assert.match(h.text.get(path),/Keep \[\[Receipt\]\] and this body/);
 assert.deepEqual(await h.store.reviewTransactionTitles(true),[]);
});

test('record cleanup refuses newly populated fields including zero and changes during the atomic callback',async()=>{
 for(const value of [0,2,'ABC']) {
  const h=harness();await seedExistingTransactions(h, [tx]);
  await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>f.quantity=null);
  const [change]=await h.store.reviewTransactionTitles(true);
  const process=h.app.fileManager.processFrontMatter;
  h.app.fileManager.processFrontMatter=async(file,update)=>{await process(file,f=>f.quantity=value);return process(file,update);};
  await assert.rejects(h.store.applyTransactionTitle(change),/Transaction changed/);assert.equal(h.fm(path).quantity,value);
 }
});

test('record cleanup refuses fields outside its allowlist even if a proposal is altered',async()=>{
 const h=harness();await oldTitle(h);await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>f.customEmpty='');
 const [change]=await h.store.reviewTransactionTitles(true);const before=new Map(h.text);
 await assert.rejects(h.store.applyTransactionTitle({...change,removeFields:['customEmpty']}),/Transaction changed/);
 assert.deepEqual(h.text,before);
});

test('manual notes remain outside record cleanup even with empty provider-like properties',async()=>{
 const h=harness();await oldTitle(h);
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>{f.financeSource='manual';f.quantity=null;});
 const before=new Map(h.text);assert.deepEqual(await h.store.reviewTransactionTitles(true),[]);assert.deepEqual(h.text,before);
});

test('title review also normalizes untracked transfer and investment descriptions without discarding trade details',async()=>{
 for(const kind of ['transaction','investmentTransaction']) {
  const h=harness();await seedExistingTransactions(h, [{...tx,kind,merchantName:''}]);
  await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>{f.title='  BUY   2 ABC / TRANSFER  ';delete f.providerTitle;delete f.providerName;});
  const [change]=await h.store.reviewTransactionTitles();assert.equal(change.after,'BUY 2 ABC / TRANSFER');
  await h.store.applyTransactionTitle(change);assert.equal(h.fm(path).providerName,'  BUY   2 ABC / TRANSFER  ');
  assert.equal(h.fm(path).title,'BUY 2 ABC / TRANSFER');
 }
});

test('missing untracked titles can be restored only when a provider description exists',async()=>{
 const h=harness();await seedExistingTransactions(h, [{...tx,merchantName:'',name:'ATM withdrawal'}]);
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>{delete f.title;delete f.providerTitle;});
 const [change]=await h.store.reviewTransactionTitles();assert.equal(change.after,'ATM withdrawal');
 await h.store.applyTransactionTitle(change);assert.equal(h.fm(path).title,'ATM withdrawal');
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>{delete f.title;delete f.providerTitle;delete f.providerName;});
 assert.deepEqual(await h.store.reviewTransactionTitles(),[]);
});

test('candidate discovery validates configuration once without decoding unrelated notes',async()=>{
 const h=harness();let decoded=0,configurationReads=0,reads=0,scans=0;
 h.app.plugins={plugins:{'tps-finances':{settings:{get propertyNames(){configurationReads++;return {keys:{amount:'money'}};}}},'tps-global-context-menu':{settings:{nativeRecordIdentityPropertyKey:'id'},api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'id'})},frontmatterKinds:{definition:()=>null,encode:f=>f,decode:f=>{decoded++;return f;}}}}}};
 for(let i=0;i<512;i++)await h.app.vault.create(`Inbox/Ordinary ${i}.md`,'---\n'+JSON.stringify({title:`Ordinary ${i}`,tags:['ordinary']})+'\n---\nBody\n');
 const getFiles=h.app.vault.getMarkdownFiles;h.app.vault.getMarkdownFiles=()=>{scans++;return getFiles();};
 const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async f=>{reads++;return read(f);};
 assert.equal((await h.store.index()).size,0);assert.equal((await h.store.index()).size,0);
 assert.equal(scans,2);assert.equal(reads,0);assert.equal(decoded,0);assert.equal(configurationReads,2);
});

test('fixed identity candidates still read current mapped fields and ignore stale metadata values',async()=>{
 const h=harness();h.app.plugins={plugins:{'tps-finances':{settings:{propertyNames:{keys:{type:'recordType',amount:'money'}}}}}};
 const file=await h.app.vault.create('Inbox/Mapped.md','---\n'+JSON.stringify({financeId:'current-id',recordType:'transaction',money:-7,account:'[[Finances/Accounts/Checking]]'})+'\n---\nKeep body\n');
 h.app.metadataCache.getFileCache=()=>({frontmatter:{financeId:'old-id',recordType:'other',money:999}});
 const fields=new Map(),index=await h.store.index(fields);
 assert.equal(index.get('current-id'),file);assert.equal(index.has('old-id'),false);assert.equal(fields.get(file).amount,-7);
 assert.equal(fields.get(file).type,'transaction');assert.match(h.text.get(file.path),/Keep body/);
});

test('transaction-folder candidates remain readable before metadata indexing',async()=>{
 const h=harness();const file=await h.app.vault.create(path,'---\n'+JSON.stringify({financeId:'fresh',type:'transaction',account:'[[Finances/Accounts/Checking]]'})+'\n---\n');
 h.app.metadataCache.getFileCache=()=>null;
 assert.equal((await h.store.index()).get('fresh'),file);
});

test('candidate discovery retains configuration and mid-read migration guards',async()=>{
 const h=harness(),settings={propertyNames:{keys:{}},propertyMigration:null};h.app.plugins={plugins:{'tps-finances':{settings}}};
 await h.app.vault.create('Inbox/Ordinary.md','Body');settings.propertyMigration={pending:true};
 await assert.rejects(h.store.index(),/Resume the property migration/);settings.propertyMigration=null;
 settings.propertyNames={keys:{type:'financeId'}};await assert.rejects(h.store.index(),/plain, nonempty property name/);
 settings.propertyNames={keys:{}};await h.app.vault.create(path,'---\n'+JSON.stringify({financeId:'fresh',type:'transaction'})+'\n---\n');
 const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async f=>{const source=await read(f);settings.propertyMigration={pending:true};return source;};
 await assert.rejects(h.store.index(),/Resume the property migration/);
});

test('legacy inspection avoids line splitting for repeated marker-free bodies',()=>{
 const h=harness(),index={recordsById:new Map(),idsByPath:new Map(),fileOrder:new Map(),nextFileOrder:0};
 const source=Array.from({length:1000},(_,i)=>`Ordinary paragraph ${i}`).join('\n');let splits=0;
 const split=String.prototype.split;
 String.prototype.split=function(...args){if(String(this)===source)splits++;return split.apply(this,args);};
 try{for(let i=0;i<100;i++)h.store.indexTransactionFile(index,`Inbox/Note ${i}.md`,source);}finally{String.prototype.split=split;}
 assert.equal(splits,0);assert.equal(index.recordsById.size,0);assert.equal(index.idsByPath.size,0);assert.equal(index.fileOrder.size,100);
});

test('marker-free replacement removes old legacy ownership while preserving duplicate order',()=>{
 const h=harness(),index={recordsById:new Map(),idsByPath:new Map(),fileOrder:new Map(),nextFileOrder:0};
 h.store.indexTransactionFile(index,'First.md',`Introduction\n${line}\n`);
 h.store.indexTransactionFile(index,'Second.md',`${line}\n`);
 assert.deepEqual(index.recordsById.get('old-1').map(r=>[r.path,r.lineNumber]),[['First.md',1],['Second.md',0]]);
 h.store.indexTransactionFile(index,'First.md','No transaction remains\n');
 assert.deepEqual(index.recordsById.get('old-1').map(r=>r.path),['Second.md']);assert.equal(index.idsByPath.has('First.md'),false);
 h.store.indexTransactionFile(index,'First.md',`${line}\n`);
 assert.deepEqual(index.recordsById.get('old-1').map(r=>r.path),['First.md','Second.md']);
});

test('indexed display bursts read atomic properties without source reparsing or inline bodies',async()=>{
 const h=harness();await seedExistingTransactions(h, Array.from({length:32},(_,i)=>({...tx,financeId:`display-${i}`,providerTransactionId:`display-provider-${i}`})));
 const expected=await h.store.readTransactionRecords();let reads=0,parses=0,writes=0;
 const read=h.app.vault.cachedRead,parse=globalThis.AtomicQAParseYaml,process=h.app.vault.process;
 h.app.vault.cachedRead=async f=>{reads++;return read(f)};globalThis.AtomicQAParseYaml=value=>{parses++;return parse(value)};h.app.vault.process=async(...args)=>{writes++;return process(...args)};
 try{for(let i=0;i<25;i++)assert.deepEqual(await h.store.readTransactionRecords('metadata'),expected)}
 finally{globalThis.AtomicQAParseYaml=parse}
 assert.deepEqual({reads,parses,writes},{reads:0,parses:0,writes:0});
});
test('indexed display ignores ordinary paragraphs and frontmatter without body reads',async()=>{
 const h=harness();await seedExistingTransactions(h, [tx]);
 for(let i=0;i<128;i++)await h.app.vault.create(`Notes/Plain ${i}.md`,`Ordinary paragraph ${i}\n`);
 for(let i=0;i<128;i++)await h.app.vault.create(`Notes/Frontmatter ${i}.md`,`---\ntitle: Ordinary ${i}\n---\n`);
 const expected=await h.store.readTransactionRecords();let reads=0;
 const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads++;return read(file)};
 for(let i=0;i<20;i++)assert.deepEqual(await h.store.readTransactionRecords('metadata'),expected);
 assert.equal(reads,0);
 await h.store.readTransactionRecords();assert.equal(reads,1,'only the atomic note is source-read');
});
test('whole-note discovery never follows inline lists even when metadata indexes them',async()=>{
 const h=harness();await legacy(h);
 const original=h.text.get('Day.md');
 await h.app.vault.create('Ordinary.md',line.replace('old-1','new-1')+'\n');
 let reads=[];const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads.push(file.path);return read(file)};
 assert.deepEqual(await h.store.readTransactionRecords('metadata'),[]);
 assert.deepEqual(await h.store.readTransactionRecords(),[]);
 assert.deepEqual(reads,[]);
 await seedExistingTransactions(h, [{...tx,financeId:'old-1'}]);
 reads=[];assert.deepEqual((await h.store.readTransactionRecords('metadata')).map(record=>record.path),['Finances/Transactions/old-1.md']);
 assert.deepEqual(reads,[]);assert.equal(h.text.get('Day.md'),original);
});
test('code, YAML and partial legacy metadata never become transaction records',async()=>{
 const h=harness();await h.app.vault.create('Finances/Accounts/Checking.md','---\n'+JSON.stringify({kind:'account'})+'\n---\n');
 for(const [path,content] of [
  ['Code.md','```text\n'+line+'\n```\n'],
  ['Yaml.md','---\nentries:\n'+line.replace('old-1','yaml-1')+'\n---\n'],
  ['Missing.md',line.replace('old-1','missing-1')+'\n'],
  ['Partial.md',line.replace('old-1','partial-1')+'\n'],
  ['Unknown.md',line.replace('old-1','unknown-1')+'\n']
 ])await h.app.vault.create(path,content);
 const reads=[];const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads.push(file.path);return read(file)};
 assert.deepEqual(await h.store.readTransactionRecords('metadata'),[]);
 assert.deepEqual(reads,[]);
});

test('line-storage display keeps immediate source authority despite stale no-list metadata',async()=>{
 const h=harness();await legacy(h);
 const FinanceStore=Object.getPrototypeOf(AtomicFinanceStore.prototype).constructor;
 const lineStore=new FinanceStore(h.app,'Finances');
 const originalCache=h.app.metadataCache.getFileCache;
 h.app.metadataCache.getFileCache=file=>file.path==='Day.md'
   ? {sections:[{type:'paragraph'}]}
   : originalCache(file);
 const reads=[];const read=h.app.vault.cachedRead;
 h.app.vault.cachedRead=async file=>{reads.push(file.path);return read(file);};
 const records=await lineStore.readTransactionRecords('metadata');
 assert.deepEqual(records.map(record=>record.path),['Day.md']);
 assert.ok(reads.includes('Day.md'),'line storage must not use the atomic display preflight');
});

test('display uses indexed values while ordinary readers and writes retain current-source authority',async()=>{
 const h=harness();await seedExistingTransactions(h, [tx]);const cached=structuredClone(h.fm(path));
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),fm=>{fm.amount=-47;fm.custom='Preserve current source';});
 h.app.metadataCache.getFileCache=()=>({frontmatter:cached});
 const displayed=await h.store.readTransactionRecords('metadata'),current=await h.store.readTransactionRecords();
 assert.equal(legacyFields(displayed[0].line).amount,-12.5);assert.equal(legacyFields(current[0].line).amount,-47);
 await h.store.updateTransactionMetadata(tx.financeId,'Food',['personal']);assert.equal(h.fm(path).amount,-47);assert.equal(h.fm(path).custom,'Preserve current source');
});

test('folder display reads a fresh atomic note once, then follows published metadata and rejects duplicates',async()=>{
 const h=harness();await seedExistingTransactions(h, [tx]);
 const only=new AtomicFinanceStore(h.app,'Finances');let cached=null,reads=0,writes=0;
 h.app.metadataCache.getFileCache=()=>cached;
 const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads++;return read(file);};
 const process=h.app.vault.process;h.app.vault.process=async(...args)=>{writes++;return process(...args);};
 assert.deepEqual((await only.readTransactionRecords('metadata')).map(record=>record.path),[path]);
 assert.equal(reads,1,'unindexed folder candidate is read from source');assert.equal(writes,0);
 reads=0;assert.equal((await only.readTransactionRecords()).length,1);assert.equal(reads,1);
 cached={frontmatter:structuredClone(h.fm(path))};reads=0;
 assert.equal((await only.readTransactionRecords('metadata')).length,1);assert.equal(reads,0);
 cached={frontmatter:{title:'Ordinary note'}};
 assert.equal((await only.readTransactionRecords('metadata')).length,0);assert.equal(reads,0);
 cached={frontmatter:structuredClone(h.fm(path))};
 assert.equal((await only.readTransactionRecords('metadata')).length,1);assert.equal(reads,0);
 await h.app.vault.create('Finances/Transactions/Duplicate.md',h.text.get(path));cached=null;reads=0;
 await assert.rejects(only.readTransactionRecords('metadata'),/Duplicate atomic transaction identity/);
 assert.equal(reads,2);assert.equal(writes,0);
});

test('indexed display ignores inline bodies while retaining duplicate atomic identity guards',async()=>{
 const h=harness();await seedExistingTransactions(h, [tx]);
 h.text.set(path,h.text.get(path)+'\n'+line);await h.app.vault.create('Journal.md',line.replace('old-1','local-1'));
 const records=await h.store.readTransactionRecords('metadata');assert.equal(records.length,1);assert.equal(records[0].path,path);assert.equal(legacyFields(records[0].line).amount,-12.5);
 await h.app.vault.create('Finances/Transactions/Duplicate.md',h.text.get(path));
 await assert.rejects(h.store.readTransactionRecords('metadata'),/Duplicate atomic transaction identity/);
 await assert.rejects(h.store.readTransactionRecords(),/Duplicate atomic transaction identity/);
});

test('indexed display retains migration and invalid-mapping guards',async()=>{
 const h=harness(),settings={propertyNames:{keys:{}},propertyMigration:{pending:true}};h.app.plugins={plugins:{'tps-finances':{settings}}};
 await assert.rejects(h.store.readTransactionRecords('metadata'),/Resume the property migration/);
 settings.propertyMigration=null;settings.propertyNames={keys:{amount:'financeId'}};
 await assert.rejects(h.store.readTransactionRecords('metadata'),/plain, nonempty property name/);
});

test('whole-note cold source and display reads scale with atomic notes, while duplicate IDs still fail',async()=>{
 const h=harness();await seedExistingTransactions(h, [tx]);
 await h.app.vault.create('Day.md',line);
 for(let n=0;n<1024;n++)await h.app.vault.create(`Archive/${n}.md`,'Ordinary note');
 const only=new AtomicFinanceStore(h.app,'Finances');
 let reads=0,fresh=0,writes=0;const cachedRead=h.app.vault.cachedRead,read=h.app.vault.read,process=h.app.vault.process;
 h.app.vault.cachedRead=async file=>{reads++;return cachedRead(file)};
 h.app.vault.read=async file=>{fresh++;return read(file)};
 h.app.vault.process=async(...args)=>{writes++;return process(...args)};
 assert.deepEqual((await only.readTransactionRecords()).map(record=>record.path),[path]);
 assert.equal(reads,1,'only the atomic source is read');assert.equal(fresh,0);assert.equal(writes,0);
 reads=0;assert.deepEqual((await only.readTransactionRecords('metadata')).map(record=>record.path),[path]);
 assert.equal(reads,0,'cached atomic metadata requires no note-body read');assert.equal(fresh,0);assert.equal(writes,0);
 await h.app.vault.create('Finances/Transactions/Duplicate.md',h.text.get(path));
 await assert.rejects(only.readTransactionRecords('metadata'),/Duplicate atomic transaction identity/);
 await assert.rejects(only.readTransactionRecords(),/Duplicate atomic transaction identity/);
});

test('root discovers an arbitrary-name atomic note before its metadata arrives without reading indexed ordinary bodies',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 const transaction='Inbox/An edited transaction title.md';
 await h.app.vault.create(transaction,'---\n'+JSON.stringify(transactionFixture({...tx,financeId:'cold-id'},'Checking.md'))+'\n---\nBody\n');
 for(let n=0;n<1024;n++)await h.app.vault.create(`Archive/Ordinary ${n}.md`,'---\n'+JSON.stringify({title:`Ordinary ${n}`})+'\n---\nBody\n');
 const cache=h.app.metadataCache.getFileCache;
 let indexed=false,reads=0,writes=0,scans=0;
 h.app.metadataCache.getFileCache=file=>file.path===transaction&&!indexed?null:cache(file);
 const getFiles=h.app.vault.getMarkdownFiles;h.app.vault.getMarkdownFiles=()=>{scans++;return getFiles();};
 const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads++;return read(file);};
 const process=h.app.vault.process;h.app.vault.process=async(...args)=>{writes++;return process(...args);};
 const source=await root.readTransactionRecords();
 assert.deepEqual(source.map(record=>record.path),[transaction]);
 assert.equal(legacyFields(source[0].line).amount,-12.5);
 assert.equal(reads,1);assert.equal(scans,1);assert.equal(writes,0);
 reads=0;
 const display=await root.readTransactionRecords('metadata');
 assert.deepEqual(display,source);
 assert.equal(reads,1,'only the missing-cache candidate needs a body read');assert.equal(scans,2);assert.equal(writes,0);
 await h.app.fileManager.processFrontMatter(h.nodes.get(transaction),fm=>fm.amount=-19);
 reads=0;
 assert.equal(legacyFields((await root.readTransactionRecords('metadata'))[0].line).amount,-19);
 assert.equal(reads,1,'an unpublished edit remains visible from its current source');
 indexed=true;reads=0;
 assert.equal(legacyFields((await root.readTransactionRecords('metadata'))[0].line).amount,-19);
 assert.equal(reads,0,'published metadata restores the zero-body-read display path');
 reads=0;
 assert.equal(legacyFields((await root.readTransactionRecords())[0].line).amount,-19);
 assert.equal(reads,1,'source callers continue verifying the atomic note');assert.equal(writes,0);
});

test('root reads the source when indexed metadata disappears during candidate discovery',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 const transaction='My transaction.md';
 const fields=transactionFixture({...tx,financeId:'vanishing-cache'},'Checking.md');
 await h.app.vault.create(transaction,'---\n'+JSON.stringify(fields)+'\n---\n');
 let lookups=0,reads=0;
 h.app.metadataCache.getFileCache=()=>++lookups===1?{frontmatter:fields}:null;
 const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads++;return read(file);};
 assert.deepEqual((await root.readTransactionRecords('metadata')).map(record=>record.path),[transaction]);
 assert.equal(lookups,2);assert.equal(reads,1);
});

test('root cold scan checks every unindexed file and catches duplicate atomic IDs before a write',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 const frontmatter=transactionFixture({...tx,financeId:'same-id'},'Checking.md');
 await h.app.vault.create('Inbox/First.md','---\n'+JSON.stringify(frontmatter)+'\n---\n');
 for(let n=0;n<128;n++)await h.app.vault.create(`Archive/Ordinary ${n}.md`,'Plain note\n');
 h.app.metadataCache.getFileCache=()=>null;
 let reads=0,writes=0;const read=h.app.vault.cachedRead;
 h.app.vault.cachedRead=async file=>{reads++;return read(file);};
 const process=h.app.vault.process;h.app.vault.process=async(...args)=>{writes++;return process(...args);};
 assert.deepEqual((await root.readTransactionRecords()).map(record=>record.path),['Inbox/First.md']);
 assert.equal(reads,129,'arbitrary filenames force one read per unindexed Markdown file');
 reads=0;assert.deepEqual((await root.readTransactionRecords('metadata')).map(record=>record.path),['Inbox/First.md']);
 assert.equal(reads,129,'display uses the same read-only discovery until metadata is published');
 await h.app.vault.create('Elsewhere/Second.md','---\n'+JSON.stringify(frontmatter)+'\n---\n');
 reads=0;await assert.rejects(root.readTransactionRecords(),/Duplicate atomic transaction identity/);
 assert.equal(reads,130);assert.equal(writes,0);
 reads=0;await assert.rejects(root.readTransactionRecords('metadata'),/Duplicate atomic transaction identity/);
 assert.equal(reads,130);assert.equal(writes,0);
});

test('root legacy migration reuses an arbitrary-name destination hidden by stale metadata',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 const legacyLine=line.replace('[[Finances/Accounts/Checking]]','[[Checking]]');
 const destination='Inbox/Previously migrated.md';
 await h.app.vault.create('Checking.md','---\n'+JSON.stringify({financeAccountId:'account-1'})+'\n---\n');
 await h.app.vault.create('Day.md',`Before\n${legacyLine}\nAfter\n`);
 await h.app.vault.create(destination,'---\n'+JSON.stringify({...legacyFields(legacyLine),migrationSource:legacyLine})+'\n---\nPreserve body\n');
 const metadata=h.app.metadataCache.getFileCache;
 h.app.metadataCache.getFileCache=file=>file.path===destination?{frontmatter:{title:'Old title'}}:metadata(file);
 const result=await root.migrateLegacyTransactionLedgers();
 assert.equal(result.moved,1);assert.equal(result.skipped,0);
 assert.equal(h.nodes.has('old-1.md'),false);assert.match(h.text.get(destination),/Preserve body/);
 assert.equal(h.text.get('Day.md'),`Before\n- [[Inbox/Previously migrated]]\nAfter\n`);
});



// Fixtures represent already-imported notes, without reconciliation or provider I/O.
function transactionFixture(t,accountPath) {
 return {kind:t.kind,type:t.kind,financeId:t.financeId,financeAccountId:t.financeAccountId,
 date:t.date,authorizedDate:t.authorizedDate,title:t.kind==='transaction'&&t.merchantName?t.merchantName:t.name,
 providerName:t.name,providerTitle:t.kind==='transaction'&&t.merchantName?t.merchantName:t.name,
 merchant:t.merchantName,account:`[[${accountPath.replace(/\.md$/,'')}]]`,amount:t.amount,currency:t.currency,
 pending:t.pending,providerCategory:t.category,providerCategoryDetail:t.categoryDetail};
}
async function seedExistingTransactions(h,records) {
 for(const record of records){
  const fields=transactionFixture(record,'Finances/Accounts/Checking.md');fields.id=fields.financeId;delete fields.financeId;
  await h.app.vault.create(`Finances/Transactions/${record.financeId}.md`,'---\n'+JSON.stringify(fields)+'\n---\n');
 }
}
