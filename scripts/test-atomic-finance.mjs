import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse as parseYaml} from 'yaml';
globalThis.AtomicQAParseYaml=parseYaml;
class File {constructor(path){this.path=path;this.basename=path.split('/').at(-1).replace(/\.md$/,'');this.extension=path.split('.').at(-1);}}
globalThis.AtomicQAFile=File;
const output=await build({entryPoints:['src/atomic-finance-store.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export class App{};export const TFile=globalThis.AtomicQAFile;export const normalizePath=s=>s;export const parseYaml=s=>globalThis.AtomicQAParseYaml(s);export const stringifyYaml=s=>JSON.stringify(s)+'\\n';`}));}}]});
const {AtomicFinanceStore,transactionFields,legacyFields}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
function harness(){
 const nodes=new Map(),text=new Map();let failTrash=false,failSource=false;
 const fm=p=>{const m=(text.get(p)||'').match(/^---\n([\s\S]*?)\n---/);return !m?{}:m[1].trim().startsWith('{')?JSON.parse(m[1]):Object.fromEntries(m[1].split('\n').map(line=>{const i=line.indexOf(':');return [line.slice(0,i),line.slice(i+1).trim()]}))};
 const vault={getAbstractFileByPath:p=>nodes.get(p),getMarkdownFiles:()=>[...nodes.values()].filter(n=>n instanceof File&&n.path.endsWith('.md')),createFolder:async p=>nodes.set(p,{path:p}),create:async(p,c)=>{if(nodes.has(p))throw Error('occupied');const f=new File(p);nodes.set(p,f);text.set(p,c);return f;},read:async f=>text.get(f.path),cachedRead:async f=>text.get(f.path),process:async(f,fn)=>{if(failSource&&f.path==='Day.md')throw Error('source write failure');const next=fn(text.get(f.path));text.set(f.path,next);return next;}};
 const app={vault,metadataCache:{getFileCache:f=>({frontmatter:fm(f.path)})},fileManager:{processFrontMatter:async(f,fn)=>{const old=text.get(f.path),data=fm(f.path);fn(data);text.set(f.path,'---\n'+JSON.stringify(data)+'\n---\n'+old.replace(/^---\n[\s\S]*?\n---\n/,''));},trashFile:async f=>{if(failTrash)throw Error('trash failure');nodes.delete(f.path);text.delete(f.path);}}};
 return {app,nodes,text,fm,store:new AtomicFinanceStore(app,'Finances'),failTrash:()=>failTrash=true,failSource:()=>failSource=true,restoreSource:()=>failSource=false};
}
const tx={financeId:'local-1',providerTransactionId:'provider-1',financeAccountId:'account-1',date:'2026-09-13',authorizedDate:'2026-09-12',name:'Groceries',merchantName:'Market',amount:-12.5,currency:'USD',pending:true,category:'FOOD',categoryDetail:'GROCERY',subtype:'',kind:'transaction'};
const accounts=new Map([['account-1','Finances/Accounts/Checking.md']]);
const state={plaidUserId:'qa',items:[],providerIdentityMap:{'transaction:provider-1':'local-1'}};
const path='Finances/Transactions/local-1.md';
const holdingAccount={financeAccountId:'account-1',name:'Investing',institutionName:'Example Bank',currency:'USD',current:100,available:100};
const namedHolding={financeAccountId:'account-1',securityId:'security-1',name:'Example Company',ticker:'EXM',type:'equity',quantity:2,price:50,value:100,costBasis:90,currency:'USD'};
const holdingDate=new Date('2026-09-26T12:00:00Z');

function primaryIdentity(h,key='recordId'){
 h.app.plugins={plugins:{'tps-global-context-menu':{settings:{nativeRecordIdentityPropertyKey:'oldSavedKey'},api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:key})}}}}};
 return new AtomicFinanceStore(h.app,'');
}

test('configured primary-only imports retain account foreign keys and unchanged revisions do no writes',async()=>{
 const h=harness(),root=primaryIdentity(h),paths=await root.upsertAccounts([holdingAccount]);
 const accountPath=paths.get('account-1');assert.equal(h.fm(accountPath).recordId,'account-1');assert.equal(h.fm(accountPath).financeAccountId,undefined);assert.equal(h.fm(accountPath).tpsId,undefined);
 await root.applyTransactions([tx],[],[],structuredClone(state),paths);
 const file=h.nodes.get('local-1.md');assert.equal(h.fm(file.path).recordId,'local-1');assert.equal(h.fm(file.path).financeId,undefined);assert.equal(h.fm(file.path).financeAccountId,'account-1');assert.equal(h.fm(file.path).oldSavedKey,undefined);
 await h.app.fileManager.processFrontMatter(file,raw=>{raw.categoryOverride='Personal';raw.tags=['keep'];raw.custom='Keep'});h.text.set(file.path,h.text.get(file.path)+'Receipt body\n');
 let attempts=0,creates=0,fresh=0;const process=h.app.fileManager.processFrontMatter,create=h.app.vault.create,read=h.app.vault.read;
 h.app.fileManager.processFrontMatter=async(...args)=>{attempts++;return process(...args)};
 h.app.vault.create=async(...args)=>{creates++;return create(...args)};h.app.vault.read=async target=>{if(target===file)fresh++;return read(target)};
 await root.applyTransactions([tx],[],[],structuredClone(state),paths);assert.equal(attempts,0);assert.equal(creates,0);assert.equal(fresh,0);
 await root.applyTransactions([],[{...tx,amount:-19,pending:false}],[],structuredClone(state),paths);
 assert.equal(attempts,1);assert.equal(creates,0);assert.equal(h.fm(file.path).recordId,'local-1');assert.equal(h.fm(file.path).financeId,undefined);
 assert.equal(h.fm(file.path).categoryOverride,'Personal');assert.deepEqual(h.fm(file.path).tags,['keep']);assert.match(h.text.get(file.path),/Receipt body/);
 assert.equal((await root.readTransactionRecords('metadata')).length,1);
 await root.writeSnapshot([holdingAccount],[namedHolding],paths,holdingDate);
 const holdingFile=h.app.vault.getMarkdownFiles().find(target=>h.fm(target.path).securityId==='security-1');assert.ok(holdingFile);
 assert.equal(h.fm(holdingFile.path).recordId,'holding-account-1%3Asecurity-1');assert.equal(h.fm(holdingFile.path).tpsId,undefined);assert.equal(h.fm(holdingFile.path).financeAccountId,'account-1');assert.equal(h.fm(holdingFile.path).securityId,'security-1');
 const budget=await root.createBudget({id:'budget-own',name:'Budget identity QA',category:'Food',monthlyLimit:500});
 const rule=await root.createRule({id:'rule-own',name:'Rule identity QA',enabled:true,priority:100,accountContains:'',nameContains:'Market',merchantContains:'',minAmount:null,maxAmount:null,category:'Food',tags:[]});
 assert.equal(h.fm(budget.path).recordId,'budget-own');assert.equal(h.fm(budget.path).financeBudgetId,undefined);assert.equal(h.fm(rule.path).recordId,'rule-own');assert.equal(h.fm(rule.path).financeRuleId,undefined);
 assert.equal(root.readBudgets()[0].id,'budget-own');assert.equal(root.readRules()[0].id,'rule-own');
});

