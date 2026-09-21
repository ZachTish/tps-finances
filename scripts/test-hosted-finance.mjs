import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {webcrypto} from 'node:crypto';
import {builtinModules} from 'node:module';
const compile=async(entry,stubs)=>{
 const result=await build({entryPoints:[`src/${entry}.ts`],bundle:true,write:false,format:'cjs',platform:'browser',external:['obsidian','electron',...builtinModules]});
 const m={exports:{}};new Function('module','exports','require','crypto',result.outputFiles[0].text)(m,m.exports,n=>{if(n==='obsidian')return stubs;throw Error(`Node import: ${n}`);},webcrypto);return m.exports;
};
const {PlaidClient,parseHostedLinkResult}=await compile('plaid-client',{});
const {getFinanceRelay}=await compile('finance-relay',{Modal:class{}});
const platform={isDesktopApp:true,isMobile:false};
const {default:Plugin}=await compile('main',{Plugin:class{},ItemView:class{},Modal:class{},PluginSettingTab:class{},Platform:platform,normalizePath:p=>p});
function harness(){
 const secrets=new Map(),local=new Map(),calls=[];
 const config={plaidEnvironment:'sandbox',plaidClientIdSecret:'client-ref',plaidSecretSecret:'secret-ref',oauthRedirectUri:''};
 const relay={version:1,getConfiguration:()=>({mode:'host',enabled:true}),getStatus:()=>({items:[],online:true,enabled:relay.getConfiguration().enabled,mode:relay.getConfiguration().mode})};
 const transport={version:1,getConfiguration:()=>config,inspect:()=>({state:'ready'}),request:async(env,path,body,c,s)=>{
  calls.push({env,path,body,c,s});
  if(path==='/link/token/create')return{status:200,json:{link_token:'synthetic-link-token',hosted_link_url:'https://secure.plaid.com/hl/fixture',expiration:'2099-01-01T00:00:00Z'}};
  if(path==='/item/public_token/exchange')return{status:200,json:{access_token:'synthetic-access-token',item_id:'provider-id'}};
  return{status:200,json:{}};
 }};
 const plugin=new Plugin();plugin.app={plugins:{plugins:{'tps-controller':{api:{plaid:transport,financeRelay:relay,isController:()=>true}}}},secretStorage:{getSecret:k=>secrets.get(k),setSecret:(k,v)=>secrets.set(k,v)},loadLocalStorage:k=>local.get(k),saveLocalStorage:(k,v)=>local.set(k,v)};
 const backend=plugin.createControllerBackend();return{plugin,backend,secrets,local,relay,calls,config};
}
test('hosted token creation uses browser mode and update mode retains its access token',async()=>{
 const calls=[];const client=new PlaidClient(async(path,body)=>{calls.push({path,body});return{status:200,json:{link_token:'link-test',hosted_link_url:'https://secure.plaid.com/hl/test',expiration:'2099-01-01T00:00:00Z'}};});
 await client.createHostedLink('local-user',365);assert.deepEqual(calls[0].body.hosted_link,{is_mobile_app:false,url_lifetime_seconds:1800});assert.equal(calls[0].body.transactions.days_requested,365);assert.ok(!('redirect_uri' in calls[0].body));
 await client.createHostedLink('local-user',365,'access-test');assert.equal(calls[1].body.access_token,'access-test');assert.ok(!('products' in calls[1].body));
});
test('hosted responses support modern/legacy results, update handoff, late results and reject multiple items',()=>{
 assert.deepEqual(parseHostedLinkResult({link_sessions:[{results:{item_add_results:[{public_token:'public-test',institution:{name:'Bank'}}]}}]},false),{state:'complete',publicToken:'public-test',institutionName:'Bank'});
 assert.equal(parseHostedLinkResult({link_sessions:[{on_success:{public_token:'public-test'}}]},false).state,'complete');
 assert.equal(parseHostedLinkResult({link_sessions:[{on_success:{public_token:''}}]},true).state,'complete');
 assert.equal(parseHostedLinkResult({link_sessions:[{events:[{event_name:'HANDOFF'}]}]},true).state,'complete');
 assert.equal(parseHostedLinkResult({link_sessions:[{finished_at:'2026-09-18',on_exit:{}}]},false).state,'waiting');
 assert.equal(parseHostedLinkResult({link_sessions:[{events:[{event_name:'TRANSITION_VIEW'}]}]},true).state,'waiting');
 assert.throws(()=>parseHostedLinkResult({link_sessions:[{results:{item_add_results:[{public_token:'a'},{public_token:'b'}]}}]},false),/multiple/);
});
test('Controller saves access token and completion receipt before import, replays never exchange again',async()=>{
 const h=harness();h.backend.prepareHost();const session=await h.backend.createLink();await h.backend.completeLink(session,{state:'complete',publicToken:'public-test',institutionName:'Bank'},'request-1');
 assert.equal(h.backend.hasCompleted('request-1'),true);await h.backend.completeLink(session,{state:'complete',publicToken:'public-test'},'request-1');assert.equal(h.calls.filter(c=>c.path==='/item/public_token/exchange').length,1);
 const saved=JSON.parse(h.secrets.get('tps-finances-device-state'));assert.equal(saved.items[0].accessToken,'synthetic-access-token');assert.equal(saved.items[0].linkRequestId,'request-1');
 assert.ok(!JSON.stringify(h.backend.snapshot()).includes('synthetic-access-token'));assert.ok(!JSON.stringify(h.backend.snapshot()).includes('provider-id'));
});
test('reconnect retains account identity, cursor and environment despite changed defaults',async()=>{
 const h=harness();h.backend.prepareHost();const session=await h.backend.createLink();await h.backend.completeLink(session,{state:'complete',publicToken:'public-test'},'r1');
 const stored=JSON.parse(h.secrets.get('tps-finances-device-state'));stored.items[0].cursor='durable-cursor';h.secrets.set('tps-finances-device-state',JSON.stringify(stored));h.config.plaidEnvironment='production';
 const update=await h.backend.createLink(stored.items[0].localItemId);assert.equal(update.environment,'sandbox');await h.backend.completeLink(update,{state:'complete'},'r2');
 const after=JSON.parse(h.secrets.get('tps-finances-device-state'));assert.equal(after.items.length,1);assert.equal(after.items[0].cursor,'durable-cursor');assert.equal(after.items[0].localItemId,stored.items[0].localItemId);assert.equal(h.calls.filter(c=>c.path==='/item/public_token/exchange').length,1);
});
test('lost or corrupt Controller state never silently becomes a new connection',async()=>{
 for(const value of [null,'{}','not-json']){const h=harness();h.backend.prepareHost();if(value===null)h.secrets.delete('tps-finances-device-state');else h.secrets.set('tps-finances-device-state',value);await assert.rejects(()=>h.backend.createLink());assert.equal(h.calls.length,0);assert.throws(()=>h.backend.prepareHost());}
});
test('paired client actions go to the Controller and survive missing Controller without local fallback',async()=>{
 const h=harness();h.relay.getConfiguration=()=>({mode:'client',enabled:true});const calls=[];h.relay.request=async(...args)=>{calls.push(args);return 'r1';};h.plugin.showFinanceRequest=()=>{};
 platform.isMobile=true;try{await h.plugin.connectPlaid();await h.plugin.reconnectItem('item');await h.plugin.syncAll('test');await h.plugin.disconnectItem('item');assert.deepEqual(calls,[['connect',undefined],['reconnect','item'],['sync',undefined],['disconnect','item']]);assert.equal(h.calls.length,0);await assert.rejects(()=>h.backend.createLink(),/Only the paired desktop/);}finally{platform.isMobile=false;}
 h.local.set('tps-finance-relay-v1',{mode:'client'});delete h.plugin.app.plugins.plugins['tps-controller'];await assert.rejects(()=>h.plugin.connectPlaid(),/Enable TPS Controller/);assert.equal(h.calls.length,0);
});
test('paired configuration disabled on this device blocks new actions without switching to local Plaid',async()=>{
 const h=harness();h.relay.getConfiguration=()=>({mode:'host',enabled:false});assert.equal(h.plugin.canConnectPlaid(),false);await assert.rejects(()=>h.backend.createLink(),/Only the paired desktop/);assert.equal(h.calls.length,0);
});

