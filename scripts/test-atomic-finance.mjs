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
 for(const [key,value] of [['title','Changed'],['merchant','Another'],['financeId','other'],['financeSource','manual'],['account','[[Elsewhere]]']]) {
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
 raw.transactions=[];raw.deletedTransactions=[id];h.failTrash();await assert.rejects(apply(),/trash failure/);assert.ok(h.nodes.has(file.path));
});