test('mixed legacy and primary duplicate IDs or conflicting own IDs block imports before mutations',async()=>{
 for(const conflict of ['duplicate','same-note']){
  const h=harness(),root=primaryIdentity(h);
  await h.app.vault.create('Current.md','---\n'+JSON.stringify({...transactionFields(tx,'Checking.md'),financeId:undefined,recordId:tx.financeId})+'\n---\nCurrent body\n');
  if(conflict==='duplicate')await h.app.vault.create('Legacy.md','---\n'+JSON.stringify(transactionFields(tx,'Checking.md'))+'\n---\nLegacy body\n');
  else await h.app.fileManager.processFrontMatter(h.nodes.get('Current.md'),raw=>{raw.financeId='different'});
  const before=new Map(h.text);let attempts=0,creates=0,trashes=0;
  const process=h.app.fileManager.processFrontMatter,create=h.app.vault.create,trash=h.app.fileManager.trashFile;
  h.app.fileManager.processFrontMatter=async(...args)=>{attempts++;return process(...args)};
  h.app.vault.create=async(...args)=>{if(args[0].endsWith('.md'))creates++;return create(...args)};
  h.app.fileManager.trashFile=async(...args)=>{trashes++;return trash(...args)};
  await assert.rejects(root.applyTransactions([],[{...tx,amount:-99}],[],structuredClone(state),new Map([['account-1','Checking.md']])),/duplicate|identity|identifier|conflict/i,conflict);
  assert.equal(attempts+creates+trashes,0);for(const [path,content] of before)assert.equal(h.text.get(path),content);
 }
});

test('primary source authority rejects a stale indexed ID and atomic retarget without overwriting newer content',async()=>{
 const h=harness(),root=primaryIdentity(h);
 await root.applyTransactions([tx],[],[],structuredClone(state),new Map([['account-1','Checking.md']]));
 const file=h.nodes.get('local-1.md'),originalCache=h.app.metadataCache.getFileCache,oldMetadata=structuredClone(h.fm(file.path));
 await h.app.fileManager.processFrontMatter(file,raw=>{raw.recordId='retargeted';raw.custom='Newer source'});
 h.app.metadataCache.getFileCache=target=>target===file?{frontmatter:oldMetadata}:originalCache(target);
 const before=h.text.get(file.path);let writes=0;const process=h.app.fileManager.processFrontMatter;
 h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args)};
 await assert.rejects(root.applyTransactions([],[{...tx,amount:-99}],[],structuredClone(state),new Map([['account-1','Checking.md']])),/identity|occupied|identifier/i);
 assert.equal(writes,0);assert.equal(h.text.get(file.path),before);
 h.app.metadataCache.getFileCache=originalCache;
 await process(file,raw=>{raw.recordId=tx.financeId});
 h.app.fileManager.processFrontMatter=async(target,update)=>process(target,raw=>{raw.recordId='boundary-edit';update(raw)});
 await assert.rejects(root.applyTransactions([],[{...tx,amount:-99}],[],structuredClone(state),new Map([['account-1','Checking.md']])),/identity|identifier/i);
 assert.equal(h.fm(file.path).amount,tx.amount);assert.equal(h.fm(file.path).recordId,tx.financeId);
});

test('pending and posted revisions share one configured primary identity without duplicate writes on retry',async()=>{
 const h=harness(),root=primaryIdentity(h),paths=new Map([['account-1','Checking.md']]);
 const pending={...tx,providerTransactionId:'pending-provider',pending:true};
 const posted={...tx,providerTransactionId:'posted-provider',pending:false,amount:-14};
 const sharedState={providerIdentityMap:{'transaction:pending-provider':tx.financeId,'transaction:posted-provider':tx.financeId}};
 await root.applyTransactions([pending],[],[],sharedState,paths);
 await root.applyTransactions([posted],[],[],sharedState,paths);
 assert.equal(h.fm('local-1.md').recordId,tx.financeId);assert.equal(h.fm('local-1.md').financeId,undefined);assert.equal(h.fm('local-1.md').pending,false);assert.equal(h.fm('local-1.md').amount,-14);
 let writes=0;const process=h.app.fileManager.processFrontMatter;h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args)};
 await root.applyTransactions([posted],[],[],sharedState,paths);assert.equal(writes,0);assert.equal(h.app.vault.getMarkdownFiles().length,1);
});

