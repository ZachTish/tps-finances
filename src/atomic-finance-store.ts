import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import { FinanceStore, transactionLine, transactionsBaseBody, holdingsBaseBody } from "./finance-store";
import { normalizeTags } from "./classification";
import { providerIdentityKey } from "./identity";
import type { DeviceState, FinanceHolding, FinanceAccount, FinanceTransaction } from "./types";

type Fields = Record<string, any>;

/** Atomic notes own persisted data; the line codec is only a dashboard compatibility adapter. */
export class AtomicFinanceStore extends FinanceStore {
  constructor(private readonly vaultApp: App, private readonly folder: string) { super(vaultApp, folder); }

  async ensureStructure(): Promise<void> {
    await super.ensureStructure();
    for (const name of ["Transactions", "Holdings"]) {
      const path = normalizePath(`${this.folder}/${name}`);
      if (!this.vaultApp.vault.getAbstractFileByPath(path)) await this.vaultApp.vault.createFolder(path);
      const base = this.vaultApp.vault.getAbstractFileByPath(`${this.folder}/${name}.base`);
      const body = atomicBase(this.folder, name);
      if (base instanceof TFile) {
        // Convert only uncustomized generated views. Preserve customized Bases in place.
        const content = await this.vaultApp.vault.read(base);
        if (content === (name === "Transactions" ? transactionsBaseBody(this.folder) : holdingsBaseBody(this.folder))) {
          await this.vaultApp.vault.process(base, current => current === content ? body : current);
        } else if (content !== body) {
          const atomicPath = `${this.folder}/${name} (Atomic notes).base`;
          if (!this.vaultApp.vault.getAbstractFileByPath(atomicPath)) await this.vaultApp.vault.create(atomicPath, body);
        }
      }
    }
  }

  async restoreLineBases(): Promise<void> {
    for(const name of ["Transactions","Holdings"]){
      const file=this.vaultApp.vault.getAbstractFileByPath(`${this.folder}/${name}.base`);
      if(file instanceof TFile)await this.vaultApp.vault.process(file,content=>content===atomicBase(this.folder,name)?(name==="Transactions"?transactionsBaseBody(this.folder):holdingsBaseBody(this.folder)):content);
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
      await this.vaultApp.fileManager.processFrontMatter(file,fm=>{
        if(!fm[this.identityKey()])fm[this.identityKey()]=account.financeAccountId;
        fm.current=account.current;fm.available=account.available;fm.limit=account.limit;
      });
    }
    return paths;
  }

  private async fields(file: TFile): Promise<Fields> {
    const content = await this.vaultApp.vault.read(file);
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    return match ? parseYaml(match[1]) || {} : {};
  }

  private async index(): Promise<Map<string, TFile>> {
    const result = new Map<string, TFile>();
    for (const file of this.vaultApp.vault.getMarkdownFiles()) {
      // Metadata narrows candidates; direct reads below avoid stale values after mutations.
      if (!file.path.startsWith(`${this.folder}/Transactions/`) && !this.vaultApp.metadataCache.getFileCache(file)?.frontmatter?.financeId) continue;
      const fm = await this.fields(file);
      const accountPath = String(fm.account || "").replace(/^\[\[|\]\]$/g, "");
      if (!file.path.startsWith(`${this.folder}/Transactions/`) && !accountPath.startsWith(`${this.folder}/Accounts/`)) continue;
      if (!fm.financeId || !["transaction", "investmentTransaction"].includes(fm.type)) continue;
      const id = String(fm.financeId);
      if (result.has(id)) throw new Error(`Duplicate atomic transaction identity: ${id}. Resolve the duplicate notes before syncing.`);
      result.set(id, file);
    }
    return result;
  }

  private async put(fm: Fields, index: Map<string, TFile>): Promise<TFile> {
    const id = String(fm.financeId);
    let file = index.get(id);
    if (file && this.vaultApp.vault.getAbstractFileByPath(file.path) !== file) throw new Error("Transaction moved during sync; retry.");
    if (file) {
      const before = await this.fields(file);
      const {categoryOverride: ignoredCategory, tags: ignoredTags, ...providerFields} = fm;
      if (Object.keys(providerFields).every(key => JSON.stringify(before[key]) === JSON.stringify(providerFields[key]))) return file;
      await this.vaultApp.fileManager.processFrontMatter(file, current => {
        if (String(current.financeId) !== id) throw new Error("Transaction identity changed during sync.");
        const { categoryOverride, tags, ...providerFields } = fm;
        Object.assign(current, providerFields);
        // User classifications, tags, unrelated properties and body survive provider updates.
      });
    } else {
      const safeId = encodeURIComponent(id).replace(/\./g, "%2E");
      const path = normalizePath(`${this.folder}/Transactions/${safeId}.md`);
      if (this.vaultApp.vault.getAbstractFileByPath(path)) throw new Error(`Transaction destination is occupied: ${path}`);
      file = await this.vaultApp.vault.create(path, `---\n${stringifyYaml({ ...fm, [this.identityKey()]: fm[this.identityKey()] || id })}---\n`);
      index.set(id, file);
    }
    const verified = await this.fields(file);
    if (String(verified.financeId) !== id) throw new Error("Could not verify saved transaction identity.");
    return file;
  }

