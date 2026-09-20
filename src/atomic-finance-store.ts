import { financeProperties } from "./finance-properties";
import { financeDirectory, financePath, financePrefix } from "./finance-paths";
import { App, TFile, parseYaml, stringifyYaml } from "obsidian";
import { FinanceStore, transactionLine, transactionsBaseBody, holdingsBaseBody } from "./finance-store";
import { normalizeTags } from "./classification";
import { providerIdentityKey } from "./identity";
import type { DeviceState, FinanceHolding, FinanceAccount, FinanceTransaction } from "./types";
import { boundedWork } from "./bounded-work";
import * as logger from "./logger";
import { providerTransactionFields, proposedTransactionTitle, titleSignature, transactionTitle, type TransactionTitleChange } from "./transaction-titles";
import { absentProviderProperties, compactTransactionProperties, emptyTransactionProperties } from "./transaction-properties";

type Fields = Record<string, any>;

/** Atomic notes own persisted data; the line codec is only a dashboard compatibility adapter. */
export class AtomicFinanceStore extends FinanceStore {
  constructor(private readonly vaultApp: App, private readonly folder: string) { super(vaultApp, folder); }

  async ensureStructure(): Promise<void> {
    await super.ensureStructure();
    for (const name of ["Transactions", "Holdings"]) {
      const path = financeDirectory(this.folder, name);
      if (path && !this.vaultApp.vault.getAbstractFileByPath(path)) await this.vaultApp.vault.createFolder(path);
      const base = this.vaultApp.vault.getAbstractFileByPath(financePath(this.folder, "", `${name}.base`));
      const body = financeProperties(this.vaultApp).base(atomicBase(this.folder, name));
      if (base instanceof TFile) {
        // Convert only uncustomized generated views. Preserve customized Bases in place.
        const content = await this.vaultApp.vault.read(base);
        if (content === financeProperties(this.vaultApp).base(name === "Transactions" ? transactionsBaseBody(this.folder) : holdingsBaseBody(this.folder))) {
          await this.vaultApp.vault.process(base, current => current === content ? body : current);
        } else if (content !== body) {
          const atomicPath = financePath(this.folder, "", `${name} (Atomic notes).base`);
          if (!this.vaultApp.vault.getAbstractFileByPath(atomicPath)) await this.vaultApp.vault.create(atomicPath, body);
        }
      }
    }
  }

  async restoreLineBases(): Promise<void> {
    for(const name of ["Transactions","Holdings"]){
      const file=this.vaultApp.vault.getAbstractFileByPath(financePath(this.folder, "", `${name}.base`));
      if(file instanceof TFile)await this.vaultApp.vault.process(file,content=>content===financeProperties(this.vaultApp).base(atomicBase(this.folder,name))?financeProperties(this.vaultApp).base(name==="Transactions"?transactionsBaseBody(this.folder):holdingsBaseBody(this.folder)):content);
    }
  }

  private identityKey(): string {
    return (this.vaultApp as any).plugins?.plugins?.["tps-global-context-menu"]?.settings?.nativeRecordIdentityPropertyKey || "tpsId";
  }

  async upsertAccounts(accounts: FinanceAccount[]): Promise<Map<string,string>> {
    const paths=await super.upsertAccounts(accounts);
    for(const account of accounts){
      const file=this.vaultApp.vault.getAbstractFileByPath(paths.get(account.financeAccountId)!);
      if(!(file instanceof TFile))throw new Error("Account note is missing.");
      await financeProperties(this.vaultApp).process(this.vaultApp, file,fm=>{
        if(!fm[this.identityKey()])fm[this.identityKey()]=account.financeAccountId;
        fm.current=account.current;fm.available=account.available;fm.limit=account.limit;
      });
    }
    return paths;
  }

  private async fields(file: TFile, fresh = false): Promise<Fields> {
    // Obsidian invalidates its content cache on writes and filesystem changes.
    // Inspect content through that cache; destructive guards still force a disk read.
    // Updates use processFrontMatter's current content, never this parsed snapshot.
    const content = await (fresh ? this.vaultApp.vault.read(file) : this.vaultApp.vault.cachedRead(file));
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    return financeProperties(this.vaultApp).read(match ? parseYaml(match[1]) || {} : {});
  }

