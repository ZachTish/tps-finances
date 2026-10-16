import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=await build({entryPoints:['src/finance-summary.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {accountSummaries}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
test('existing card debt and savings balances contribute once to net worth',()=>{
 const card={financeAccountId:'card',type:'credit',currency:'USD',current:-100.5};
 const savings={financeAccountId:'savings',type:'depository',currency:'USD',current:1000};
 assert.deepEqual(accountSummaries([card,savings],[]),[{currency:'USD',netWorth:899.5,cash:1000,investments:0,debt:100.5,assets:0}]);
});
test('credit, zero and unavailable card balances preserve their signed contribution',()=>{
 for(const [current,netWorth,debt] of [[25,25,-25],[0,0,0],[null,0,0]]){
  assert.deepEqual(accountSummaries([{type:'credit',currency:'USD',current}],[]),[{currency:'USD',netWorth,cash:0,investments:0,debt,assets:0}]);
 }
});
test('overdrawn cash remains negative and does not become a loan',()=>{
 assert.deepEqual(accountSummaries([{type:'depository',currency:'USD',current:-10.01}],[]),[{currency:'USD',netWorth:-10.01,cash:-10.01,investments:0,debt:0,assets:0}]);
});
