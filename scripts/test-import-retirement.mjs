import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
const main=readFileSync('src/main.ts','utf8');
test('import owners, commands and device-secret startup access are removed',()=>{
 for(const file of ['finance-relay','plaid-client','plaid-link','finance-wallet','investment-sync','device-state','hosted-link','plaid-credentials'])assert.equal(existsSync('src/'+file+'.ts'),false,file);
 assert.doesNotMatch(main,/createControllerBackend|controllerFinanceBackend|syncAll|syncLocal|getFinanceRelay|loadDeviceState|secretStorage|new PlaidClient|id: "connect-plaid"|id: "sync-finances"/);
 for(const command of ['add-cash-account','add-resale-asset','add-cash-transaction','add-monthly-budget','review-transaction-titles'])assert.ok(main.includes('id: "'+command+'"'),command);
});
test('40 connection panel opens do no provider, state, timer or vault work',async()=>{
 const result=await build({entryPoints:['src/connection-settings.ts'],bundle:true,write:false,platform:'node',format:'esm',external:['obsidian']});
 const {FinanceConnectionSettings}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const poison=new Proxy({}, {get(){throw new Error('retired settings accessed runtime');}});
 let renders=0;const panel=new FinanceConnectionSettings(poison,poison,{empty(){},createEl(tag,options){assert.match(options.text,/retired/);renders++;}});
 for(let i=0;i<40;i++)panel.render();panel.dispose();assert.equal(renders,40);
});


test('retired inline rerouting and daily-ledger migration writers are absent',()=>{
 const legacy=readFileSync('src/finance-store.ts','utf8');
 const atomic=readFileSync('src/atomic-finance-store.ts','utf8');
 assert.doesNotMatch(legacy,/migrateLegacyTransactionLedgers|rerouteTransactions|removeEmptyLegacyLedger|applyTransactions|replaceInvestmentTransactions|updateTransactionMetadata|upsertTransaction|removeTransaction|resolveTransactionTarget|writeSnapshot|replaceGeneratedBlock|findFinanceLedgerFile|balanceSnapshotLine|holdingSnapshotLine/);
 assert.equal(existsSync("src/transaction-content.ts"),false);
 assert.doesNotMatch(atomic,/rerouteTransactions/);
 assert.match(atomic,/async migrateLegacyTransactionLedgers/,'explicit whole-note migration remains');
 assert.match(atomic,/super\.readTransactionRecords/,'legacy reads are retained for explicit migration');
});

test('holding provider scan and writer are retired; display and manual edits remain',()=>{
 const atomic=readFileSync('src/atomic-finance-store.ts','utf8');
 assert.doesNotMatch(atomic,/writeSnapshot|holdingTitle|holdingFiles/);
 assert.match(atomic,/async readTransactionRecords/);
 assert.match(atomic,/async updateTransactionMetadata/);
});

test('provider account upsert and lookup machinery are absent',()=>{
 const source=readFileSync('src/finance-store.ts','utf8');
 assert.doesNotMatch(source,/upsertAccounts|findAccountFile|indexAccountFiles|isCurrentAccountFile|createAccountFile|accountDisplayName|accountFields/);
});

test('provider transaction batches and their source formatter are absent',()=>{
 const source=readFileSync('src/atomic-finance-store.ts','utf8');
 assert.doesNotMatch(source,/applyTransactions|replaceInvestmentTransactions|transactionFields|providerIdentityKey|DeviceState/);
 assert.match(source,/async migrateLegacyTransactionLedgers/);
 assert.match(source,/async updateTransactionMetadata/);
});


test('retired provider transaction updates cannot be reached by an explicit legacy conversion',()=>{
 const atomic=readFileSync('src/atomic-finance-store.ts','utf8');
 const titles=readFileSync('src/transaction-titles.ts','utf8');
 const properties=readFileSync('src/transaction-properties.ts','utf8');
 assert.doesNotMatch(atomic,/providerTransactionFields|absentProviderProperties|private async put\(/);
 assert.doesNotMatch(titles,/providerTransactionFields/);
 assert.doesNotMatch(properties,/compactTransactionProperties|absentProviderProperties/);
 assert.match(atomic,/private async createMigrationNote/);
});


test('retired importer preferences disappear on an ordinary save while credential references and provider state survive',async()=>{
 const normalization=main.slice(main.indexOf('function normalizeSettings('),main.indexOf('function localDate('));
 const writer=main.slice(main.indexOf('    this.settingsWriter = new CoalescedSnapshotWriter('),main.indexOf('    logger.setLoggingEnabled',main.indexOf('    this.settingsWriter = new CoalescedSnapshotWriter(')));
 const source=`import {DEFAULT_SETTINGS} from './src/types'; import {CoalescedSnapshotWriter,reconcilePersistedSnapshot} from './src/settings-persistence';
 const normalizePropertyNames=value=>value||{keys:{}};const normalizePropertyMigration=value=>value||null;const normalizeFinanceFolder=(value,fallback)=>value||fallback;
 ${normalization}
 export {DEFAULT_SETTINGS,normalizeSettings};export function initialize(){${writer}}`;
 const result=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
 const {DEFAULT_SETTINGS,normalizeSettings,initialize}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const retired={plaidEnvironment:'production',oauthRedirectUri:'fixture://retired',transactionHistoryDays:500};
 for(const key of [...Object.keys(retired),'plaidClientIdSecret','plaidSecretSecret'])assert.equal(Object.hasOwn(DEFAULT_SETTINGS,key),false,key);
 let disk={...retired,plaidClientIdSecret:'existing-client-reference',plaidSecretSecret:'existing-secret-reference',enableLogging:false,deviceState:{items:[{cursor:'existing'}]},futureExtension:{keep:true}};
 const original=structuredClone(disk);let writes=0;
 const host={settings:normalizeSettings(disk),loadData:async()=>structuredClone(disk),saveData:async value=>{writes++;disk=structuredClone(value);}};
 initialize.call(host);await host.settingsWriter.save(host.settings);assert.equal(writes,0);assert.deepEqual(disk,original);
 disk.futureExtension.concurrent=true;host.settings.enableLogging=true;await host.settingsWriter.save(host.settings);
 assert.equal(writes,1);for(const key of Object.keys(retired))assert.equal(Object.hasOwn(disk,key),false,key);
 assert.equal(disk.plaidClientIdSecret,'existing-client-reference');assert.equal(disk.plaidSecretSecret,'existing-secret-reference');
 assert.deepEqual(disk.deviceState,original.deviceState);assert.deepEqual(disk.futureExtension,{keep:true,concurrent:true});assert.equal(disk.enableLogging,true);
});