  private async index(fieldsByFile?: Map<TFile, Fields>): Promise<Map<string, TFile>> {
    const result = new Map<string, TFile>();
    const files = this.vaultApp.vault.getMarkdownFiles().filter(file =>
      (this.folder && file.path.startsWith(financePrefix(this.folder, "Transactions")))
      || financeProperties(this.vaultApp).cache(this.vaultApp, file)?.financeId);
    await boundedWork(files, async file => {
      // Metadata narrows candidates; file content supplies the actual property values.
      const fm = await this.fields(file);
      const accountPath = String(fm.account || "").replace(/^\[\[|\]\]$/g, "");
      if (!file.path.startsWith(financePrefix(this.folder, "Transactions")) && !accountPath.startsWith(financePrefix(this.folder, "Accounts"))) return;
      if (!fm.financeId || !["transaction", "investmentTransaction"].includes(fm.type)) return;
      const id = String(fm.financeId);
      if (result.has(id)) throw new Error(`Duplicate atomic transaction identity: ${id}. Resolve the duplicate notes before syncing.`);
      result.set(id, file);
      fieldsByFile?.set(file, fm);
    });
    // Read completion order must not change dashboard or migration ordering.
    const order = new Map(files.map((file, index) => [file, index]));
    return new Map([...result].sort((a, b) => order.get(a[1])! - order.get(b[1])!));
  }

  private async put(fm: Fields, index: Map<string, TFile>): Promise<TFile> {
    const id = String(fm.financeId);
    let file = index.get(id);
    if (!file) {
      const safeId = encodeURIComponent(id).replace(/\./g, "%2E");
      const path = financePath(this.folder, "Transactions", `${safeId}.md`);
      const existing = this.vaultApp.vault.getAbstractFileByPath(path);
      if (existing) {
        // A fast retry can precede Obsidian's metadata cache update, especially at
        // the vault root. Reuse only a directly verified transaction at its ID path.
        const fields = existing instanceof TFile ? await this.fields(existing, true) : {};
        if (!(existing instanceof TFile) || String(fields.financeId) !== id || fields.type !== fm.type) {
          throw new Error(`Transaction destination is occupied: ${path}`);
        }
        file = existing;
        index.set(id, file);
      }
    }
    if (file && this.vaultApp.vault.getAbstractFileByPath(file.path) !== file) throw new Error("Transaction moved during sync; retry.");
    if (file) {
      const before = await this.fields(file);
      const providerFields = providerTransactionFields(fm, before);
      if (!absentProviderProperties(providerFields, before).length
        && Object.keys(providerFields).every(key => JSON.stringify(before[key]) === JSON.stringify(providerFields[key]))) return file;
      await financeProperties(this.vaultApp).process(this.vaultApp, file, current => {
        if (String(current.financeId) !== id) throw new Error("Transaction identity changed during sync.");
        const providerFields = providerTransactionFields(fm, current);
        for (const key of absentProviderProperties(providerFields, current)) delete current[key];
        Object.assign(current, providerFields);
        // User classifications, tags, unrelated properties and body survive provider updates.
      });
    } else {
      const safeId = encodeURIComponent(id).replace(/\./g, "%2E");
      const path = financePath(this.folder, "Transactions", `${safeId}.md`);
      if (this.vaultApp.vault.getAbstractFileByPath(path)) throw new Error(`Transaction destination is occupied: ${path}`);
      file = await this.vaultApp.vault.create(path, `---\n${stringifyYaml(financeProperties(this.vaultApp).write({ ...fm, [this.identityKey()]: fm[this.identityKey()] || id }))}---\n`);
      index.set(id, file);
    }
    const verified = await this.fields(file);
    if (String(verified.financeId) !== id) throw new Error("Could not verify saved transaction identity.");
    return file;
  }

  async applyTransactions(added: FinanceTransaction[], modified: FinanceTransaction[], removedProviderIds: string[], state: DeviceState, accountPaths: Map<string, string>): Promise<{added:number;modified:number;removed:number}> {
    if (!added.length && !modified.length && !removedProviderIds.length) return {added:0,modified:0,removed:0};
    const started = Date.now();
    // Validate before mutating, and serialize revisions of the same identity. Independent
    // notes can be written together without racing a duplicate or pending/posted revision.
    const groups = new Map<string, Fields[]>();
    for (const transaction of [...modified, ...added]) {
      const path = accountPaths.get(transaction.financeAccountId);
      if (!path) throw new Error("Transaction account note is missing.");
      const fields = transactionFields(transaction, path);
      const revisions = groups.get(transaction.financeId) || [];
      revisions.push(fields);
      groups.set(transaction.financeId, revisions);
    }
    await this.ensureStructure();
    const index = await this.index();
    const indexedAt = Date.now();
    let removed = 0;
    for (const providerId of removedProviderIds) {
      const id = state.providerIdentityMap[providerIdentityKey("transaction", providerId)];
      const file = index.get(id);
      if (file) {
        if (String((await this.fields(file, true)).financeId) !== id) throw new Error("Transaction identity changed before deletion.");
        await this.vaultApp.fileManager.trashFile(file);
        index.delete(id); removed++;
      }
    }
    await boundedWork([...groups.values()], async revisions => {
      for (const fields of revisions) await this.put(fields, index);
    });
    logger.flow("Storage", "atomic-transactions", {
      added: added.length, modified: modified.length, removed,
      indexMs: indexedAt - started, writeMs: Date.now() - indexedAt, durationMs: Date.now() - started,
    });
    return {added:added.length,modified:modified.length,removed};
  }

