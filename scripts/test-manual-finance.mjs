import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
class File {constructor(path){this.path=path;this.basename=path.split('/').at(-1).replace(/\.md$/,'');this.extension='md';}}
globalThis.ManualQAFile=File;
const output=await build({stdin:{contents:'export * from "./src/manual-finance";export * from "./src/atomic-finance-store";export * from "./src/finance-summary";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export class App{};export const TFile=globalThis.ManualQAFile;export const normalizePath=s=>s;export const parseYaml=s=>JSON.parse(s);export const stringifyYaml=s=>JSON.stringify(s)+'\\n';`}));}}]});
const {ManualFinanceStore,AtomicFinanceStore,applyManualCashBalances,accountSummaries,validateDate}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
function harness(){
 const nodes=new Map(),text=new Map();let fail=false;
 const fm=p=>JSON.parse(text.get(p).match(/^---\n([\s\S]*?)\n---/)[1]);
 const vault={getAbstractFileByPath:p=>nodes.get(p),getMarkdownFiles:()=>[...nodes.values()].filter(n=>n instanceof File),createFolder:async p=>nodes.set(p,{path:p}),create:async(p,c)=>{if(fail)throw Error('disk full');if(nodes.has(p))throw Error('occupied');const f=new File(p);nodes.set(p,f);text.set(p,c);return f;},read:async f=>text.get(f.path),cachedRead:async f=>text.get(f.path)};
 const app={vault,metadataCache:{getFileCache:f=>({frontmatter:fm(f.path)})},fileManager:{processFrontMatter:async(f,fn)=>{const data=fm(f.path);fn(data);text.set(f.path,'---\n'+JSON.stringify(data)+'\n---\nKeep body');}}};
 return {app,nodes,text,fm,store:new ManualFinanceStore(app,'Inbox/Finance QA'),atomic:new AtomicFinanceStore(app,'Inbox/Finance QA'),fail:()=>fail=true};
}
const input={name:'Wallet',kind:'cash',value:100,currency:'USD',valuationDate:'2026-09-13',assetType:'car',purchaseTransaction:'',liabilityAccount:''};
const entry={title:'Lunch',amount:12.5,date:'2026-09-13',kind:'expense',category:'Food',tags:['#food'],counterpart:'',linkedTransaction:''};

test('manual accounts and one-note transfers use configured primary IDs and preserve foreign links',async()=>{
 const h=harness();h.app.plugins={plugins:{'tps-global-context-menu':{settings:{nativeRecordIdentityPropertyKey:'wrongSavedKey'},api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'recordId'})}}}}};
 const wallet=await h.store.createAccount(input),safe=await h.store.createAccount({...input,name:'Safe',value:200});
 const walletId=h.fm(wallet.path).recordId,safeId=h.fm(safe.path).recordId;
 assert.ok(walletId);assert.ok(safeId);assert.notEqual(walletId,safeId);
 for(const account of [wallet,safe]){assert.equal(h.fm(account.path).financeAccountId,undefined);assert.equal(h.fm(account.path).id,undefined);assert.equal(h.fm(account.path).wrongSavedKey,undefined);}
 const transfer=await h.store.createCashEntry({...entry,accountPath:wallet.path,kind:'transfer-out',counterpart:safe.path});
 const fields=h.fm(transfer.path);assert.ok(fields.recordId);assert.equal(fields.financeId,undefined);assert.equal(fields.financeAccountId,walletId);assert.equal(fields.account,`[[${wallet.path.replace(/\.md$/,'')}]]`);assert.equal(fields.transferAccount,`[[${safe.path.replace(/\.md$/,'')}]]`);
 assert.equal((await h.atomic.readTransactionRecords('metadata')).length,1);assert.equal(h.app.vault.getMarkdownFiles().length,3);
 const asset=await h.store.createAccount({...input,kind:'asset',name:'Car',purchaseTransaction:transfer.path});
 const before=h.fm(asset.path);await h.store.updateValue(asset.path,90,'2026-09-14');
 assert.equal(h.fm(asset.path).recordId,before.recordId);assert.equal(h.fm(asset.path).financeAccountId,undefined);assert.equal(h.fm(asset.path).purchaseTransaction,`[[${transfer.path.replace(/\.md$/,'')}]]`);assert.match(h.text.get(asset.path),/Keep body/);
});

