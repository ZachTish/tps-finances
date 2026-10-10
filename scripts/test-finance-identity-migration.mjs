import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {parse, stringify} from 'yaml';

class File {
  constructor(path, source) { this.path=path; this.extension=path.split('.').at(-1); this.stat={mtime:1,size:source.length}; }
}
globalThis.FinanceIdentityQA={File,parse,stringify};
const output=await build({stdin:{contents:`export * from './src/identity-migration.ts'; export {FinanceProperties} from './src/finance-properties.ts'; export {atomicBase} from './src/atomic-finance-store.ts'; export {remapGeneratedBaseIdentities} from './src/property-migration.ts';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',plugins:[{
  name:'obsidian',setup(builder){builder.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));
    builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export class App{}; export const TFile=globalThis.FinanceIdentityQA.File; export const parseYaml=globalThis.FinanceIdentityQA.parse; export const stringifyYaml=globalThis.FinanceIdentityQA.stringify; export const normalizePath=value=>value;'}));}
}]});
const {previewFinanceIdentityMigration,applyFinanceIdentityMigration,consolidateFinanceIdentitySource,FinanceProperties,atomicBase,remapGeneratedBaseIdentities}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));

function harness(primaryKey='id') {
  const files=new Map(),sources=new Map(),counts={reads:0,writes:0,cached:0};
  let beforeProcess=()=>{},beforeRead=()=>{},profile={identityMode:'property',identityPropertyKey:primaryKey};
  const app={plugins:{plugins:{'tps-finances':{settings:{propertyNames:{keys:{}}}},'tps-global-context-menu':{api:{nativeRecords:{getStorageProfile:()=>profile,canCreateIdentity:()=>{throw Error('Duplicate deletion must not allocate identity')}}}}}},
    metadataCache:{getFileCache:()=>{throw Error('Migration must inspect source, not metadata')}},
    vault:{getMarkdownFiles:()=>[...files.values()].filter(file=>file.extension==='md'),getAbstractFileByPath:path=>files.get(path),
      read:async file=>{counts.reads++;beforeRead(file);return sources.get(file.path)},
      cachedRead:async()=>{counts.cached++;throw Error('Unexpected cached source')},
      process:async(file,callback)=>{beforeProcess(file);const next=callback(sources.get(file.path));counts.writes++;
        sources.set(file.path,next);file.stat.mtime++;file.stat.size=next.length;return next;}}};
  const addSource=(path,source)=>{const file=new File(path,source);files.set(path,file);sources.set(path,source);return file};
  const add=(path,raw,body='Body sentinel\n')=>addSource(path,'---\n'+stringify(raw)+'---\n'+body);
  const edit=(path,source,{sameStat=false}={})=>{sources.set(path,source);if(!sameStat){const file=files.get(path);file.stat.mtime++;file.stat.size=source.length}};
  return {app,files,sources,counts,add,addSource,edit,beforeProcess:fn=>beforeProcess=fn,beforeRead:fn=>beforeRead=fn,setProfile:next=>profile=next};
}
const raw=(source)=>parse(source.match(/^---\n([\s\S]*?)\n---/)[1]);
const transaction=(id)=>({kind:'transaction',type:'transaction',financeId:id,title:'QA transaction',financeAccountId:'account-foreign',securityId:'security-foreign',amount:0});

test('equal scalar self ID deletion preserves BOM, CRLF, comments, body and foreign keys byte for byte',()=>{
  const before='\uFEFF---\r\n# keep\r\nid: "same" # primary\r\nfinanceId: same # owned duplicate\r\nfinanceAccountId: foreign\r\nsecurityId: security\r\namount: 0\r\n---\r\nBody **exact**\r\n';
  assert.equal(consolidateFinanceIdentitySource(before,'id','financeId','same'),before.replace('financeId: same # owned duplicate\r\n',''));
});
test('quoted duplicate scalar removal preserves the primary spelling, numeric formatting and terminator',()=>{
  const before='---\nrecordId: "legacy:001" # identity\n"financeId": "legacy:001" # duplicate\namount: 2_000\n...\nBody\n';
  assert.equal(consolidateFinanceIdentitySource(before,'recordId','financeId','legacy:001'),before.replace('"financeId": "legacy:001" # duplicate\n',''));
});
test('conflicting, ambiguous, anchored and multiline self identities are refused',()=>{
  assert.throws(()=>consolidateFinanceIdentitySource('---\nid: one\nfinanceId: two\n---\n','id','financeId','two'),/differ/);
  assert.throws(()=>consolidateFinanceIdentitySource('---\nid: one\nfinanceId: &id one\naccount: *id\n---\n','id','financeId','one'),/standalone/);
  assert.throws(()=>consolidateFinanceIdentitySource('---\nfinanceId: one\nFinanceId: one\n---\n','id','financeId','one'),/more than once/);
  assert.throws(()=>consolidateFinanceIdentitySource('---\nid: one\nfinanceId: |\n  one\n---\n','id','financeId','one'),/identity/);
});
test('preview performs one explicit source inventory, no writes or metadata reads and only selects owned self IDs',async()=>{
  const h=harness();h.add('Transaction.md',{...transaction('transaction'),id:'transaction'});
  h.add('Account.md',{kind:'account',id:'account',financeAccountId:'account',title:'Account'});
  h.add('Budget.md',{kind:'financeBudget',id:'budget',financeBudgetId:'budget',title:'Budget'});
  h.add('Rule.md',{kind:'financeRule',id:'rule',financeRuleId:'rule',title:'Rule'});
  h.add('Holding.md',{kind:'holding',id:'holding',financeAccountId:'account',securityId:'security',title:'Holding'});
  h.add('Ordinary.md',{kind:'note',title:'Ordinary'});
  const before=[...h.sources],preview=await previewFinanceIdentityMigration(h.app);
  assert.equal(preview.inspected,6);assert.equal(preview.notes.length,4);assert.ok(preview.notes.every(note=>!('adopting' in note)));
  assert.deepEqual(preview.conflicts,[]);assert.deepEqual([...h.sources],before);assert.deepEqual(h.counts,{reads:6,writes:0,cached:0});
});
test('confirmed consolidation preserves IDs, all foreign keys and bodies without changing provider settings',async()=>{
  const h=harness('recordId');h.add('Transaction.md',{...transaction('tx'),recordId:'tx'});h.add('Account.md',{kind:'account',recordId:'account',financeAccountId:'account',title:'Account'});
  const pluginBefore=JSON.stringify(h.app.plugins.plugins),preview=await previewFinanceIdentityMigration(h.app);
  assert.equal(await applyFinanceIdentityMigration(h.app,preview),2);
  assert.deepEqual(raw(h.sources.get('Transaction.md')),{kind:'transaction',type:'transaction',title:'QA transaction',financeAccountId:'account-foreign',securityId:'security-foreign',amount:0,recordId:'tx'});
  assert.equal(raw(h.sources.get('Account.md')).recordId,'account');assert.ok(!('financeAccountId' in raw(h.sources.get('Account.md'))));
  assert.match(h.sources.get('Transaction.md'),/Body sentinel\n$/);assert.equal(JSON.stringify(h.app.plugins.plugins),pluginBefore);
  assert.equal(h.counts.reads,4);assert.equal(h.counts.writes,2);assert.equal(h.counts.cached,0);
  const completed=await previewFinanceIdentityMigration(h.app);assert.deepEqual(completed.notes,[]);assert.deepEqual(completed.conflicts,[]);
});
test('duplicate IDs in ordinary native notes block the complete migration before any writes',async()=>{
  const h=harness();h.add('Finance.md',transaction('same'));h.add('Other.md',{kind:'note',id:'same',title:'Other'});
  const before=[...h.sources],preview=await previewFinanceIdentityMigration(h.app);assert.match(preview.conflicts.join('\n'),/Duplicate note identity/);
  await assert.rejects(applyFinanceIdentityMigration(h.app,preview),/conflicts/);assert.deepEqual([...h.sources],before);assert.equal(h.counts.writes,0);
});
test('duplicate legacy IDs across record kinds and case-insensitive native IDs are conflicts',async()=>{
  const h=harness();h.add('Transaction.md',transaction('Same'));h.add('Account.md',{kind:'account',financeAccountId:'same',title:'Account'});
  assert.match((await previewFinanceIdentityMigration(h.app)).conflicts.join('\n'),/Duplicate/);
  const n=harness();n.add('A.md',{kind:'note',id:'other',title:'A'});n.add('B.md',{kind:'note',ID:'OTHER',title:'B'});
  assert.match((await previewFinanceIdentityMigration(n.app)).conflicts.join('\n'),/Duplicate/);
});
test('disagreeing self ID fields block equal-ID cleanup elsewhere instead of silently selecting an ID',async()=>{
  const h=harness();h.add('A.md',{...transaction('a'),id:'a'});h.add('B.md',{...transaction('b'),id:'different'});
  const preview=await previewFinanceIdentityMigration(h.app);assert.match(preview.conflicts.join('\n'),/disagree/);
  await assert.rejects(applyFinanceIdentityMigration(h.app,preview),/conflicts/);assert.equal(h.counts.writes,0);
});
test('a changed reviewed identity or configured storage profile requires another review before writing',async()=>{
  const h=harness();h.add('A.md',{...transaction('a'),id:'a'});let preview=await previewFinanceIdentityMigration(h.app);
  h.edit('A.md','---\n'+stringify({...transaction('changed'),id:'changed'})+'---\nBody\n');
  await assert.rejects(applyFinanceIdentityMigration(h.app,preview),/reviewed finance identities changed/);assert.equal(h.counts.writes,0);
  preview=await previewFinanceIdentityMigration(h.app);h.setProfile({identityMode:'property',identityPropertyKey:'recordId'});
  await assert.rejects(applyFinanceIdentityMigration(h.app,preview),/reviewed finance identities changed/);assert.equal(h.counts.writes,0);
});
test('body edits before confirmation survive the fresh source preflight',async()=>{
  const h=harness();h.add('A.md',{...transaction('a'),id:'a'});const preview=await previewFinanceIdentityMigration(h.app);
  h.edit('A.md',h.sources.get('A.md').replace('Body sentinel','Edited body'));
  await applyFinanceIdentityMigration(h.app,preview);assert.match(h.sources.get('A.md'),/Edited body/);
});
test('same-mtime target edits at the atomic callback are rejected without overwrite',async()=>{
  const h=harness();h.add('A.md',{...transaction('a'),id:'a'});const preview=await previewFinanceIdentityMigration(h.app);
  h.beforeProcess(file=>h.edit(file.path,h.sources.get(file.path).replace('Body sentinel','Body modified'),{sameStat:true}));
  await assert.rejects(applyFinanceIdentityMigration(h.app,preview),/reviewed source changed/);assert.match(h.sources.get('A.md'),/Body modified/);assert.equal(h.counts.writes,0);
});
test('a new note arriving during the finite fresh inventory invalidates review without a retry',async()=>{
  const h=harness();h.add('A.md',{...transaction('a'),id:'a'});const preview=await previewFinanceIdentityMigration(h.app);
  h.beforeRead(()=>h.add('New.md',{kind:'note',id:'new',title:'New'}));
  await assert.rejects(applyFinanceIdentityMigration(h.app,preview),/vault changed/);assert.equal(h.counts.writes,0);assert.ok('financeId' in raw(h.sources.get('A.md')));
});
test('equal-ID deletion does not rescan unchanged namespace per target and permits unrelated content edits',async()=>{
  const h=harness();for(let i=0;i<25;i++)h.add(`${i}.md`,{...transaction(`tx${i}`),id:`tx${i}`});h.add('Other.md',{title:'Other'});
  const preview=await previewFinanceIdentityMigration(h.app);h.beforeProcess(()=>h.edit('Other.md',h.sources.get('Other.md')+'External change\n'));
  assert.equal(await applyFinanceIdentityMigration(h.app,preview),25);assert.equal(h.counts.reads,52);assert.equal(h.counts.writes,25);
});
test('replacement objects and renames at the atomic boundary cannot receive the reviewed mutation',async()=>{
  const h=harness();h.add('A.md',{...transaction('a'),id:'a'});const preview=await previewFinanceIdentityMigration(h.app);
  h.beforeProcess(()=>h.files.set('A.md',new File('A.md',h.sources.get('A.md'))));
  await assert.rejects(applyFinanceIdentityMigration(h.app,preview),/moved or was replaced/);assert.equal(h.counts.writes,0);
});
test('malformed identity frontmatter is disclosed and blocks confirmation',async()=>{
  const h=harness();h.addSource('Broken.md','---\nfinanceId: a\nkind: [transaction\n---\nBody\n');
  const preview=await previewFinanceIdentityMigration(h.app);assert.equal(preview.conflicts.length,1);assert.equal(h.counts.writes,0);
});
test('legacy-only notes stay readable and unchanged, and the source utility rejects adopting their IDs',async()=>{
  const h=harness();h.add('A.md',transaction('a'));h.add('Account.md',{kind:'account',financeAccountId:'account',title:'Account'});
  const before=[...h.sources],preview=await previewFinanceIdentityMigration(h.app);
  assert.deepEqual(preview.notes,[]);assert.deepEqual(preview.conflicts,[]);
  assert.equal(await applyFinanceIdentityMigration(h.app,preview),0);assert.deepEqual([...h.sources],before);assert.equal(h.counts.writes,0);
  assert.equal(new FinanceProperties({},undefined,'id').read(raw(h.sources.get('A.md'))).financeId,'a');
  assert.throws(()=>consolidateFinanceIdentitySource(h.sources.get('A.md'),'id','financeId','a'),/current finance identity is missing/);
  delete h.app.plugins.plugins['tps-global-context-menu'].api.nativeRecords.canCreateIdentity;
  assert.deepEqual((await previewFinanceIdentityMigration(h.app)).conflicts,[]);
});
test('primary-only notes can explicitly upgrade old generated Bases without note mutations or customized Base replacement',async()=>{
  const h=harness();h.add('A.md',{kind:'transaction',id:'a',title:'A'});
  const original=new FinanceProperties().base(atomicBase('','Transactions'));
  h.addSource('Transactions.base',original);h.addSource('Accounts.base','filters:\n  and:\n    - custom == true\nviews: []\n');
  const preview=await previewFinanceIdentityMigration(h.app);assert.deepEqual(preview.notes,[]);assert.equal(preview.bases.length,1);
  assert.equal(preview.bases[0].path,'Transactions.base');assert.match(preview.bases[0].before,/financeId/);assert.match(preview.bases[0].after,/id/);
  const body=h.sources.get('A.md'),custom=h.sources.get('Accounts.base');
  assert.equal(await applyFinanceIdentityMigration(h.app,preview),0);assert.equal(h.counts.writes,0);
  await remapGeneratedBaseIdentities(h.app,'');assert.equal(h.counts.writes,1);assert.equal(h.sources.get('A.md'),body);assert.equal(h.sources.get('Accounts.base'),custom);
});
test('a customized or changed Base after review invalidates the confirmed plan before note mutations',async()=>{
  const h=harness();h.add('A.md',{...transaction('a'),id:'a'});
  h.addSource('Transactions.base',new FinanceProperties().base(atomicBase('','Transactions')));
  const preview=await previewFinanceIdentityMigration(h.app);h.edit('Transactions.base',h.sources.get('Transactions.base')+'# edited\n');
  await assert.rejects(applyFinanceIdentityMigration(h.app,preview),/reviewed finance identities changed/);assert.equal(h.counts.writes,0);
});
test('settings entry is explicit, confirmation is native and no startup migration is installed',()=>{
  const settings=readFileSync('src/settings.ts','utf8'),main=readFileSync('src/main.ts','utf8');
  assert.match(settings,/setName\("Record IDs"\)/);assert.match(settings,/setButtonText\("Review existing IDs"\)/);
  assert.match(settings,/remove matching duplicate self IDs/);assert.match(settings,/Notes with only an older ID stay unchanged and readable/);
  assert.doesNotMatch(settings,/move an older ID|existing ID moved|adopting/);
  assert.match(settings,/class FinanceIdentityModal extends Modal/);assert.match(settings,/preview\.conflicts\.length > 0/);
  assert.match(settings,/role: "alert"/);assert.match(settings,/scope\.register\(\[\], "Enter"/);
  const startup=main.slice(main.indexOf('async onload'),main.indexOf('async previewFinanceIdentityConsolidation'));
  assert.doesNotMatch(startup,/applyFinanceIdentityMigration\(|previewFinanceIdentityMigration\(/);
});