  async replaceInvestmentTransactions(transactions: FinanceTransaction[], accountPaths: Map<string,string>): Promise<void> {
    await this.applyTransactions(transactions, [], [], {plaidUserId:"",items:[],providerIdentityMap:{}}, accountPaths);
  }

  async readTransactionRecords(): Promise<{line:string;path:string;lineNumber:number}[]> {
    const records = [];
    const fieldsByFile = new Map<TFile, Fields>();
    const index = await this.index(fieldsByFile);
    for (const file of index.values()) {
      const fm = fieldsByFile.get(file)!;
      records.push({line: fieldsLine(fm), path:file.path, lineNumber:0});
    }
    // Until explicit migration, old lines remain visible. A note always wins by stable ID.
    this.transactionIndex = null;
    for (const record of await super.readTransactionRecords()) {
      const accountPath=field(record.line,"account").replace(/^\[\[|\]\]$/g,"");
      if (accountPath.startsWith(financePrefix(this.folder, "Accounts")) && !index.has(field(record.line,"financeId"))) records.push(record);
    }
    return records;
  }

  async updateTransactionMetadata(id:string, categoryOverride:string, tags:string[]): Promise<boolean> {
    const file = (await this.index()).get(id);
    if (!file) return super.updateTransactionMetadata(id, categoryOverride, tags);
    await financeProperties(this.vaultApp).process(this.vaultApp, file, fm => {fm.categoryOverride=categoryOverride;fm.tags=normalizeTags(tags).map(tag=>tag.replace(/^#/,""));});
    return true;
  }

  async rerouteTransactions(): Promise<{moved:number;skipped:number}> { return {moved:0,skipped:0}; }

  async reviewTransactionTitles(includeEmptyProperties = false): Promise<TransactionTitleChange[]> {
    const fields = new Map<TFile, Fields>();
    const index = await this.index(fields);
    const changes: TransactionTitleChange[] = [];
    for (const [financeId, file] of index) {
      const fm = fields.get(file)!;
      if (fm.financeSource === "manual") continue;
      const after = proposedTransactionTitle(fm);
      const removeFields = includeEmptyProperties ? emptyTransactionProperties(fm) : [];
      if (after || removeFields.length) changes.push({ path: file.path, financeId, before: String(fm.title ?? ""),
        after: after ?? String(fm.title ?? ""), date: String(fm.date ?? ""), signature: titleSignature(fm), removeFields });
    }
    return changes;
  }

  async applyTransactionTitle(change: TransactionTitleChange): Promise<void> {
    const file = this.vaultApp.vault.getAbstractFileByPath(change.path);
    if (!(file instanceof TFile)) throw new Error("Transaction moved or disappeared. Reopen the review.");
    await financeProperties(this.vaultApp).process(this.vaultApp, file, current => {
      const proposedTitle = proposedTransactionTitle(current) ?? String(current.title ?? "");
      const removeFields = change.removeFields || [];
      if (titleSignature(current) !== change.signature || proposedTitle !== change.after
        || current.financeSource === "manual"
        || removeFields.some(key => !emptyTransactionProperties(current).includes(key))) {
        throw new Error("Transaction changed. Reopen the review.");
      }
      // Older notes only retained their title. Preserve it until a provider revision
      // supplies the actual bank description; never discard the reviewed text.
      if (change.after !== String(current.title ?? "")) {
        if (typeof current.providerName !== "string") current.providerName = String(current.title ?? "");
        current.title = change.after;
        current.providerTitle = change.after;
      }
      for (const key of removeFields) delete current[key];
    });
  }

  /** Explicit, resumable migration. Write/verify the note before replacing the exact source line. */
  async migrateLegacyTransactionLedgers(): Promise<{moved:number;skipped:number}> {
    await this.ensureStructure();
    const index=await this.index(); let moved=0,skipped=0;
    this.transactionIndex = null;
    for (const record of await super.readTransactionRecords()) {
      const ownedAccount=field(record.line,"account").replace(/^\[\[|\]\]$/g,"");
      if(!ownedAccount.startsWith(financePrefix(this.folder, "Accounts"))&&!record.path.startsWith(financePrefix(this.folder, "Transactions")))continue;
      const fm = legacyFields(record.line);
      if (!fm) {skipped++;continue;}
      const account = String(fm.account || "").replace(/^\[\[|\]\]$/g,"");
      const accountFile=this.vaultApp.vault.getAbstractFileByPath(account.endsWith('.md')?account:`${account}.md`);
      if (!(accountFile instanceof TFile) || !accountFile.path.startsWith(financePrefix(this.folder, "Accounts")) || (!this.folder && !(await this.fields(accountFile)).financeAccountId)) {skipped++;continue;}
      const source=this.vaultApp.vault.getAbstractFileByPath(record.path);
      if (!(source instanceof TFile)) {skipped++;continue;}
      let target=index.get(String(fm.financeId));
      if (target) {
        const existing=await this.fields(target, true);
        // An existing different revision needs reconciliation, never silently overwrite it.
        if (existing.migrationSource !== record.line || Object.keys(fm).some(key=>JSON.stringify(existing[key])!==JSON.stringify(fm[key]))) {skipped++;continue;}
      } else target=await this.put({...fm,migrationSource:record.line},index);
      const verified=await this.fields(target, true);
      if(verified.migrationSource!==record.line || Object.keys(fm).some(key=>JSON.stringify(verified[key])!==JSON.stringify(fm[key])))throw new Error("Migrated transaction verification failed.");
      const link=`- [[${target.path.replace(/\.md$/i,"")}]]`;
      let replaced=false;
      await this.vaultApp.vault.process(source, content=>content.split('\n').map(line=>{
        if(line===record.line){replaced=true;return link;}return line;
      }).join('\n'));
      if(replaced)moved++;else skipped++;
    }
    return {moved,skipped};
  }

  async writeSnapshot(accounts:FinanceAccount[], holdings:FinanceHolding[], accountPaths:Map<string,string>, at:Date):Promise<string> {
    // Current balances and positions live on their notes; atomic mode creates no line snapshots.
    await this.ensureStructure();
    const holdingFiles = new Map<string, TFile>();
    for (const file of this.vaultApp.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(financePrefix(this.folder, "Holdings"))) continue;
      if (!this.folder && financeProperties(this.vaultApp).cache(this.vaultApp, file)?.type !== "holding") continue;
      const fm = await this.fields(file);
      if (fm.type !== "holding" || !fm.financeAccountId || !fm.securityId) continue;
      const key = `${fm.financeAccountId}:${fm.securityId}`;
      if (holdingFiles.has(key)) throw new Error("Duplicate holding identity; resolve the duplicate notes before syncing.");
      holdingFiles.set(key, file);
    }
    for (const holding of holdings) {
      const id=encodeURIComponent(`${holding.financeAccountId}:${holding.securityId}`).replace(/\./g,'%2E');
      const target=holdingFiles.get(`${holding.financeAccountId}:${holding.securityId}`)?.path || financePath(this.folder, "Holdings", `${id}.md`);
      const fm={...holding,holdingType:holding.type,kind:'holding',type:'holding',[this.identityKey()]:`holding-${id}`,account:`[[${(accountPaths.get(holding.financeAccountId)||'').replace(/\.md$/i,'')}]]`,asOf:holding.asOf||at.toISOString().slice(0,10)};
      const existing=this.vaultApp.vault.getAbstractFileByPath(target);
      if(existing instanceof TFile)await financeProperties(this.vaultApp).process(this.vaultApp, existing,current=>{if(current.type!=="holding"||current.financeAccountId!==holding.financeAccountId||current.securityId!==holding.securityId)throw new Error("Holding destination identity mismatch.");Object.assign(current,fm);});
      else if(existing)throw new Error(`Holding destination occupied: ${target}`);
      else await this.vaultApp.vault.create(target,`---\n${stringifyYaml(financeProperties(this.vaultApp).write(fm))}---\n`);
    }
    // Mark disappeared holdings inactive rather than deleting user-authored content.
    const active=new Set(holdings.map(h=>`${h.financeAccountId}:${h.securityId}`));
    const accountIds=new Set(accounts.map(a=>a.financeAccountId));
    for(const file of this.vaultApp.vault.getMarkdownFiles().filter(f=>f.path.startsWith(financePrefix(this.folder, "Holdings")))){
      if (!this.folder && financeProperties(this.vaultApp).cache(this.vaultApp, file)?.type !== "holding") continue;
      const fm=await this.fields(file);
      if(fm.type==='holding'&&accountIds.has(fm.financeAccountId))await financeProperties(this.vaultApp).process(this.vaultApp, file,current=>{current.active=active.has(`${fm.financeAccountId}:${fm.securityId}`);});
    }
    return financePath(this.folder, "", "Holdings.base");
  }
}

export function transactionFields(t:FinanceTransaction,accountPath:string):Fields {
  if(!t.financeId||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||!Number.isFinite(t.amount))throw new Error('Invalid atomic transaction');
  return compactTransactionProperties({kind:t.kind,type:t.kind,financeId:t.financeId,financeAccountId:t.financeAccountId,date:t.date,authorizedDate:t.authorizedDate,title:transactionTitle(t.name,t.merchantName,t.kind),providerName:t.name,providerTitle:transactionTitle(t.name,t.merchantName,t.kind),merchant:t.merchantName,account:`[[${accountPath.replace(/\.md$/i,'')}]]`,amount:t.amount,currency:t.currency,pending:t.pending,providerCategory:t.category,providerCategoryDetail:t.categoryDetail,subtype:t.subtype,securityId:t.securityId||'',quantity:t.quantity??null,price:t.price??null,fees:t.fees??null,investmentType:t.investmentType||''});
}
function fieldsLine(f:Fields):string {
  if(!Number.isFinite(Number(f.amount))||f.amount===null||f.amount===''||!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date)))throw new Error('Invalid atomic transaction properties; repair the note before syncing.');
  const t:FinanceTransaction={financeId:String(f.financeId),providerTransactionId:'',financeAccountId:String(f.financeAccountId||''),date:String(f.date),authorizedDate:String(f.authorizedDate||''),name:String(f.title||''),providerName:typeof f.providerName==='string'?f.providerName:undefined,merchantName:String(f.merchant||''),amount:Number(f.amount),currency:String(f.currency||'USD'),pending:f.pending===true,category:String(f.providerCategory||''),categoryDetail:String(f.providerCategoryDetail||''),subtype:String(f.subtype||''),kind:f.type==='investmentTransaction'?'investmentTransaction':'transaction',investmentType:String(f.investmentType||'')};
  return transactionLine(t,String(f.account||'').replace(/^\[\[|\]\]$/g,''),{categoryOverride:String(f.categoryOverride||''),tags:normalizeTags(Array.isArray(f.tags)?f.tags:[])}) + (f.financeSource === 'manual' ? ` [financeSource:: manual] [transferAccount:: ${String(f.transferAccount || '')}]` : '');
}
function field(line:string,key:string):string {return line.match(new RegExp(`\\[${key}::\\s*(\\[\\[[^\\]]+\\]\\]|[^\\]]*)\\]`))?.[1]?.trim()||'';}
export function legacyFields(line:string):Fields|null {
  const type=field(line,'type'),id=field(line,'financeId'),date=field(line,'date'),amount=field(line,'amount');
  if(!['transaction','investmentTransaction'].includes(type)||!id||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!amount||!Number.isFinite(Number(amount)))return null;
  const fm:Fields={kind:type,title:line.replace(/^-\s*/,'').split(' [type::')[0].trim()};
  for(const match of line.matchAll(/\[([\w]+)::\s*(\[\[[^\]]+\]\]|[^\]]*)\]/g))fm[match[1]]=match[2].trim();
  fm.amount=Number(amount);fm.pending=fm.pending==='true';fm.tags=normalizeTags(String(fm.tags||'').split(',')).map(tag=>tag.replace(/^#/,''));
  for(const key of ['quantity','price','fees'])if(fm[key]!==undefined&&Number.isFinite(Number(fm[key])))fm[key]=Number(fm[key]);
  return fm;
}
export function atomicBase(root:string,name:string):string {
  const transactions=name==='Transactions';
  return stringifyYaml({filters:{and:[...(root ? [`file.inFolder(${JSON.stringify(financeDirectory(root,name))})`] : []),...(transactions?['financeId != null']:['type == "holding"','active == true'])]},views:[{type:'table',name,order:transactions?['file.name','date','account','title','amount','currency','pending','categoryOverride','tags']:['file.name','account','name','quantity','price','value','currency','asOf','stale'],sort:[{property:transactions?'date':'value',direction:'DESC'}]}]});
}