test('conflicting manual account IDs block cash creation before any note is written',async()=>{
 const h=harness();h.app.plugins={plugins:{'tps-global-context-menu':{api:{nativeRecords:{getStorageProfile:()=>({identityMode:'property',identityPropertyKey:'recordId'})}}}}};
 const account=await h.store.createAccount(input);await h.app.fileManager.processFrontMatter(account,raw=>{raw.financeAccountId='different-legacy-owner'});
 const before=new Map(h.text);let attempts=0;const create=h.app.vault.create;h.app.vault.create=async(...args)=>{attempts++;return create(...args)};
 await assert.rejects(h.store.createCashEntry({...entry,accountPath:account.path}),/identity|identifier|conflict/i);assert.equal(attempts,0);assert.deepEqual(h.text,before);
});

function cashFormHarness() {
 const h=harness(),forms=[],notices=[],counts={models:0,snapshots:0,accounts:0,refreshes:0};
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 let method;
 const visit=node=>{if(ts.isMethodDeclaration(node)&&node.name?.getText(ast)==='addCashTransaction')method=node.getText(ast);ts.forEachChild(node,visit);};visit(ast);
 assert.ok(method);
 const code=ts.transpileModule(`export class Owner { ${method} }`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};
 class CashTransactionModal {constructor(app,accounts,save){this.accounts=accounts;this.save=save;}open(){forms.push(this);}}
 class Notice {constructor(message){notices.push(message);}}
 const validate=()=>{if(h.blocked)throw Error('property configuration blocked');};
 new Function('exports','CashTransactionModal','ManualFinanceStore','Notice','logger','financeProperties',code)(exports,CashTransactionModal,ManualFinanceStore,Notice,{flow(){}},validate);
 const snapshot={date:'2026-09-28',lines:['snapshot preserved']};
 const owner=Object.assign(new exports.Owner(),{
  app:h.app,settings:{financeFolder:'Inbox/Finance QA'},
  assertLegacyReviewComplete(){if(h.legacyReviewRequired)throw Error('Review older inline transactions before adding or syncing transactions.')},
  async readLatestSnapshotDocument(){counts.snapshots++;if(h.snapshotError)throw h.snapshotError;return snapshot;},
  readAccountsFromVault(value){counts.accounts++;assert.equal(value,snapshot,'preserve snapshot fallback for account currencies');return h.accounts;},
  async getDashboardModel(){counts.models++;validate();if(h.dashboardError)throw h.dashboardError;return {accounts:this.readAccountsFromVault(await this.readLatestSnapshotDocument())};},
  async refreshDashboard(){counts.refreshes++;},
 });
 h.accounts=[{path:'Wallet.md',name:'Wallet',currency:'EUR',manual:true,type:'depository',subtype:'cash'},
  {path:'Bank.md',name:'Bank',currency:'EUR',manual:false,type:'depository',subtype:'checking'},
  {path:'Asset.md',name:'Asset',currency:'USD',manual:true,type:'other',subtype:'car'}];
 return Object.assign(h,{owner,forms,notices,counts});
}

test('cash form reads accounts with their snapshot but does not load the dashboard',async()=>{
 const h=cashFormHarness();await h.owner.addCashTransaction();
 assert.equal(h.forms.length,1);assert.equal(h.forms[0].accounts,h.accounts);
 assert.deepEqual(h.counts,{models:0,snapshots:1,accounts:1,refreshes:0});
 assert.equal(h.nodes.size,0,'opening a form does not create storage');
});

test('repeated cash form opens and cancellation never request transactions or writes',async()=>{
 const h=cashFormHarness();for(let i=0;i<20;i++)await h.owner.addCashTransaction();
 assert.equal(h.counts.models,0);assert.equal(h.counts.accounts,20);
 assert.equal(h.forms.length,20);assert.equal(h.nodes.size,0);assert.equal(h.counts.refreshes,0);
});

test('missing cash account reports the existing notice without reading a dashboard',async()=>{
 const h=cashFormHarness();h.accounts=h.accounts.filter(a=>!a.manual);await h.owner.addCashTransaction();
 assert.equal(h.forms.length,0);assert.match(h.notices[0],/Create a cash account first/);
 assert.equal(h.counts.models,0);assert.equal(h.nodes.size,0);
});

test('unrelated transaction model failures cannot block opening the cash form',async()=>{
 const h=cashFormHarness();h.dashboardError=Error('Unrelated invalid transaction');
 await h.owner.addCashTransaction();assert.equal(h.forms.length,1);assert.equal(h.counts.models,0);
});

