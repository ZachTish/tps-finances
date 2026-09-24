import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
class Element {
 constructor(){this.children=[];this.dataset={};this.scrollTop=0;}
 createDiv(){const child=new Element();this.children.push(child);return child;}
 createEl(tag,options){const child=this.createDiv();child.tag=tag;child.text=options?.text;return child;}
 empty(){this.children=[];} querySelector(){return null;} all(){return [this,...this.children.flatMap(c=>c.all())];}
}
class Control {
 constructor(){this.buttonEl=new Element();this.extraSettingsEl=new Element();}
 setValue(value){this.value=value;return this;} setButtonText(value){this.label=value;return this;}
 setDisabled(value){this.disabled=value;return this;} onChange(fn){this.change=fn;return this;} onClick(fn){this.click=fn;return this;}
 setCta(){return this;} setWarning(){return this;} setPlaceholder(){return this;} setIcon(){return this;} setTooltip(){return this;}
}
class Setting {
 constructor(parent){this.settingEl=parent.createDiv();this.settingEl.setting=this;this.buttons=[];}
 setName(name){this.name=name;return this;} setDesc(desc){this.desc=desc;return this;}
 addButton(fn){const c=new Control();fn(c);this.buttons.push(c);return this;}
 addExtraButton(fn){return this.addButton(fn);}
 addText(fn){this.text=new Control();fn(this.text);return this;}
 addComponent(fn){this.secret=fn(this.settingEl.createDiv());return this;}
}
const output=await build({entryPoints:['src/connection-settings.ts'],bundle:true,write:false,format:'cjs',platform:'browser',external:['obsidian']});
const module={exports:{}};
new Function('module','exports','require',output.outputFiles[0].text)(module,module.exports,()=>({Setting,SecretComponent:class extends Control{},App:class{},Notice:class{},Modal:class{},ButtonComponent:Control,Platform:{isMobile:true}}));
const rows=root=>root.all().filter(el=>el.setting).map(el=>el.setting);

const {FinanceConnectionSettings}=module.exports;
test('connection panel preserves actions, never syncs on open, and prevents duplicate clicks',async()=>{
 let calls=0,finish;const root=new Element();
 const plugin={settings:{transactionHistoryDays:90},getPlaidSetupStatus:()=>({state:'ready'}),getRelayStatus:()=>({online:true,message:'Ready'}),canConnectPlaid:()=>true,getConnectedItems:()=>[{institutionName:'Test bank',environment:'sandbox',localItemId:'test'}],getRelayOperations:()=>[{id:'r',action:'connect',state:'waiting',message:'Pending',url:'https://example.test'}],runConnectPlaid:()=>{calls++;return new Promise(resolve=>finish=resolve);}};
 const panel=new FinanceConnectionSettings({},plugin,root);panel.render();assert.equal(calls,0);
 for(const name of ['Connect another institution','Sync now','Transaction history','Test bank','Connect · waiting']) assert.ok(rows(root).some(r=>r.name===name),name);
 const button=rows(root).find(r=>r.name==='Connect another institution').buttons[0];const pending=button.click();assert.equal(button.disabled,true);assert.equal(calls,1);
 const children=root.children;panel.dispose();finish();await pending;assert.equal(root.children,children);
});
test('missing credentials keep setup explanation visible and connect disabled',()=>{
 const root=new Element();const plugin={settings:{transactionHistoryDays:90},getPlaidSetupStatus:()=>({state:'missing-credentials'}),getRelayStatus:()=>null,canConnectPlaid:()=>false,getConnectedItems:()=>[],getRelayOperations:()=>[]};
 new FinanceConnectionSettings({},plugin,root).render();assert.ok(root.children.some(c=>c.text?.includes('Bank setup')));assert.equal(rows(root).find(r=>r.name==='Connect another institution').buttons[0].disabled,true);
});