test('long-running host refreshes shared routing/settings before linking and importing',async()=>{
 const h=harness();h.backend.prepareHost();let refreshes=0;
 h.plugin.settingsWriter={save:async()=>{refreshes++;h.plugin.settings={...h.plugin.settings,financeFolder:'',transactionHistoryDays:730};}};
 await h.backend.createLink();assert.equal(h.calls.at(-1).body.transactions.days_requested,730);
 h.plugin.syncLocal=async()=>{assert.equal(h.plugin.settings.financeFolder,'');};await h.backend.sync();assert.equal(refreshes,2);
});

test('host commits its transaction cursor only after every started write drains, and failed imports can retry',async()=>{
 const {boundedWork}=await compile('bounded-work',{});
 const h=harness();h.backend.prepareHost();const session=await h.backend.createLink();
 await h.backend.completeLink(session,{state:'complete',publicToken:'public-test'},'cursor-qa');
 h.plugin.deviceState.items[0].cursor='before';h.plugin.saveDeviceState();
 h.plugin.readLatestSnapshotDocument=async()=>null;h.plugin.readAccountsFromVault=()=>[];
 h.plugin.parseSnapshotHoldings=()=>[];h.plugin.refreshDashboard=async()=>{};h.plugin.accountPathEntries=async()=>[];
 let release,failed=false,settled=false,fail=true;
 const gate=new Promise(resolve=>release=resolve);
 h.plugin.createStore=()=>({
  ensureStructure:async()=>{},migrateLegacyTransactionLedgers:async()=>({moved:0,skipped:0}),upsertAccounts:async()=>new Map(),
  applyTransactions:async()=>{await boundedWork([0,1],async id=>{if(fail&&id===0){failed=true;throw Error('synthetic disk failure');}if(fail)await gate;});return {added:2,modified:0,removed:0};},
  replaceInvestmentTransactions:async()=>{},writeSnapshot:async()=>{},
 });
 h.plugin.createPlaidClient=()=>({getAccounts:async()=>[{financeAccountId:'account-1'}],syncTransactions:async()=>({added:[],modified:[],removedProviderIds:[],nextCursor:'after'}),getInvestmentTransactions:async()=>({status:'ok',value:[]}),getHoldings:async()=>({status:'ok',value:[]})});
 const run=h.backend.sync().then(()=>{settled=true;throw Error('expected failure');},error=>{settled=true;return error;});
 while(!failed)await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(settled,false);assert.equal(h.plugin.deviceState.items[0].cursor,'before');
 assert.equal(JSON.parse(h.secrets.get('tps-finances-device-state')).items[0].cursor,'before');
 release();assert.match(String(await run),/synthetic disk failure/);assert.equal(h.plugin.syncing,false);
 assert.equal(JSON.parse(h.secrets.get('tps-finances-device-state')).items[0].cursor,'before');
 fail=false;await h.backend.sync();assert.equal(JSON.parse(h.secrets.get('tps-finances-device-state')).items[0].cursor,'after');
});