test('holding import creates a readable ticker/account filename and title at the vault root',async()=>{
 const h=harness(),store=new AtomicFinanceStore(h.app,'');
 const accountPaths=new Map([['account-1','Example Bank Investing •1234.md']]);
 await store.writeSnapshot([holdingAccount],[namedHolding],accountPaths,holdingDate);
 const file='EXM — Example Bank Investing •1234.md';
 assert.ok(h.nodes.has(file));assert.equal(h.fm(file).title,'EXM — Example Bank Investing •1234');
 assert.equal(h.fm(file).name,'Example Company');assert.equal(h.fm(file).tpsId,'holding-account-1%3Asecurity-1');
 assert.equal(h.fm(file).account,'[[Example Bank Investing •1234]]');assert.equal(h.fm(file).active,true);
 await store.writeSnapshot([holdingAccount],[{...namedHolding,value:110}],accountPaths,holdingDate);
 assert.equal(h.fm(file).value,110);assert.equal(h.app.vault.getMarkdownFiles().length,1);
});
test('untickered investments use their supplied name and unsafe filename characters are sanitized',async()=>{
 const h=harness();await h.store.writeSnapshot([holdingAccount],[{...namedHolding,ticker:'',name:'  Example / Fund: A  '}],accounts,holdingDate);
 const file='Finances/Holdings/Example - Fund- A — Checking.md';assert.ok(h.nodes.has(file));
 assert.equal(h.fm(file).title,'Example / Fund: A — Checking');
});
test('same investment in different accounts remains distinct and readable',async()=>{
 const h=harness(),other={...holdingAccount,financeAccountId:'account-2'};
 await h.store.writeSnapshot([holdingAccount,other],[namedHolding,{...namedHolding,financeAccountId:'account-2'}],new Map([...accounts,['account-2','Finances/Accounts/Retirement.md']]),holdingDate);
 assert.equal(h.fm('Finances/Holdings/EXM — Checking.md').financeAccountId,'account-1');
 assert.equal(h.fm('Finances/Holdings/EXM — Retirement.md').financeAccountId,'account-2');
});
test('readable-name collisions preserve other notes and repeated identities update one holding',async()=>{
 const h=harness();await h.app.vault.create('Finances/Holdings/EXM — Checking.md','Personal note');
 await h.store.writeSnapshot([holdingAccount],[namedHolding,{...namedHolding,value:120},{...namedHolding,securityId:'security-2'}],accounts,holdingDate);
 assert.equal(h.text.get('Finances/Holdings/EXM — Checking.md'),'Personal note');
 assert.equal(h.fm('Finances/Holdings/EXM — Checking 2.md').value,120);
 assert.equal(h.fm('Finances/Holdings/EXM — Checking 3.md').securityId,'security-2');
 await h.store.writeSnapshot([holdingAccount],[namedHolding,{...namedHolding,securityId:'security-2'}],accounts,holdingDate);
 assert.equal(h.app.vault.getMarkdownFiles().length,3);
});
test('root holding imports remain idempotent and active before metadata catches up',async()=>{
 const h=harness(),store=new AtomicFinanceStore(h.app,'');h.app.metadataCache.getFileCache=()=>null;
 await h.app.vault.create('EXM — Checking.md','Personal note');
 for(let n=0;n<2;n++)await store.writeSnapshot([holdingAccount],[namedHolding],accounts,holdingDate);
 assert.equal(h.fm('EXM — Checking 2.md').active,true);assert.equal(h.app.vault.getMarkdownFiles().length,2);
 await store.writeSnapshot([holdingAccount],[],accounts,holdingDate);assert.equal(h.fm('EXM — Checking 2.md').active,false);
});
test('sync preserves existing holding paths and edited titles while updating values',async()=>{
 const h=harness();const file='Finances/Holdings/My long-term position.md';
 await h.app.vault.create(file,'---\n'+JSON.stringify({...namedHolding,type:'holding',title:'Keep my title',tpsId:'holding-account-1%3Asecurity-1',custom:'keep',tags:['watch']})+'\n---\nMy analysis\n');
 await h.store.writeSnapshot([holdingAccount],[{...namedHolding,value:120}],accounts,holdingDate);
 assert.equal(h.fm(file).title,'Keep my title');assert.equal(h.fm(file).value,120);assert.equal(h.fm(file).custom,'keep');assert.deepEqual(h.fm(file).tags,['watch']);assert.match(h.text.get(file),/My analysis/);assert.equal(h.app.vault.getMarkdownFiles().length,1);
});
test('holding updates preserve absent or independently assigned native identity without adoption',async()=>{
 for(const identity of [{},{tpsId:'independent-position-id'},{TPSID:'case-preserved-position-id'}]){
  const h=harness(),file='Finances/Holdings/My position.md';
  await h.app.vault.create(file,'---\n'+JSON.stringify({...namedHolding,kind:'holding',type:'holding',title:'Keep my title',...identity})+'\n---\nMy analysis\n');
  await h.store.writeSnapshot([holdingAccount],[{...namedHolding,value:120}],accounts,holdingDate);
  const updated=h.fm(file);
  assert.equal(updated.tpsId,identity.tpsId);assert.equal(updated.TPSID,identity.TPSID);
  assert.equal(updated.value,120);assert.equal(updated.financeAccountId,namedHolding.financeAccountId);assert.equal(updated.securityId,namedHolding.securityId);
  assert.equal(updated.title,'Keep my title');assert.match(h.text.get(file),/My analysis/);assert.equal(h.app.vault.getMarkdownFiles().length,1);
 }
});
test('holding creation requires an account path and a supplied investment label',async()=>{
 const h=harness();await assert.rejects(h.store.writeSnapshot([holdingAccount],[namedHolding],new Map(),holdingDate),/account note is missing/);
 await assert.rejects(h.store.writeSnapshot([holdingAccount],[{...namedHolding,name:'',ticker:''}],accounts,holdingDate),/investment name or ticker/);
 assert.equal(h.app.vault.getMarkdownFiles().length,0);
});
test('existing ID-named holdings are updated in place without automatic renaming or title repair',async()=>{
 const h=harness(),file='Finances/Holdings/account-1%3Asecurity-1.md';
 await h.app.vault.create(file,'---\n'+JSON.stringify({...namedHolding,type:'holding',tpsId:'holding-account-1%3Asecurity-1'})+'\n---\n');
 await h.store.writeSnapshot([holdingAccount],[{...namedHolding,value:150}],accounts,holdingDate);
 assert.equal(h.fm(file).value,150);assert.equal(h.fm(file).title,undefined);assert.equal(h.app.vault.getMarkdownFiles().length,1);
});
test('one note per transaction, repeated addition is idempotent',async()=>{const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);await h.store.applyTransactions([tx],[],[],state,accounts);assert.equal(h.fm(path).amount,-12.5);assert.equal(h.app.vault.getMarkdownFiles().length,1);assert.equal((await h.store.readTransactionRecords()).length,1);});
test('posted corrections preserve body, custom properties, tags and manual category',async()=>{const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);const f=h.nodes.get(path);await h.app.fileManager.processFrontMatter(f,fm=>{fm.tags=['food/healthy'];fm.categoryOverride='Groceries';fm.custom='keep';});h.text.set(path,h.text.get(path)+'My receipt notes\n');await h.store.applyTransactions([],[{...tx,amount:-15,pending:false}],[],state,accounts);assert.equal(h.fm(path).amount,-15);assert.equal(h.fm(path).pending,false);assert.equal(h.fm(path).custom,'keep');assert.deepEqual(h.fm(path).tags,['food/healthy']);assert.match(h.text.get(path),/My receipt notes/);});
test('provider removal uses trash and propagates trash failure',async()=>{const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);h.failTrash();await assert.rejects(h.store.applyTransactions([],[],['provider-1'],state,accounts),/trash failure/);assert.ok(h.nodes.has(path));});
test('provider removal deletes the matching note',async()=>{const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);const r=await h.store.applyTransactions([],[],['provider-1'],state,accounts);assert.equal(r.removed,1);assert.ok(!h.nodes.has(path));});
test('duplicate identities stop before overwriting either note',async()=>{const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);await h.app.vault.create('Duplicate.md',h.text.get(path));await assert.rejects(h.store.applyTransactions([],[{...tx,amount:-99}],[],state,accounts),/Duplicate atomic/);assert.equal(h.fm(path).amount,-12.5);});
test('occupied destination preserves unrelated content',async()=>{const h=harness();await h.app.vault.create(path,'User note');await assert.rejects(h.store.applyTransactions([tx],[],[],state,accounts),/occupied/);assert.equal(h.text.get(path),'User note');});
const line='- Market [type:: transaction] [financeId:: old-1] [date:: 2026-09-13] [account:: [[Finances/Accounts/Checking]]] [amount:: -20] [currency:: USD] [pending:: false] [tags:: food/healthy]';
async function legacy(h){await h.app.vault.create('Finances/Accounts/Checking.md','---\n'+JSON.stringify({kind:'account'})+'\n---\n');await h.app.vault.create('Day.md','Keep my introduction\n'+line+'\nKeep my ending\n');}
test('legacy conversion preserves source context and writes ordinary link',async()=>{const h=harness();await legacy(h);const result=await h.store.migrateLegacyTransactionLedgers();assert.equal(result.moved,1);assert.equal(h.fm('Finances/Transactions/old-1.md').amount,-20);assert.deepEqual(h.fm('Finances/Transactions/old-1.md').tags,['food/healthy']);assert.equal(h.text.get('Day.md'),'Keep my introduction\n- [[Finances/Transactions/old-1]]\nKeep my ending\n');assert.equal((await h.store.migrateLegacyTransactionLedgers()).moved,0);});
test('interrupted source replacement resumes using verified existing destination',async()=>{const h=harness();await legacy(h);h.failSource();await assert.rejects(h.store.migrateLegacyTransactionLedgers(),/source write failure/);assert.match(h.text.get('Day.md'),/financeId:: old-1/);assert.ok(h.nodes.has('Finances/Transactions/old-1.md'));h.restoreSource();assert.equal((await h.store.migrateLegacyTransactionLedgers()).moved,1);});
test('ambiguous migrated identity preserves both representations',async()=>{const h=harness();await legacy(h);await h.store.applyTransactions([{...tx,financeId:'old-1'}],[],[],state,accounts);const r=await h.store.migrateLegacyTransactionLedgers();assert.equal(r.skipped,1);assert.match(h.text.get('Day.md'),/financeId:: old-1/);});
test('missing account and invalid amount fail rather than silently manufacturing data',async()=>{const h=harness();await assert.rejects(h.store.applyTransactions([tx],[],[],state,new Map()),/account note is missing/);assert.throws(()=>transactionFields({...tx,amount:NaN},'Account.md'),/Invalid/);assert.equal(legacyFields(line.replace('-20','nonsense')),null);});
test('atomic Bases use core table view; customized legacy Base is preserved',async()=>{const h=harness();await h.app.vault.create('Finances/Transactions.base','custom base');await h.store.ensureStructure();assert.equal(h.text.get('Finances/Transactions.base'),'custom base');const base=JSON.parse(h.text.get('Finances/Transactions (Atomic notes).base'));assert.equal(base.views[0].type,'table');assert.match(base.filters.and[0],/Finances\/Transactions/);});
test('holdings have individual notes and disappeared holdings become inactive',async()=>{const h=harness();const account={financeAccountId:'account-1',name:'Checking',institutionName:'QA',currency:'USD',current:100,available:100};const holding={financeAccountId:'account-1',securityId:'ABC',name:'QA fund',ticker:'ABC',type:'equity',quantity:2,price:50,value:100,costBasis:90,currency:'USD'};await h.store.writeSnapshot([account],[holding],accounts,new Date('2026-09-13T12:00:00Z'));const file='Finances/Holdings/ABC — Checking.md';assert.equal(h.fm(file).active,true);assert.equal(h.fm(file).quantity,2);await h.store.writeSnapshot([account],[],accounts,new Date('2026-09-14T12:00:00Z'));assert.equal(h.fm(file).active,false);});
test('edited destination after interrupted migration prevents source retirement',async()=>{const h=harness();await legacy(h);h.failSource();await assert.rejects(h.store.migrateLegacyTransactionLedgers());h.restoreSource();await h.app.fileManager.processFrontMatter(h.nodes.get('Finances/Transactions/old-1.md'),fm=>{fm.amount=-100;});assert.equal((await h.store.migrateLegacyTransactionLedgers()).skipped,1);assert.match(h.text.get('Day.md'),/financeId:: old-1/);});