  async applyTransactions(added: FinanceTransaction[], modified: FinanceTransaction[], removedProviderIds: string[], state: DeviceState, accountPaths: Map<string, string>): Promise<{added:number;modified:number;removed:number}> {
    await this.ensureStructure();
    const index = await this.index();
    let removed = 0;
    for (const providerId of removedProviderIds) {
      const id = state.providerIdentityMap[providerIdentityKey("transaction", providerId)];
      const file = index.get(id);
      if (file) {
        if (String((await this.fields(file)).financeId) !== id) throw new Error("Transaction identity changed before deletion.");
        await this.vaultApp.fileManager.trashFile(file);
        index.delete(id); removed++;
      }
    }
    for (const transaction of [...modified, ...added]) {
      const path = accountPaths.get(transaction.financeAccountId);
      if (!path) throw new Error("Transaction account note is missing.");
      await this.put(transactionFields(transaction, path), index);
    }
    return {added:added.length,modified:modified.length,removed};
  }

  async replaceInvestmentTransactions(transactions: FinanceTransaction[], accountPaths: Map<string,string>): Promise<void> {
    await this.applyTransactions(transactions, [], [], {plaidUserId:"",items:[],providerIdentityMap:{}}, accountPaths);
  }

  async readTransactionRecords(): Promise<{line:string;path:string;lineNumber:number}[]> {
    const records = [];
    const index = await this.index();
    for (const file of index.values()) {
      const fm = await this.fields(file);
      records.push({line: fieldsLine(fm), path:file.path, lineNumber:0});
    }
    // Until explicit migration, old lines remain visible. A note always wins by stable ID.
    this.transactionIndex = null;
    for (const record of await super.readTransactionRecords()) {
      const accountPath=field(record.line,"account").replace(/^\[\[|\]\]$/g,"");
      if (accountPath.startsWith(`${this.folder}/Accounts/`) && !index.has(field(record.line,"financeId"))) records.push(record);
    }
    return records;
  }

