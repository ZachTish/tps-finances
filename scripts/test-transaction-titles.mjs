import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const notices=[];
class Modal {constructor(){this.contentEl={ownerDocument:{activeElement:null},contains:()=>false};this.scope={register:(_m,_k,fn)=>{this.enter=fn}};}}
globalThis.TitleQAModal=Modal;globalThis.TitleQANotice=class{constructor(message){notices.push(message)}};
const result=await build({entryPoints:['src/transaction-title-modal.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'obsidian',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const Modal=globalThis.TitleQAModal;export const Notice=globalThis.TitleQANotice;export class App{};'}));}}]});
const {TransactionTitleModal}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function modal(store,refresh=async()=>{}){const m=new TransactionTitleModal({},[],store,refresh);m.render=()=>{};m.contentEl.querySelector=()=>null;return m;}
test('modal Enter activates only an enabled focused button within the review',()=>{
 const m=modal({});let clicks=0;const button={tagName:'BUTTON',disabled:false,click:()=>clicks++};
 m.contentEl.ownerDocument.activeElement=button;m.contentEl.contains=()=>true;
 assert.equal(m.enter(),false);assert.equal(clicks,1);
 button.disabled=true;assert.equal(m.enter(),false);assert.equal(clicks,1);
 m.contentEl.contains=()=>false;assert.equal(m.enter(),true);assert.equal(clicks,1);
 m.contentEl.ownerDocument.activeElement={tagName:'INPUT'};assert.equal(m.enter(),true);
});
test('partial review failure retries only the remaining selected notes',async()=>{
 const a={path:'a'},b={path:'b'},c={path:'c'},calls=[];let fail=true,refreshes=0;
 const m=modal({applyTransactionTitle:async change=>{calls.push(change.path);if(change===b&&fail)throw Error('disk failure')}},async()=>refreshes++);
 m.changes=[a,b,c];m.selected=new Set([a,b]);await m.save();
 assert.deepEqual(calls,['a','b']);assert.deepEqual(m.changes,[b,c]);assert.deepEqual([...m.selected],[b]);assert.equal(refreshes,1);assert.equal(m.busy,false);
 fail=false;await m.save();assert.deepEqual(calls,['a','b','b']);assert.deepEqual(m.changes,[c]);assert.equal(m.selected.size,0);assert.equal(refreshes,2);
});
test('review prevents double submission during an active write',async()=>{
 let resolve,calls=0;const pending=new Promise(r=>resolve=r),a={path:'a'};
 const m=modal({applyTransactionTitle:async()=>{calls++;await pending}});m.changes=[a];m.selected.add(a);
 const first=m.save();await m.save();assert.equal(calls,1);assert.equal(m.busy,true);resolve();await first;assert.equal(m.selected.size,0);
});
test('a dashboard refresh failure does not restore saved selections or reject the save',async()=>{
 const a={path:'a'},m=modal({applyTransactionTitle:async()=>{}},async()=>{throw Error('dashboard failed')});
 m.changes=[a];m.selected.add(a);await m.save();assert.equal(m.selected.size,0);assert.equal(m.changes.length,0);
 assert.equal(notices.at(-1),'Titles saved. Reopen Finances to refresh.');
});