test('migration refreshes legacy records created after an earlier dashboard read',async()=>{const h=harness();await h.store.readTransactionRecords();await legacy(h);assert.equal((await h.store.migrateLegacyTransactionLedgers()).moved,1);});

test('unchanged provider revisions do not rewrite transaction notes',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
 let writes=0;const original=h.app.fileManager.processFrontMatter;h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return original(...args)};
 await h.store.applyTransactions([tx],[],[],state,accounts);assert.equal(writes,0);
 await h.store.applyTransactions([],[{...tx,amount:-90}],[],state,accounts);assert.equal(writes,1);assert.equal(h.fm(path).amount,-90);
});

test('atomic dashboard excludes records owned by a different finance collection',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
 const other=JSON.parse(h.text.get(path).match(/^---\n([\s\S]*?)\n---/)[1]);other.tpsId='elsewhere';other.account='[[Other/Accounts/Checking]]';
 await h.app.vault.create('Other/Transactions/elsewhere.md','---\n'+JSON.stringify(other)+'\n---\n');
 assert.equal((await h.store.readTransactionRecords()).length,1);
});

test('root atomic storage creates no folders and keeps additions, corrections, holdings, and removals visible',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 const account={financeAccountId:'account-1',name:'Checking',institutionName:'QA',currency:'USD',type:'depository',subtype:'checking',mask:'1234',current:100,available:100};
 const paths=await root.upsertAccounts([account]);
 assert.ok(!paths.get('account-1').includes('/'));
 await root.applyTransactions([tx],[],[],state,paths);
 await root.applyTransactions([],[{...tx,amount:-19}],[],state,paths);
 assert.equal(h.fm('local-1.md').amount,-19);
 assert.equal((await root.readTransactionRecords()).length,1);
 const holding={financeAccountId:'account-1',securityId:'ABC',type:'equity',name:'Fund',quantity:2,price:50,value:100,currency:'USD'};
 await root.writeSnapshot([account],[holding],paths,new Date('2026-09-16T12:00:00Z'));
 assert.equal(h.fm('Fund — QA Checking •1234.md').active,true);
 assert.ok([...h.nodes.values()].every(n=>n instanceof File));
 assert.ok([...h.nodes.keys()].every(p=>!p.includes('/')));
 const view=JSON.parse(h.text.get('Transactions.base'));assert.ok(view.filters.and.includes('(note["tpsId"] != null || note["financeId"] != null)'));assert.ok(!JSON.stringify(view).includes('inFolder'));
 await root.applyTransactions([],[],['provider-1'],state,paths);assert.equal((await root.readTransactionRecords()).length,0);
});

