import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
class File {constructor(path){this.path=path;this.basename=path.split('/').at(-1).replace(/\.md$/,'');this.extension=path.split('.').at(-1);}}
globalThis.AtomicQAFile=File;
const output=await build({entryPoints:['src/atomic-finance-store.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export class App{};export const TFile=globalThis.AtomicQAFile;export const normalizePath=s=>s;export const parseYaml=s=>JSON.parse(s);export const stringifyYaml=s=>JSON.stringify(s)+'\\n';`}));}}]});
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
test('holdings have individual notes and disappeared holdings become inactive',async()=>{const h=harness();const account={financeAccountId:'account-1',name:'Checking',institutionName:'QA',currency:'USD',current:100,available:100};const holding={financeAccountId:'account-1',securityId:'ABC',name:'QA fund',ticker:'ABC',type:'equity',quantity:2,price:50,value:100,costBasis:90,currency:'USD'};await h.store.writeSnapshot([account],[holding],accounts,new Date('2026-09-13T12:00:00Z'));const file='Finances/Holdings/account-1%3AABC.md';assert.equal(h.fm(file).active,true);assert.equal(h.fm(file).quantity,2);await h.store.writeSnapshot([account],[],accounts,new Date('2026-09-14T12:00:00Z'));assert.equal(h.fm(file).active,false);});
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
 const other=JSON.parse(h.text.get(path).match(/^---\n([\s\S]*?)\n---/)[1]);other.financeId='elsewhere';other.account='[[Other/Accounts/Checking]]';
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
 assert.equal(h.fm('account-1%3AABC.md').active,true);
 assert.ok([...h.nodes.values()].every(n=>n instanceof File));
 assert.ok([...h.nodes.keys()].every(p=>!p.includes('/')));
 const view=JSON.parse(h.text.get('Transactions.base'));assert.ok(view.filters.and.includes('financeId != null'));assert.ok(!JSON.stringify(view).includes('inFolder'));
 await root.applyTransactions([],[],['provider-1'],state,paths);assert.equal((await root.readTransactionRecords()).length,0);
});

test('switching to root keeps existing account, transaction and holding identities in place',async()=>{
 const h=harness(),account={financeAccountId:'account-1',name:'Checking',institutionName:'QA',currency:'USD',current:100,available:100};
 const paths=await h.store.upsertAccounts([account]);await h.store.applyTransactions([tx],[],[],state,paths);
 const holding={financeAccountId:'account-1',securityId:'ABC',type:'equity',quantity:2,price:50,value:100,currency:'USD'};
 await h.store.writeSnapshot([account],[holding],paths,new Date('2026-09-16T12:00:00Z'));
 const root=new AtomicFinanceStore(h.app,'');assert.deepEqual(await root.upsertAccounts([account]),paths);
 await root.applyTransactions([],[{...tx,amount:-30}],[],state,paths);
 await root.writeSnapshot([account],[{...holding,value:110}],paths,new Date('2026-09-16T12:00:00Z'));
 assert.equal(h.fm(path).amount,-30);assert.equal(h.fm('Finances/Holdings/account-1%3AABC.md').value,110);
 assert.ok(!h.nodes.has('local-1.md'));assert.ok(!h.nodes.has('account-1%3AABC.md'));
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
