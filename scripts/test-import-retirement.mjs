import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
const main=readFileSync('src/main.ts','utf8');
const dashboard=readFileSync('src/dashboard-view.ts','utf8');
test('import owners, commands and device-secret startup access are removed',()=>{
 for(const file of ['finance-relay','plaid-client','plaid-link','finance-wallet','investment-sync','device-state','hosted-link','plaid-credentials'])assert.equal(existsSync('src/'+file+'.ts'),false,file);
 assert.doesNotMatch(main,/createControllerBackend|controllerFinanceBackend|syncAll|syncLocal|getFinanceRelay|loadDeviceState|secretStorage|new PlaidClient|id: "connect-plaid"|id: "sync-finances"/);
 assert.doesNotMatch(dashboard,/plugin\.syncAll|plugin\.connectPlaid|model\.connectedItems|model\.plaidSetupState|model\.relayMessage|"Connections"/);
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