test('switching to root keeps existing account, transaction and holding identities in place',async()=>{
 const h=harness(),account={financeAccountId:'account-1',name:'Checking',institutionName:'QA',currency:'USD',current:100,available:100};
 const paths=await h.store.upsertAccounts([account]);await h.store.applyTransactions([tx],[],[],state,paths);
 const holding={financeAccountId:'account-1',securityId:'ABC',ticker:'ABC',name:'QA fund',type:'equity',quantity:2,price:50,value:100,currency:'USD'};
 await h.store.writeSnapshot([account],[holding],paths,new Date('2026-09-16T12:00:00Z'));
 const root=new AtomicFinanceStore(h.app,'');assert.deepEqual(await root.upsertAccounts([account]),paths);
 await root.applyTransactions([],[{...tx,amount:-30}],[],state,paths);
 await root.writeSnapshot([account],[{...holding,value:110}],paths,new Date('2026-09-16T12:00:00Z'));
 assert.equal(h.fm(path).amount,-30);assert.equal(h.fm('Finances/Holdings/ABC — QA Checking.md').value,110);
 assert.ok(!h.nodes.has('local-1.md'));assert.ok(!h.nodes.has('ABC — QA Checking.md'));
});

test('root ignores unrelated notes and preserves occupied transaction names',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');await h.app.vault.create('Unrelated.md','---\ninvalid yaml in another note\n---\n');
 await h.app.vault.create('local-1.md','Personal note');
 await assert.rejects(root.applyTransactions([tx],[],[],state,new Map([['account-1','Checking.md']])),/occupied/);
 assert.equal(h.text.get('local-1.md'),'Personal note');assert.equal((await root.readTransactionRecords()).length,0);
});

test('root rules, budgets and legacy snapshots are typed and do not overwrite ordinary notes',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 await h.app.vault.create('Personal.md','---\n'+JSON.stringify({category:'Food',monthlyLimit:100,tags:['personal'],date:'2099-01-01'})+'\n---\n');
 await root.createBudget({id:'budget',name:'Food budget',category:'Food',monthlyLimit:500});
 await root.createRule({id:'rule',name:'Food rule',enabled:true,priority:100,accountContains:'',nameContains:'Market',merchantContains:'',minAmount:null,maxAmount:null,category:'Food',tags:[]});
 assert.equal(root.readRules().length,1);assert.equal(root.readBudgets().length,1);
 assert.ok(h.nodes.has('Food budget.md'));assert.ok(h.nodes.has('Food rule.md'));
});

test('root legacy snapshots preserve ordinary names and return the actual existing destination',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 const name='Finance snapshot 2026-09-16.md';await h.app.vault.create(name,'Personal note');
 const write=Object.getPrototypeOf(AtomicFinanceStore.prototype).writeSnapshot;
 const saved=await write.call(root,[],[],new Map(),new Date('2026-09-16T12:00:00Z'));
 assert.equal(saved,'Finance snapshot 2026-09-16 2.md');assert.equal(h.text.get(name),'Personal note');
 assert.equal(await write.call(root,[],[],new Map(),new Date('2026-09-16T12:00:00Z')),saved);
});

test('bulk imports overlap independent writes with at most sixteen in flight and verify every note',async()=>{
 const h=harness(),create=h.app.vault.create;let active=0,peak=0,verified=0;
 const read=h.app.vault.cachedRead;
 h.app.vault.cachedRead=async file=>{if(file.path.includes('/Transactions/'))verified++;return read(file);};
 h.app.vault.create=async(p,c)=>{
  if(!p.includes('/Transactions/'))return create(p,c);
  active++;peak=Math.max(peak,active);
  try{await new Promise(resolve=>setTimeout(resolve,2));return await create(p,c);}finally{active--;}
 };
 const transactions=Array.from({length:250},(_,i)=>({...tx,financeId:`bulk-${i}`}));
 await h.store.applyTransactions(transactions,[],[],state,accounts);
 assert.equal(peak,16);assert.equal(active,0);assert.equal(verified,250);
 assert.equal((await h.store.readTransactionRecords()).length,250);
 for(let i=0;i<250;i++)assert.equal(h.fm(`Finances/Transactions/bulk-${i}.md`).amount,tx.amount);
});

test('competing revisions of one identity keep modified then added order without overlapping writes',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
 const process=h.app.fileManager.processFrontMatter;let active=0,peak=0;
 h.app.fileManager.processFrontMatter=async(...args)=>{active++;peak=Math.max(peak,active);try{await new Promise(resolve=>setTimeout(resolve,1));return await process(...args);}finally{active--;}};
 await h.store.applyTransactions([{...tx,amount:-40},{...tx,amount:-50}],[{...tx,amount:-30}],[],state,accounts);
 assert.equal(peak,1);assert.equal(h.fm(path).amount,-50);assert.equal(h.app.vault.getMarkdownFiles().length,1);
});

test('failed batch stops scheduling, drains in-flight writes, and resumes without duplicates',async()=>{
 const h=harness(),create=h.app.vault.create;let active=0,attempts=0,fail=true;
 h.app.vault.create=async(p,c)=>{
  if(!p.includes('/Transactions/'))return create(p,c);
  attempts++;active++;
  try{await new Promise(resolve=>setTimeout(resolve,p.endsWith('batch-0.md')?1:10));if(fail&&p.endsWith('batch-0.md'))throw Error('disk full');return await create(p,c);}finally{active--;}
 };
 const transactions=Array.from({length:100},(_,i)=>({...tx,financeId:`batch-${i}`}));
 await assert.rejects(h.store.applyTransactions(transactions,[],[],state,accounts),/disk full/);
 assert.equal(active,0);assert.equal(attempts,16);assert.equal(h.app.vault.getMarkdownFiles().length,15);
 fail=false;await h.store.applyTransactions(transactions,[],[],state,accounts);
 assert.equal((await h.store.readTransactionRecords()).length,100);
});

test('a post-write verification failure is drained and a retry reuses the saved note',async()=>{
 const h=harness(),read=h.app.vault.cachedRead;let fail=true;
 h.app.vault.cachedRead=async file=>{if(fail&&file.path===path)throw Error('verification read failed');return read(file);};
 await assert.rejects(h.store.applyTransactions([tx],[],[],state,accounts),/verification read failed/);
 assert.ok(h.nodes.has(path));fail=false;
 await h.store.applyTransactions([tx],[],[],state,accounts);assert.equal((await h.store.readTransactionRecords()).length,1);
});

test('empty bank and investment patches do no filesystem work',async()=>{
 const h=harness();h.app.vault.getMarkdownFiles=()=>{throw Error('unexpected vault scan');};
 assert.deepEqual(await h.store.applyTransactions([],[],[],state,accounts),{added:0,modified:0,removed:0});
 await h.store.replaceInvestmentTransactions([],accounts);assert.equal(h.nodes.size,0);
});