test('cash form configuration and snapshot failures do not open a partial form',async()=>{
 const h=cashFormHarness();h.blocked=true;
 await assert.rejects(h.owner.addCashTransaction(),/configuration blocked/);
 assert.equal(h.counts.snapshots+h.counts.accounts,0);assert.equal(h.forms.length,0);
 h.blocked=false;h.snapshotError=Error('snapshot unavailable');
 await assert.rejects(h.owner.addCashTransaction(),/snapshot unavailable/);
 assert.equal(h.counts.accounts,0);assert.equal(h.forms.length,0);assert.equal(h.nodes.size,0);
});

test('cash form keeps the actual validated writer and refreshes only after a successful record',async()=>{
 const h=cashFormHarness(),account=await h.store.createAccount(input);
 h.accounts=[{...h.accounts[0],path:account.path,currency:'USD'}];
 await h.owner.addCashTransaction();const save=h.forms[0].save;
 const before=h.app.vault.getMarkdownFiles().length;
 await save({...entry,accountPath:account.path});
 assert.equal(h.app.vault.getMarkdownFiles().length,before+1);assert.equal(h.counts.refreshes,1);
 const tx=h.app.vault.getMarkdownFiles().find(f=>f.path!==account.path);
 assert.equal(h.fm(tx.path).amount,-12.5);assert.equal(h.fm(tx.path).currency,'USD');
 assert.deepEqual(h.fm(tx.path).tags,['food']);assert.equal(h.fm(account.path).openingBalance,100);
 await assert.rejects(save({...entry,accountPath:account.path,amount:-1}),/positive amount/);
 assert.equal(h.app.vault.getMarkdownFiles().length,before+1);assert.equal(h.counts.refreshes,1);
});
test('cash form rechecks legacy review before saving an already open modal',async()=>{
 const h=cashFormHarness(),account=await h.store.createAccount(input);
 h.accounts=[{...h.accounts[0],path:account.path,currency:'USD'}];
 await h.owner.addCashTransaction();h.legacyReviewRequired=true;
 const before=h.app.vault.getMarkdownFiles().length;
 await assert.rejects(h.forms[0].save({...entry,accountPath:account.path}),/Review older inline transactions/);
 assert.equal(h.app.vault.getMarkdownFiles().length,before);assert.equal(h.counts.refreshes,0);
});
const wallet=(path='Wallet',openingBalance=100,currency='USD')=>({path:path+'.md',manual:true,type:'depository',subtype:'cash',currency,openingBalance,current:999});
const tx=(amount,other={})=>({manual:true,accountPath:'Wallet',amount,currency:'USD',subtype:amount<0?'purchase':'income',...other});
test('expense/income derive balances; editing, deleting, and retrying model reads do not accumulate',()=>{const a=[wallet()];applyManualCashBalances(a,[tx(-10),tx(5)]);assert.equal(a[0].current,95);applyManualCashBalances(a,[tx(-20),tx(5)]);assert.equal(a[0].current,85);applyManualCashBalances(a,[tx(5)]);assert.equal(a[0].current,105);applyManualCashBalances(a,[tx(5)]);assert.equal(a[0].current,105);});
test('single cash transfer conserves net worth in both directions',()=>{for(const amount of [-25,25]){const a=[wallet(),wallet('Safe',200)];applyManualCashBalances(a,[tx(amount,{transferAccount:'[[Safe]]',subtype:amount<0?'transfer-out':'transfer-in'})]);assert.equal(a[0].current,100+amount);assert.equal(a[1].current,200-amount);assert.equal(accountSummaries(a,[])[0].netWorth,300);}});
test('provider balances and transactions never become manual adjustments',()=>{const a=[wallet(),{path:'Bank.md',type:'depository',currency:'USD',current:1000}];applyManualCashBalances(a,[tx(50,{transferAccount:'[[Bank]]',subtype:'transfer-in'}),tx(-50,{manual:false,accountPath:'Bank'})]);assert.equal(a[0].current,150);assert.equal(a[1].current,1000);});
test('assets add their current value once; linked debt remains separate',()=>{const a=[{manual:true,type:'other',currency:'USD',current:300000,liabilityAccount:'[[Mortgage]]'},{type:'loan',currency:'USD',current:-200000}];assert.deepEqual(accountSummaries(a,[])[0],{currency:'USD',netWorth:100000,cash:0,investments:0,debt:200000,assets:300000});});
test('invalid ledgers fail rather than displaying a manufactured balance',()=>{assert.throws(()=>applyManualCashBalances([wallet()], [tx(NaN)]),/invalid/);assert.throws(()=>applyManualCashBalances([wallet()], [tx(1,{currency:'EUR'})]),/currency/);assert.throws(()=>applyManualCashBalances([wallet()], [tx(1,{accountPath:'Missing'})]),/missing/);assert.throws(()=>applyManualCashBalances([wallet('Wallet',NaN)], []),/opening balance/);});
test('creates atomic cash account and transaction with normalized tags and no cached current',async()=>{const h=harness(),account=await h.store.createAccount(input);assert.equal(h.fm(account.path).openingBalance,100);assert.equal(h.fm(account.path).current,undefined);const f=await h.store.createCashEntry({...entry,accountPath:account.path});assert.equal(h.fm(f.path).amount,-12.5);assert.deepEqual(h.fm(f.path).tags,['food']);assert.equal(h.fm(f.path).categoryOverride,'Food');const records=await h.atomic.readTransactionRecords();assert.equal(records.length,1);assert.match(records[0].line,/financeSource:: manual/);});
test('account validation reads file contents even when metadata cache is stale',async()=>{const h=harness(),account=await h.store.createAccount(input);h.app.metadataCache.getFileCache=()=>({});await h.store.createCashEntry({...entry,accountPath:account.path});assert.equal(h.app.vault.getMarkdownFiles().length,2);});
test('transfer rejects self, missing counterpart, foreign currency, and resale asset',async()=>{const h=harness(),a=await h.store.createAccount(input),eur=await h.store.createAccount({...input,name:'EUR',currency:'EUR'}),asset=await h.store.createAccount({...input,name:'Car',kind:'asset'});for(const counterpart of ['',a.path,eur.path,asset.path])await assert.rejects(h.store.createCashEntry({...entry,accountPath:a.path,kind:'transfer-out',counterpart}));});
test('valid transfer persists one note and links both accounts',async()=>{const h=harness(),a=await h.store.createAccount(input),b=await h.store.createAccount({...input,name:'Safe'});const f=await h.store.createCashEntry({...entry,accountPath:a.path,kind:'transfer-out',counterpart:b.path});assert.equal(h.fm(f.path).subtype,'transfer-out');assert.equal((await h.atomic.readTransactionRecords()).length,1);assert.match((await h.atomic.readTransactionRecords())[0].line,/transferAccount:: \[\[/);});
test('asset valuation update preserves purchase/loan links and body, and creates no income',async()=>{const h=harness(),purchase=await h.app.vault.create('Purchase.md','---\n{}\n---\n'),a=await h.store.createAccount({...input,kind:'asset',purchaseTransaction:purchase.path});await h.store.updateValue(a.path,90,'2026-09-14');assert.equal(h.fm(a.path).current,90);assert.equal(h.fm(a.path).valuationDate,'2026-09-14');assert.equal(h.fm(a.path).purchaseTransaction,'[[Purchase]]');assert.match(h.text.get(a.path),/Keep body/);assert.equal((await h.atomic.readTransactionRecords()).length,0);await assert.rejects(h.store.updateValue(a.path,-1,'2026-09-14'));});
test('invalid dates, amounts, currencies and unsafe links do not create notes',async()=>{const h=harness();for(const changes of [{value:NaN},{value:-1},{currency:'US'},{valuationDate:'2026-02-30'},{purchaseTransaction:'../private'}])await assert.rejects(h.store.createAccount({...input,...changes}));assert.equal(h.nodes.size,0);assert.throws(()=>validateDate('2026-13-01'));});
test('failed transaction write does not mutate the cash account',async()=>{const h=harness(),a=await h.store.createAccount(input),before=h.text.get(a.path);h.fail();await assert.rejects(h.store.createCashEntry({...entry,accountPath:a.path}),/disk full/);assert.equal(h.text.get(a.path),before);});

test('root manual cash and resale assets create flat notes and readable transactions',async()=>{
 const h=harness(),store=new ManualFinanceStore(h.app,''),atomic=new AtomicFinanceStore(h.app,'');
 const account=await store.createAccount(input),asset=await store.createAccount({...input,name:'Computer',kind:'asset'});
 const entryFile=await store.createCashEntry({...entry,accountPath:account.path});
 assert.ok([account,asset,entryFile].every(f=>!f.path.includes('/')));
 assert.ok([...h.nodes.values()].every(n=>n instanceof File));
 assert.equal((await atomic.readTransactionRecords()).length,1);
 await store.updateValue(asset.path,90,'2026-09-16');assert.equal(h.fm(asset.path).current,90);
});
