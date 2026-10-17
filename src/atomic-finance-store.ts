import { financeProperties } from "./finance-properties";
import { financeDirectory, financePath, financePrefix } from "./finance-paths";
import { App, TFile, parseYaml, stringifyYaml } from "obsidian";
import { FinanceStore, transactionLine, transactionsBaseBody, holdingsBaseBody, type TransactionReadSource } from "./finance-store";
import { normalizeTags } from "./classification";
import type { FinanceTransaction } from "./types";
import { boundedWork } from "./bounded-work";
import { proposedTransactionTitle, titleSignature, type TransactionTitleChange } from "./transaction-titles";
import { emptyTransactionProperties } from "./transaction-properties";
import type { DashboardFileSnapshot } from "./dashboard-file-snapshot";

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

  private async fields(file: TFile, fresh = false): Promise<Fields> {
    // Obsidian invalidates its content cache on writes and filesystem changes.
    // Inspect content through that cache; destructive guards still force a disk read.
    // Updates use processFrontMatter's current content, never this parsed snapshot.
    const content = await (fresh ? this.vaultApp.vault.read(file) : this.vaultApp.vault.cachedRead(file));
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    return financeProperties(this.vaultApp).read(match ? parseYaml(match[1]) || {} : {});
  }

  private async index(fieldsByFile?: Map<TFile, Fields>, source: TransactionReadSource = "source", requiredIds?: Set<string>, snapshot?: DashboardFileSnapshot): Promise<Map<string, TFile>> {
    // Decode the configured primary identity before choosing note candidates.
    const properties = financeProperties(this.vaultApp);
    const result = new Map<string, TFile>();
    const files: TFile[] = [];
    const excluded: TFile[] = [];
    const missingCache = new Set<TFile>();
    const order = new Map<TFile, number>();
    const transactionPrefix = financePrefix(this.folder, "Transactions");
    for (const [position, file] of (snapshot?.files ?? this.vaultApp.vault.getMarkdownFiles()).entries()) {
      const inTransactionFolder = Boolean(this.folder) && file.path.startsWith(transactionPrefix);
      // The path already makes these files candidates. Inspect checks metadata
      // or current source once below, so this preliminary cache lookup is redundant.
      // Even in a dashboard snapshot, root candidates need a fresh metadata
      // preflight; a previous consumer's memo cannot decide transaction identity.
      let cache: ReturnType<App["metadataCache"]["getFileCache"]> = null;
      let hasTransactionIdentity = false;
      try {
        cache = inTransactionFolder ? null : this.vaultApp.metadataCache.getFileCache(file);
        const raw = cache?.frontmatter;
        const primaryKey = properties.identityKey?.toLowerCase();
        // Ordinary notes cannot be Finance transactions without an own ID. Keep
        // this cheap metadata gate ahead of the shared classification decoder.
        const hasIdentity = raw && Object.keys(raw).some(key => key.toLowerCase() === "financeid"
          || (primaryKey && key.toLowerCase() === primaryKey));
        hasTransactionIdentity = Boolean(hasIdentity && properties.read(raw!).financeId);
      }
      catch (error) { snapshot?.includeSource(file); throw error; }
      if (inTransactionFolder || hasTransactionIdentity) {
        files.push(file);
        snapshot?.includeSource(file);
        order.set(file, position);
      } else if (!this.folder && !cache) {
        // At the vault root, atomic notes can have user-edited filenames. Until
        // Obsidian indexes one, its contents are the only way to discover its ID.
        files.push(file);
        snapshot?.includeSource(file);
        missingCache.add(file);
        order.set(file, position);
      } else if (!this.folder && source === "source" && requiredIds?.size) {
        excluded.push(file);
        order.set(file, position);
      }
    }
    // The candidate paths above remain dependencies even when inspection,
    // duplicate identity, or line conversion validation fails below.
    const inspect = async (file: TFile): Promise<void> => {
      // The view follows Obsidian's index. Mutation/ordinary API callers verify
      // candidate source contents. Root notes without an index entry need a source
      // read even for display; that read never authorizes a later write.
      const cache = source === "metadata" && !missingCache.has(file)
        ? this.vaultApp.metadataCache.getFileCache(file) : null;
      const fm = source === "metadata" && !missingCache.has(file) && cache
        ? financeProperties(this.vaultApp).read(cache.frontmatter || {})
        : await this.fields(file);
      const accountPath = String(fm.account || "").replace(/^\[\[|\]\]$/g, "");
      if (!file.path.startsWith(financePrefix(this.folder, "Transactions")) && !accountPath.startsWith(financePrefix(this.folder, "Accounts"))) return;
      if (!fm.financeId || !["transaction", "investmentTransaction"].includes(fm.type)) return;
      const id = String(fm.financeId);
      if (result.has(id)) throw new Error(`Duplicate atomic transaction identity: ${id}. Resolve the duplicate notes before syncing.`);
      result.set(id, file);
      fieldsByFile?.set(file, fm);
    };
    await boundedWork(files, inspect);
    if (requiredIds?.size && !this.folder && [...requiredIds].some(id => !result.has(id))) {
      // Arbitrary root filenames and stale non-null metadata leave no reliable
      // lookup key. Check those sources once per batch before creating a missing ID.
      await boundedWork(excluded, inspect);
    }
    // Read completion order must not change dashboard or migration ordering.
    return new Map([...result].sort((a, b) => order.get(a[1])! - order.get(b[1])!));
  }

  private async createMigrationNote(fm: Fields, index: Map<string, TFile>): Promise<TFile> {
    const id = String(fm.financeId);
    const safeId = encodeURIComponent(id).replace(/\./g, "%2E");
    const path = financePath(this.folder, "Transactions", `${safeId}.md`);
    if (this.vaultApp.vault.getAbstractFileByPath(path)) throw new Error(`Transaction destination is occupied: ${path}`);
    const file = await this.vaultApp.vault.create(path, `---\n${stringifyYaml(financeProperties(this.vaultApp).write(fm))}---\n`);
    const verified = await this.fields(file);
    if (String(verified.financeId) !== id) throw new Error("Could not verify saved transaction identity.");
    index.set(id, file);
    return file;
  }

  async readTransactionRecords(source: TransactionReadSource = "source", snapshot?: DashboardFileSnapshot): Promise<{line:string;path:string;lineNumber:number;sourceFile?:TFile}[]> {
    const records: {line:string;path:string;lineNumber:number;sourceFile?:TFile}[] = [];
    const fieldsByFile = new Map<TFile, Fields>();
    const index = await this.index(fieldsByFile, source, undefined, snapshot);
    for (const file of index.values()) {
      const fm = fieldsByFile.get(file)!;
      const record: {line:string;path:string;lineNumber:number;sourceFile?:TFile} = {line: fieldsLine(fm), path:file.path, lineNumber:0};
      Object.defineProperty(record, "sourceFile", {value:file});
      records.push(record);
    }
    return records;
  }

  async updateTransactionMetadata(id:string, categoryOverride:string, tags:string[], target?: {
    path:string; file:TFile|null; type:"transaction"|"investmentTransaction"; categoryOverride:string; tags:string[];
  }): Promise<boolean> {
    const applyClassification = (fm: Fields) => {
      if (categoryOverride) fm.category = categoryOverride; else delete fm.category;
      delete fm.categoryOverride;
      fm.tags = normalizeTags(tags).map(tag=>tag.replace(/^#/, ""));
    };
    if (target) {
      const file = target.file;
      const changed = () => new Error("The transaction changed or moved. Reopen the dashboard and try again.");
      if (!(file instanceof TFile) || file.path !== target.path || this.vaultApp.vault.getAbstractFileByPath(target.path) !== file) throw changed();
      await financeProperties(this.vaultApp).process(this.vaultApp, file, fm => {
        const accountPath=String(fm.account||"").replace(/^\[\[|\]\]$/g,"");
        if (file.path !== target.path || this.vaultApp.vault.getAbstractFileByPath(target.path) !== file
          || String(fm.financeId||"") !== id || fm.type !== target.type
          || (!file.path.startsWith(financePrefix(this.folder,"Transactions")) && !accountPath.startsWith(financePrefix(this.folder,"Accounts")))
          || String(fm.category ?? fm.categoryOverride ?? "") !== target.categoryOverride
          || JSON.stringify(atomicTags(fm.tags)) !== JSON.stringify(normalizeTags(target.tags))) throw changed();
        applyClassification(fm);
      });
      return true;
    }
    const file = (await this.index()).get(id);
    if (!file) return false;
    await financeProperties(this.vaultApp).process(this.vaultApp, file, fm => {applyClassification(fm);});
    return true;
  }

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
      if (change.after !== String(current.title ?? "")) current.title = change.after;
      for (const key of removeFields) delete current[key];
    });
  }

  /** Explicit, resumable migration. Write/verify the note before replacing the exact source line. */
  async migrateLegacyTransactionLedgers(): Promise<{moved:number;skipped:number}> {
    await this.ensureStructure();
    this.transactionIndex = null;
    const records = await super.readTransactionRecords();
    const migrationIds = new Set(records.map(record => field(record.line, "financeId")).filter(Boolean));
    const index=await this.index(undefined, "source", migrationIds); let moved=0,skipped=0;
    for (const record of records) {
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
      } else target=await this.createMigrationNote({...fm,migrationSource:record.line},index);
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

}
function fieldsLine(f:Fields):string {
  if(!Number.isFinite(Number(f.amount))||f.amount===null||f.amount===''||!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date)))throw new Error('Invalid atomic transaction properties; repair the note before syncing.');
  const t:FinanceTransaction={financeId:String(f.financeId),providerTransactionId:'',financeAccountId:String(f.financeAccountId||''),date:String(f.date),authorizedDate:String(f.authorizedDate||''),name:String(f.title||''),providerName:typeof f.providerName==='string'?f.providerName:undefined,merchantName:String(f.merchant||''),amount:Number(f.amount),currency:String(f.currency||'USD'),pending:f.pending===true,category:String(f.providerCategory||''),categoryDetail:String(f.providerCategoryDetail||''),subtype:String(f.subtype||''),kind:f.type==='investmentTransaction'?'investmentTransaction':'transaction',investmentType:String(f.investmentType||'')};
  return transactionLine(t,String(f.account||'').replace(/^\[\[|\]\]$/g,''),{categoryOverride:String(f.category ?? f.categoryOverride ?? ''),tags:atomicTags(f.tags)}) + (f.financeSource === 'manual' ? ` [financeSource:: manual] [transferAccount:: ${String(f.transferAccount || '')}]` : '');
}
function atomicTags(value:unknown):string[] {
  return normalizeTags(Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',') : []);
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
  return stringifyYaml({filters:{and:[...(root ? [`file.inFolder(${JSON.stringify(financeDirectory(root,name))})`] : []),...(transactions?['(kind == "transaction" || kind == "investmentTransaction")','financeId != null']:['kind == "holding"','active == true'])]},views:[{type:'table',name,order:transactions?['file.name','date','account','title','amount','currency','pending','categoryOverride','tags']:['file.name','account','name','quantity','price','value','currency','asOf','stale'],sort:[{property:transactions?'date':'value',direction:'DESC'}]}]});
}