test('Wallet imports are host-only, refresh mappings, validate before writes and retain retry identity',async()=>{
 const h=harness();h.backend.prepareHost();const accountId='11111111-1111-4111-8111-111111111111',transactionId='22222222-2222-4222-8222-222222222222';
 const parts=[{version:1,accounts:[{id:accountId,name:'Synthetic Card',institution:'Synthetic Wallet',kind:'liability',currency:'USD',current:'25',available:'975',limit:'1000'}],transactions:[{id:transactionId,accountID:accountId,date:'2026-09-21',description:'Synthetic food',merchant:'Shop',amount:'25',direction:'debit',status:'booked',currency:'USD',transactionType:'pointOfSale'}],deletedTransactions:[]}];
 h.plugin.settings.recordMode='atomic-note';let refreshed=0,writes=0,fail=true;const revisions=[];
 h.plugin.settingsWriter={save:async()=>{refreshed++;h.plugin.settings.financeFolder='';}};
 h.plugin.createStore=()=>({upsertAccounts:async accounts=>{writes++;assert.equal(h.plugin.settings.financeFolder,'');return new Map([[accounts[0].financeAccountId,'Card.md']]);},applyTransactions:async(added,modified,removed,state,paths)=>{revisions.push(added[0]);assert.equal(added[0].amount,-25);assert.equal(added[0].subtype,'purchase');assert.equal(paths.get(added[0].financeAccountId),'Card.md');if(fail)throw Error('disk');}});
 h.plugin.refreshDashboard=async()=>{};
 await assert.rejects(()=>h.backend.importWallet(parts),/disk/);assert.equal(h.plugin.syncing,false);fail=false;await h.backend.importWallet(parts);assert.deepEqual(revisions[0],revisions[1]);assert.equal(refreshed,2);assert.equal(writes,2);
 const broken=structuredClone(parts);broken[0].transactions[0].amount='NaN';await assert.rejects(()=>h.backend.importWallet(broken));assert.equal(writes,2);
 h.relay.getConfiguration=()=>({mode:'client',enabled:true});await assert.rejects(()=>h.backend.importWallet(parts),/Only the paired desktop/);assert.equal(writes,2);assert.equal(h.calls.length,0,'Wallet import never calls Plaid');
});
