import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=await build({entryPoints:['src/finance-wallet.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {parseWalletParts}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const a='11111111-1111-4111-8111-111111111111', t='22222222-2222-4222-8222-222222222222';
const account={id:a,name:'Synthetic Card',institution:'Synthetic Bank',kind:'liability',currency:'USD',current:'100.50',available:'899.50',limit:'1000'};
const transaction={id:t,accountID:a,date:'2026-09-21',description:'SYNTHETIC PURCHASE',merchant:'Synthetic Shop',amount:'12.50',direction:'debit',status:'pending',currency:'USD',transactionType:'pointOfSale'};
const part=(transactions=[transaction])=>({version:1,accounts:[account],transactions,deletedTransactions:[]});
test('Wallet preserves provider identities and converts debit/credit into TPS signs',()=>{
 const debit=parseWalletParts([part()]); assert.equal(debit.transactions[0].amount,-12.5); assert.equal(debit.accounts[0].current,100.5); assert.equal(debit.accounts[0].type,'credit');
 const credit=parseWalletParts([part([{...transaction,direction:'credit',status:'booked'}])]); assert.equal(credit.transactions[0].amount,12.5); assert.equal(credit.transactions[0].pending,false); assert.equal(credit.transactions[0].financeId,debit.transactions[0].financeId);
});
test('asset overdrawn and zero balances remain exact, unavailable balances stay null',()=>{
 const input=part([]); input.accounts=[{...account,kind:'asset',current:'-10.01',available:'0',limit:null}];
 const out=parseWalletParts([input]); assert.equal(out.accounts[0].current,-10.01);assert.equal(out.accounts[0].available,0);assert.equal(out.accounts[0].limit,null);
});
test('Swift omitted optional balances are unknown, never zero',()=>{
 const input=part([]); const {current,available,limit,...withoutBalances}=account; input.accounts=[withoutBalances];
 const out=parseWalletParts([input]); assert.equal(out.accounts[0].current,null);assert.equal(out.accounts[0].available,null);assert.equal(out.accounts[0].limit,null);
});
test('history corrections fold in order, rejected and explicit removed records retire only matching IDs',()=>{
 const next={version:1,accounts:[],transactions:[{...transaction,status:'booked',amount:'15'}],deletedTransactions:[]};
 assert.equal(parseWalletParts([part(),next]).transactions[0].amount,-15);
 next.transactions[0].status='rejected'; const out=parseWalletParts([part(),next]);assert.equal(out.transactions.length,0);assert.deepEqual(out.removed,['financekit:'+t]);
 next.transactions=[];next.deletedTransactions=[t];assert.equal(parseWalletParts([part(),next]).transactions.length,0);
});
test('missing or limited consent never implies account or transaction deletion',()=>{
 assert.deepEqual(parseWalletParts([{version:1,accounts:[],transactions:[],deletedTransactions:[]}]),{accounts:[],transactions:[],removed:[]});
});
for (const [label,mutate] of [
 ['foreign account',p=>p.transactions[0].accountID=t],['unsafe ID',p=>p.accounts[0].id='../other'],['invalid date',p=>p.transactions[0].date='2026-02-31'],
 ['negative magnitude',p=>p.transactions[0].amount='-10'],['nondecimal',p=>p.transactions[0].amount='1e3'],['NaN',p=>p.accounts[0].current='NaN'],
 ['unsupported direction',p=>p.transactions[0].direction='unknown'],['unknown status',p=>p.transactions[0].status='future'],['noncurrency',p=>p.accounts[0].currency='US'],
 ['malformed deletion',p=>p.deletedTransactions.push('../../note')],['duplicate account',p=>p.accounts.push({...p.accounts[0]})],['future schema',p=>p.version=2],
]) test('rejects '+label+' before returning an import plan',()=>{const p=structuredClone(part());mutate(p);assert.throws(()=>parseWalletParts([p]));});
test('batch limits cover all accounts and combined history changes',()=>{
 const many={version:1,accounts:Array.from({length:100},(_,i)=>({...account,id:i.toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111'})),transactions:[],deletedTransactions:[]};
 assert.throws(()=>parseWalletParts([many,{...part([])}]),/too many accounts/);
 assert.throws(()=>parseWalletParts([{...part(Array(200).fill(transaction)),deletedTransactions:[t]}]),/Invalid Wallet transfer part/);
});