test('root retries work before metadata arrives and never adopt an unrelated or wrong-type note',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');h.app.metadataCache.getFileCache=()=>null;
 await root.applyTransactions([tx],[],[],state,accounts);
 await root.applyTransactions([{...tx,amount:-44}],[],[],state,accounts);
 assert.equal(h.fm('local-1.md').amount,-44);assert.equal(h.app.vault.getMarkdownFiles().length,1);
 await h.app.fileManager.processFrontMatter(h.nodes.get('local-1.md'),fm=>fm.type='personal');
 await assert.rejects(root.applyTransactions([tx],[],[],state,accounts),/occupied/);
 assert.equal(h.fm('local-1.md').type,'personal');
});

test('duplicate detection completes before a batch can change any transaction',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
 await h.app.vault.create('Duplicate.md',h.text.get(path));
 const before=new Map(h.text);
 await assert.rejects(h.store.applyTransactions([{...tx,financeId:'new'}],[{...tx,amount:-99}],[],state,accounts),/Duplicate atomic/);
 assert.deepEqual(h.text,before);
});

test('invalid transactions are rejected before earlier rows or removals mutate the vault',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);const before=new Map(h.text);
 await assert.rejects(h.store.applyTransactions([{...tx,financeId:'valid'},{...tx,amount:NaN}],[],['provider-1'],state,accounts),/Invalid atomic/);
 assert.deepEqual(h.text,before);
});

test('parallel identity reads preserve the vault order of dashboard records',async()=>{
 const h=harness();await h.store.applyTransactions([tx,{...tx,financeId:'second'}],[],[],state,accounts);
 const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{if(file.path===path)await new Promise(resolve=>setTimeout(resolve,5));return read(file);};
 assert.deepEqual((await h.store.readTransactionRecords()).map(r=>r.path),[path,'Finances/Transactions/second.md']);
});

test('imported titles prefer merchant names while preserving exact provider text',async()=>{
 const h=harness();await h.store.applyTransactions([{...tx,name:'  POS MARKET #1234\nDEBIT  ',merchantName:'  My   Market  '}],[],[],state,accounts);
 assert.equal(h.fm(path).title,'My Market');assert.equal(h.fm(path).providerTitle,'My Market');
 assert.equal(h.fm(path).providerName,'  POS MARKET #1234\nDEBIT  ');
 const [record]=await h.store.readTransactionRecords();assert.match(record.line,/^- My Market \[type/);assert.match(record.line,/\[providerName::/);
 assert.equal(record.path,path);
});

test('titles fall back conservatively and investment descriptions retain the trade',()=>{
 assert.equal(transactionFields({...tx,merchantName:' ',name:' ATM   WITHDRAWAL '},'A').title,'ATM WITHDRAWAL');
 assert.equal(transactionFields({...tx,kind:'investmentTransaction',merchantName:'Broker',name:'Buy 2 ABC'},'A').title,'Buy 2 ABC');
 assert.equal(transactionFields({...tx,merchantName:'',name:''},'A').title,'Transaction');
});

test('provider corrections update managed titles and preserve manually edited titles',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
 await h.store.applyTransactions([],[{...tx,merchantName:'Market Place',name:'BANK NEW',pending:false}],[],state,accounts);
 assert.equal(h.fm(path).title,'Market Place');assert.equal(h.fm(path).providerName,'BANK NEW');
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>f.title='Weekly groceries');
 await h.store.applyTransactions([],[{...tx,merchantName:'Market Final',amount:-30}],[],state,accounts);
 assert.equal(h.fm(path).title,'Weekly groceries');assert.equal(h.fm(path).amount,-30);assert.equal(h.fm(path).providerTitle,'Market Final');
 assert.deepEqual(await h.store.reviewTransactionTitles(),[]);
 let writes=0;const process=h.app.fileManager.processFrontMatter;h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args)};
 await h.store.applyTransactions([],[{...tx,merchantName:'Market Final',amount:-30}],[],state,accounts);assert.equal(writes,0);
});

test('an edit made after the pre-read survives the atomic provider update',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
 const process=h.app.fileManager.processFrontMatter;
 h.app.fileManager.processFrontMatter=async(file,update)=>process(file,current=>{current.title='Concurrent title';current.tags=['keep'];update(current)});
 await h.store.applyTransactions([],[{...tx,amount:-40,merchantName:'Corrected'}],[],state,accounts);
 assert.equal(h.fm(path).title,'Concurrent title');assert.deepEqual(h.fm(path).tags,['keep']);assert.equal(h.fm(path).amount,-40);
});

async function oldTitle(h,title='BANK MARKET 1234') {
 await h.store.applyTransactions([tx],[],[],state,accounts);
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>{f.title=title;delete f.providerName;delete f.providerTitle;});
}
test('unknown legacy titles need explicit review and preview performs no writes',async()=>{
 const h=harness();await oldTitle(h);const before=new Map(h.text);
 const [change]=await h.store.reviewTransactionTitles();assert.equal(change.before,'BANK MARKET 1234');assert.equal(change.after,'Market');assert.deepEqual(h.text,before);
 h.text.set(path,h.text.get(path)+'Receipt details');
 await h.store.applyTransactionTitle(change);
 assert.equal(h.fm(path).title,'Market');assert.equal(h.fm(path).providerName,'BANK MARKET 1234');assert.equal(h.fm(path).providerTitle,'Market');assert.match(h.text.get(path),/Receipt details/);
 assert.deepEqual(await h.store.reviewTransactionTitles(),[]);
 await h.store.applyTransactions([],[{...tx,merchantName:'Market Updated',name:'REAL BANK TEXT'}],[],state,accounts);
 assert.equal(h.fm(path).title,'Market Updated');assert.equal(h.fm(path).providerName,'REAL BANK TEXT');
});
test('sync adopts verifiable old descriptions but keeps ambiguous legacy titles',async()=>{
 const h=harness();await oldTitle(h,'Groceries');await h.store.applyTransactions([tx],[],[],state,accounts);assert.equal(h.fm(path).title,'Market');
 await oldTitle(h,'Custom old title');await h.store.applyTransactions([tx],[],[],state,accounts);assert.equal(h.fm(path).title,'Custom old title');
});
test('review detects changed titles, merchants, identities, and paths without overwriting them',async()=>{
 for(const [key,value] of [['title','Changed'],['merchant','Another'],['tpsId','other'],['financeSource','manual'],['account','[[Elsewhere]]']]) {
  const h=harness();await oldTitle(h);const [change]=await h.store.reviewTransactionTitles();
  await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>f[key]=value);const before=new Map(h.text);
  await assert.rejects(h.store.applyTransactionTitle(change),/Transaction changed/);assert.deepEqual(h.text,before);
 }
 const h=harness();await oldTitle(h);const [change]=await h.store.reviewTransactionTitles();h.nodes.delete(path);await assert.rejects(h.store.applyTransactionTitle(change),/moved or disappeared/);
});
test('manual records are excluded and import identity collisions never overwrite them',async()=>{
 const h=harness();await oldTitle(h);await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>f.financeSource='manual');
 assert.deepEqual(await h.store.reviewTransactionTitles(),[]);const before=new Map(h.text);
 await assert.rejects(h.store.applyTransactions([tx],[],[],state,accounts),/conflicts with a manual/);assert.deepEqual(h.text,before);
});
test('failed review writes leave the proposal reusable',async()=>{
 const h=harness();await oldTitle(h);const [change]=await h.store.reviewTransactionTitles(),process=h.app.fileManager.processFrontMatter;
 h.app.fileManager.processFrontMatter=async()=>{throw Error('disk failed')};await assert.rejects(h.store.applyTransactionTitle(change),/disk failed/);
 h.app.fileManager.processFrontMatter=process;await h.store.applyTransactionTitle(change);assert.equal(h.fm(path).title,'Market');
});

