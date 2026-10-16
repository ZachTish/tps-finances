import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { build } from "esbuild";
async function loadFinanceStore(root, label) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(root, "src/finance-store.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [{
      name: `mock-obsidian-${label}`,
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: "obsidian",
          namespace: `mock-${label}`,
        }));
        builder.onLoad({ filter: /.*/, namespace: `mock-${label}` }, () => ({
          contents: [
            "export class App {}",
            "export class TFile {",
            "  static [Symbol.hasInstance](value) {",
            "    return Boolean(value && value.__tpsFinanceTestFile === true);",
            "  }",
            "}",
            "export const normalizePath = (value) => value;",
            "export const parseYaml = value => JSON.parse(value);",
            "export const stringifyYaml = value => JSON.stringify(value) + '\\n';",
          ].join("\n"),
        }));
      },
    }],
  });
  const moduleText = `${result.outputFiles[0].text}\n// ${label}\n`;
  return import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);
}

const subjectModule = await loadFinanceStore(process.cwd(), "legacy-migration-read");
function createVault(entries) {
  const contents = new Map(entries);
  const files = entries.map(([path]) => ({__tpsFinanceTestFile:true,path,basename:path.replace(/\.md$/,"")}));
  const metrics = {inventories:0, reads:0, writes:0};
  const rejectWrite = () => { metrics.writes++; throw Error("Legacy reader attempted a write"); };
  return {metrics,app:{vault:{
    getMarkdownFiles(){metrics.inventories++;return files;},
    getAbstractFileByPath(path){return files.find(file=>file.path===path);},
    async cachedRead(file){metrics.reads++;return contents.get(file.path);},
    create:rejectWrite,modify:rejectWrite,process:rejectWrite,delete:rejectWrite,rename:rejectWrite
  },metadataCache:{getFileCache(){return null;}}}};
}
function createStore(module,vault){return new module.FinanceStore(vault.app, "");}
test("parallel cold index reads stay bounded and preserve vault/line order and duplicate precedence", async () => {
  const entries = Array.from({length:80}, (_,i)=>[`Note-${i}.md`, `- Item ${i} [financeId:: id-${i}]`]);
  entries[1][1] += '\n- Duplicate [financeId:: id-0]';
  const vault=createVault(entries), read=vault.app.vault.cachedRead;
  let active=0,peak=0;
  vault.app.vault.cachedRead=async file=>{
    active++;peak=Math.max(peak,active);
    try{await new Promise(resolve=>setTimeout(resolve,file.path==='Note-0.md'?15:1));return await read(file);}finally{active--;}
  };
  const records=await createStore(subjectModule,vault).readTransactionRecords();
  assert.equal(peak,16);assert.equal(active,0);
  assert.deepEqual(records.map(r=>r.path),entries.map(([path])=>path));
  assert.equal(records[0].line,'- Item 0 [financeId:: id-0]');
});

test("a failed cold index waits for started reads and publishes no partial cache", async () => {
  const entries = Array.from({length:50}, (_,i)=>[`Note-${i}.md`, `- Item ${i} [financeId:: id-${i}]`]);
  const vault=createVault(entries), read=vault.app.vault.cachedRead;
  let active=0,attempts=0,fail=true;
  vault.app.vault.cachedRead=async file=>{
    active++;attempts++;
    try{await new Promise(resolve=>setTimeout(resolve,file.path==='Note-0.md'?1:10));if(fail&&file.path==='Note-0.md')throw Error('cold read failed');return await read(file);}finally{active--;}
  };
  const store=createStore(subjectModule,vault);
  await assert.rejects(store.readTransactionRecords(),/cold read failed/);
  assert.equal(active,0);assert.equal(attempts,16);assert.equal(store.transactionIndex,null);
  fail=false;assert.equal((await store.readTransactionRecords()).length,50);
});

test("explicit legacy collection is read-only and removed inline writers are absent",async()=>{
 const vault=createVault([["Legacy.md","- Item [financeId:: old]"],["Note.md","User text"]]);
 const store=createStore(subjectModule,vault);
 assert.equal((await store.readTransactionRecords()).length,1);
 assert.deepEqual(vault.metrics,{inventories:1,reads:2,writes:0});
 for(const method of ["applyTransactions","replaceInvestmentTransactions","updateTransactionMetadata","upsertTransaction","removeTransaction","refreshTransactionRecords"])
  assert.equal(typeof store[method],"undefined",method);
});