  async updateTransactionMetadata(id:string, categoryOverride:string, tags:string[]): Promise<boolean> {
    const file = (await this.index()).get(id);
    if (!file) return super.updateTransactionMetadata(id, categoryOverride, tags);
    await this.vaultApp.fileManager.processFrontMatter(file, fm => {fm.categoryOverride=categoryOverride;fm.tags=normalizeTags(tags).map(tag=>tag.replace(/^#/,""));});
    return true;
  }

  async rerouteTransactions(): Promise<{moved:number;skipped:number}> { return {moved:0,skipped:0}; }

  /** Explicit, resumable migration. Write/verify the note before replacing the exact source line. */
  async migrateLegacyTransactionLedgers(): Promise<{moved:number;skipped:number}> {
    await this.ensureStructure();
    const index=await this.index(); let moved=0,skipped=0;
    this.transactionIndex = null;
    for (const record of await super.readTransactionRecords()) {
      const ownedAccount=field(record.line,"account").replace(/^\[\[|\]\]$/g,"");
      if(!ownedAccount.startsWith(`${this.folder}/Accounts/`)&&!record.path.startsWith(`${this.folder}/Transactions/`))continue;
      const fm = legacyFields(record.line);
      if (!fm) {skipped++;continue;}
      const account = String(fm.account || "").replace(/^\[\[|\]\]$/g,"");
      const accountFile=this.vaultApp.vault.getAbstractFileByPath(account.endsWith('.md')?account:`${account}.md`);
      if (!(accountFile instanceof TFile) || !accountFile.path.startsWith(`${this.folder}/Accounts/`)) {skipped++;continue;}
      const source=this.vaultApp.vault.getAbstractFileByPath(record.path);
      if (!(source instanceof TFile)) {skipped++;continue;}
      let target=index.get(String(fm.financeId));
      if (target) {
        const existing=await this.fields(target);
        // An existing different revision needs reconciliation, never silently overwrite it.
        if (existing.migrationSource !== record.line || Object.keys(fm).some(key=>JSON.stringify(existing[key])!==JSON.stringify(fm[key]))) {skipped++;continue;}
      } else target=await this.put({...fm,migrationSource:record.line},index);
      const verified=await this.fields(target);
      if(verified.migrationSource!==record.line)throw new Error("Migrated transaction verification failed.");
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
    for (const holding of holdings) {
      const id=encodeURIComponent(`${holding.financeAccountId}:${holding.securityId}`).replace(/\./g,'%2E');
      const target=`${this.folder}/Holdings/${id}.md`;
      const fm={...holding,holdingType:holding.type,kind:'holding',type:'holding',[this.identityKey()]:`holding-${id}`,account:`[[${(accountPaths.get(holding.financeAccountId)||'').replace(/\.md$/i,'')}]]`,asOf:holding.asOf||at.toISOString().slice(0,10)};
      const existing=this.vaultApp.vault.getAbstractFileByPath(target);
      if(existing instanceof TFile)await this.vaultApp.fileManager.processFrontMatter(existing,current=>{if(current.type!=="holding"||current.financeAccountId!==holding.financeAccountId||current.securityId!==holding.securityId)throw new Error("Holding destination identity mismatch.");Object.assign(current,fm);});
      else if(existing)throw new Error(`Holding destination occupied: ${target}`);
      else await this.vaultApp.vault.create(target,`---\n${stringifyYaml(fm)}---\n`);
    }
    // Mark disappeared holdings inactive rather than deleting user-authored content.
    const active=new Set(holdings.map(h=>`${h.financeAccountId}:${h.securityId}`));
    const accountIds=new Set(accounts.map(a=>a.financeAccountId));
    for(const file of this.vaultApp.vault.getMarkdownFiles().filter(f=>f.path.startsWith(`${this.folder}/Holdings/`))){
      const fm=await this.fields(file);
      if(fm.type==='holding'&&accountIds.has(fm.financeAccountId))await this.vaultApp.fileManager.processFrontMatter(file,current=>{current.active=active.has(`${fm.financeAccountId}:${fm.securityId}`);});
    }
    return `${this.folder}/Holdings.base`;
  }
}

export function transactionFields(t:FinanceTransaction,accountPath:string):Fields {
  if(!t.financeId||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||!Number.isFinite(t.amount))throw new Error('Invalid atomic transaction');
  return {kind:t.kind,type:t.kind,financeId:t.financeId,financeAccountId:t.financeAccountId,date:t.date,authorizedDate:t.authorizedDate,title:t.name,merchant:t.merchantName,account:`[[${accountPath.replace(/\.md$/i,'')}]]`,amount:t.amount,currency:t.currency,pending:t.pending,providerCategory:t.category,providerCategoryDetail:t.categoryDetail,subtype:t.subtype,securityId:t.securityId||'',quantity:t.quantity??null,price:t.price??null,fees:t.fees??null,investmentType:t.investmentType||''};
}
function fieldsLine(f:Fields):string {
  if(!Number.isFinite(Number(f.amount))||f.amount===null||f.amount===''||!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date)))throw new Error('Invalid atomic transaction properties; repair the note before syncing.');
  const t:FinanceTransaction={financeId:String(f.financeId),providerTransactionId:'',financeAccountId:String(f.financeAccountId||''),date:String(f.date),authorizedDate:String(f.authorizedDate||''),name:String(f.title||''),merchantName:String(f.merchant||''),amount:Number(f.amount),currency:String(f.currency||'USD'),pending:f.pending===true,category:String(f.providerCategory||''),categoryDetail:String(f.providerCategoryDetail||''),subtype:String(f.subtype||''),kind:f.type==='investmentTransaction'?'investmentTransaction':'transaction'};
  return transactionLine(t,String(f.account||'').replace(/^\[\[|\]\]$/g,''),{categoryOverride:String(f.categoryOverride||''),tags:normalizeTags(Array.isArray(f.tags)?f.tags:[])});
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
  return stringifyYaml({filters:{and:[`file.inFolder(${JSON.stringify(`${root}/${name}`)})`,...(transactions?['financeId != null']:['type == "holding"','active == true'])]},views:[{type:'table',name,order:transactions?['file.name','date','account','title','amount','currency','pending','categoryOverride','tags']:['file.name','account','name','quantity','price','value','currency','asOf','stale'],sort:[{property:transactions?'date':'value',direction:'DESC'}]}]});
}