test('new imports omit only empty provider properties and preserve zero investment values',()=>{
 const f=transactionFields({...tx,authorizedDate:'',merchantName:' ',categoryDetail:'',fees:0,quantity:0,price:0},'A');
 for(const key of ['authorizedDate','merchant','providerCategoryDetail','subtype','securityId','investmentType'])assert.ok(!(key in f),key);
 for(const key of ['fees','quantity','price'])assert.equal(f[key],0);
 assert.equal(f.amount,tx.amount);assert.equal(f.pending,true);assert.equal(f.title,'Groceries');
});

test('provider revisions clear obsolete optional data and do not rewrite it on retry',async()=>{
 const h=harness();await h.store.applyTransactions([{...tx,securityId:'ABC',quantity:3,price:7,fees:0}],[],[],state,accounts);
 await h.store.applyTransactions([],[{...tx,authorizedDate:'',merchantName:'',categoryDetail:''}],[],state,accounts);
 for(const key of ['securityId','quantity','price','fees','authorizedDate','merchant','providerCategoryDetail'])assert.ok(!(key in h.fm(path)),key);
 h.app.fileManager.processFrontMatter=async()=>{throw Error('unexpected rewrite');};
 await h.store.applyTransactions([],[{...tx,authorizedDate:'',merchantName:'',categoryDetail:''}],[],state,accounts);
});

test('record review removes empty placeholders without changing custom titles, user fields, body or financial values',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
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
  const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
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
  const h=harness();await h.store.applyTransactions([{...tx,kind,merchantName:''}],[],[],state,accounts);
  await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>{f.title='  BUY   2 ABC / TRANSFER  ';delete f.providerTitle;delete f.providerName;});
  const [change]=await h.store.reviewTransactionTitles();assert.equal(change.after,'BUY 2 ABC / TRANSFER');
  await h.store.applyTransactionTitle(change);assert.equal(h.fm(path).providerName,'  BUY   2 ABC / TRANSFER  ');
  assert.equal(h.fm(path).title,'BUY 2 ABC / TRANSFER');
 }
});

test('missing untracked titles can be restored only when a provider description exists',async()=>{
 const h=harness();await h.store.applyTransactions([{...tx,merchantName:'',name:'ATM withdrawal'}],[],[],state,accounts);
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>{delete f.title;delete f.providerTitle;});
 const [change]=await h.store.reviewTransactionTitles();assert.equal(change.after,'ATM withdrawal');
 await h.store.applyTransactionTitle(change);assert.equal(h.fm(path).title,'ATM withdrawal');
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),f=>{delete f.title;delete f.providerTitle;delete f.providerName;});
 assert.deepEqual(await h.store.reviewTransactionTitles(),[]);
});

test('Wallet history uses current property keys at vault root and preserves user edits on retry',async()=>{
 const bundle=await build({entryPoints:['src/finance-wallet.ts'],bundle:true,write:false,platform:'node',format:'esm'});
 const {parseWalletParts,walletTransactionID}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const h=harness();h.app.plugins={plugins:{'tps-finances':{settings:{propertyNames:{keys:{type:'transactionType',amount:'money',title:'label',current:'balance'}}}}}};
 const store=new AtomicFinanceStore(h.app,'');
 const a='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
 const raw={version:1,accounts:[{id:a,name:'Synthetic Savings',institution:'Fixture',kind:'asset',currency:'USD',current:'100'}],transactions:[{id,accountID:a,date:'2026-09-21',description:'SYNTHETIC PURCHASE',merchant:'Synthetic Shop',amount:'10',direction:'debit',status:'pending',currency:'USD',transactionType:'pointOfSale'}],deletedTransactions:[]};
 async function apply(){const plan=parseWalletParts([raw]);const paths=await store.upsertAccounts(plan.accounts);const state={plaidUserId:'',items:[],providerIdentityMap:{['transaction:financekit:'+id]:walletTransactionID(id)}};await store.applyTransactions(plan.transactions,[],plan.removed,state,paths);return paths;}
 const paths=await apply(),file=h.nodes.get(walletTransactionID(id)+'.md');
 assert.equal(h.fm(paths.values().next().value).balance,100);assert.equal(h.fm(file.path).money,-10);assert.equal(h.fm(file.path).transactionType,'transaction');assert.equal(h.fm(file.path).type,undefined);
 await h.app.fileManager.processFrontMatter(file,fm=>{fm.label='User title';fm.tags=['budget/test'];fm.categoryOverride='Groceries';});h.text.set(file.path,h.text.get(file.path)+'Keep receipt details\n');
 raw.transactions[0].status='booked';raw.transactions[0].amount='12.25';await apply();await apply();
 const fm=h.fm(file.path);assert.equal(fm.money,-12.25);assert.equal(fm.label,'User title');assert.deepEqual(fm.tags,['budget/test']);assert.equal(fm.categoryOverride,'Groceries');assert.match(h.text.get(file.path),/Keep receipt details/);
 // A fresh Wallet snapshot repairs an old positive-debt record through the
 // configured balance property, without changing its identity or other notes.
 raw.accounts[0].kind='liability';await apply();await apply();
 assert.equal(h.fm(paths.values().next().value).balance,-100);assert.equal(h.fm(paths.values().next().value).current,undefined);
 assert.equal(h.fm(file.path).money,-12.25);assert.match(h.text.get(file.path),/Keep receipt details/);
 raw.transactions=[];raw.deletedTransactions=[id];h.failTrash();await assert.rejects(apply(),/trash failure/);assert.ok(h.nodes.has(file.path));
});

test('candidate discovery validates configuration once without decoding unrelated notes',async()=>{
 const h=harness();let decoded=0,configurationReads=0,reads=0,scans=0;
 h.app.plugins={plugins:{'tps-finances':{settings:{get propertyNames(){configurationReads++;return {keys:{amount:'money'}};}}},'tps-global-context-menu':{settings:{nativeRecordIdentityPropertyKey:'tpsId'},api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'tpsId'})},frontmatterKinds:{definition:()=>null,encode:f=>f,decode:f=>{decoded++;return f;}}}}}};
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
 const h=harness();await h.store.applyTransactions(Array.from({length:32},(_,i)=>({...tx,financeId:`display-${i}`,providerTransactionId:`display-provider-${i}`})),[],[],state,accounts);
 const expected=await h.store.readTransactionRecords();let reads=0,parses=0,writes=0;
 const read=h.app.vault.cachedRead,parse=globalThis.AtomicQAParseYaml,process=h.app.vault.process;
 h.app.vault.cachedRead=async f=>{reads++;return read(f)};globalThis.AtomicQAParseYaml=value=>{parses++;return parse(value)};h.app.vault.process=async(...args)=>{writes++;return process(...args)};
 try{for(let i=0;i<25;i++)assert.deepEqual(await h.store.readTransactionRecords('metadata'),expected)}
 finally{globalThis.AtomicQAParseYaml=parse}
 assert.deepEqual({reads,parses,writes},{reads:0,parses:0,writes:0});
});
test('indexed display ignores ordinary paragraphs and frontmatter without body reads',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
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
 await h.store.applyTransactions([{...tx,financeId:'old-1'}],[],[],state,accounts);
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
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);const cached=structuredClone(h.fm(path));
 await h.app.fileManager.processFrontMatter(h.nodes.get(path),fm=>{fm.amount=-47;fm.custom='Preserve current source';});
 h.app.metadataCache.getFileCache=()=>({frontmatter:cached});
 const displayed=await h.store.readTransactionRecords('metadata'),current=await h.store.readTransactionRecords();
 assert.equal(legacyFields(displayed[0].line).amount,-12.5);assert.equal(legacyFields(current[0].line).amount,-47);
 await h.store.updateTransactionMetadata(tx.financeId,'Food',['personal']);assert.equal(h.fm(path).amount,-47);assert.equal(h.fm(path).custom,'Preserve current source');
});

test('folder display reads a fresh atomic note once, then follows published metadata and rejects duplicates',async()=>{
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
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
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
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
 const h=harness();await h.store.applyTransactions([tx],[],[],state,accounts);
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
 await h.app.vault.create(transaction,'---\n'+JSON.stringify(transactionFields({...tx,financeId:'cold-id'},'Checking.md'))+'\n---\nBody\n');
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
 const fields=transactionFields({...tx,financeId:'vanishing-cache'},'Checking.md');
 await h.app.vault.create(transaction,'---\n'+JSON.stringify(fields)+'\n---\n');
 let lookups=0,reads=0;
 h.app.metadataCache.getFileCache=()=>++lookups===1?{frontmatter:fields}:null;
 const read=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads++;return read(file);};
 assert.deepEqual((await root.readTransactionRecords('metadata')).map(record=>record.path),[transaction]);
 assert.equal(lookups,2);assert.equal(reads,1);
});

test('root cold scan checks every unindexed file and catches duplicate atomic IDs before a write',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 const frontmatter=transactionFields({...tx,financeId:'same-id'},'Checking.md');
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

test('root sync checks stale non-null metadata once per missing-ID batch before creating notes',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 const edited='Inbox/Edited transaction.md';
 await h.app.vault.create(edited,'---\n'+JSON.stringify(transactionFields(tx,'Finances/Accounts/Checking.md'))+'\n---\nKeep receipt\n');
 for(let n=0;n<128;n++)await h.app.vault.create(`Archive/Ordinary ${n}.md`,'---\n'+JSON.stringify({title:`Ordinary ${n}`})+'\n---\nBody\n');
 const metadata=h.app.metadataCache.getFileCache;let published=false;
 h.app.metadataCache.getFileCache=file=>file.path===edited&&!published?{frontmatter:{title:'Old title'}}:metadata(file);
 const reads=[];const cachedRead=h.app.vault.cachedRead;
 h.app.vault.cachedRead=async file=>{reads.push(file.path);return cachedRead(file);};
 let noteCreates=0,writes=0,scans=0;
 const create=h.app.vault.create;h.app.vault.create=async(path,content)=>{if(path.endsWith('.md'))noteCreates++;return create(path,content);};
 const process=h.app.fileManager.processFrontMatter;h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args);};
 const getFiles=h.app.vault.getMarkdownFiles;h.app.vault.getMarkdownFiles=()=>{scans++;return getFiles();};
 const second={...tx,financeId:'local-2',providerTransactionId:'provider-2'};
 await root.applyTransactions([{...tx,amount:-20},second],[],[],state,accounts);
 assert.equal(h.nodes.has('local-1.md'),false,'the edited note is reused instead of duplicated');
 assert.equal(h.fm(edited).amount,-20);assert.match(h.text.get(edited),/Keep receipt/);
 assert.equal(scans,1,'the missing IDs share one root candidate pass');
 assert.equal(reads.filter(path=>path.startsWith('Archive/')).length,128,'each otherwise excluded ordinary source is checked once');
 assert.equal(reads.filter(path=>path===edited).length,3,'discovery, update preflight and verification read current source');
 assert.equal(noteCreates,1,'only the genuinely new transaction gets a note');
 assert.equal(writes,1);assert.equal(h.fm('local-2.md').tpsId,'local-2');
 published=true;reads.length=0;noteCreates=0;writes=0;scans=0;
 await root.applyTransactions([{...tx,amount:-20},second],[],[],state,accounts);
 assert.equal(scans,1);assert.equal(reads.filter(path=>path.startsWith('Archive/')).length,0,'known IDs avoid the fallback source pass');
 assert.equal(reads.length,4,'each known note is read for indexing and the no-op write check');
 assert.equal(noteCreates,0);assert.equal(writes,0);
});

test('root sync rejects duplicate IDs hidden behind stale non-null metadata before any note write',async()=>{
 const h=harness(),root=new AtomicFinanceStore(h.app,'');
 const source='---\n'+JSON.stringify(transactionFields(tx,'Finances/Accounts/Checking.md'))+'\n---\n';
 await h.app.vault.create('Inbox/First.md',source);await h.app.vault.create('Inbox/Second.md',source);
 h.app.metadataCache.getFileCache=()=>({frontmatter:{title:'Old title'}});
 let noteCreates=0,writes=0,reads=0;
 const create=h.app.vault.create;h.app.vault.create=async(path,content)=>{if(path.endsWith('.md'))noteCreates++;return create(path,content);};
 const process=h.app.fileManager.processFrontMatter;h.app.fileManager.processFrontMatter=async(...args)=>{writes++;return process(...args);};
 const cachedRead=h.app.vault.cachedRead;h.app.vault.cachedRead=async file=>{reads++;return cachedRead(file);};
 await assert.rejects(root.applyTransactions([tx],[],[],state,accounts),/Duplicate atomic transaction identity/);
 assert.equal(reads,2);assert.equal(noteCreates,0);assert.equal(writes,0);
 assert.equal(h.nodes.has('local-1.md'),false);
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
