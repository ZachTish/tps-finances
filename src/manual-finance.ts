import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";
import { createLocalId } from "./identity";
import type { FinanceAccount } from "./types";

export interface ManualAccountInput {
  name: string;
  kind: "cash" | "asset";
  value: number;
  currency: string;
  valuationDate: string;
  assetType: string;
  purchaseTransaction: string;
  liabilityAccount: string;
}
export interface CashEntryInput {
  accountPath: string;
  title: string;
  amount: number;
  date: string;
  kind: "expense" | "income" | "transfer-in" | "transfer-out";
  category: string;
  tags: string[];
  counterpart: string;
  linkedTransaction: string;
}

export function validateCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Enter a three-letter currency code.");
  return code;
}
export function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error("Enter a valid date.");
}
export class ManualFinanceStore {
  constructor(private app: App, private folder: string) {}
  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of normalizePath(path).split("/")) {
      if (!part || part === "." || part === "..") throw new Error("Invalid finance folder.");
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }
  private identityKey(): string {
    return (this.app as any).plugins?.plugins?.["tps-global-context-menu"]?.settings?.nativeRecordIdentityPropertyKey || "tpsId";
  }
  private async fields(file: TFile): Promise<Record<string, any>> {
    const match = (await this.app.vault.read(file)).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    return match ? parseYaml(match[1]) || {} : {};
  }
  async updateValue(path: string, value: number, date: string): Promise<void> {
    validateDate(date);
    if (!Number.isFinite(value) || value < 0) throw new Error("Enter a non-negative resale value.");
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("Asset note is missing.");
    await this.app.fileManager.processFrontMatter(file, fm => {
      if (fm.financeSource !== "manual" || fm.accountType !== "other") throw new Error("Choose a manual asset.");
      fm.current = value;
      fm.valuationDate = date;
    });
  }
  private link(path: string): string {
    if (!path.trim()) return "";
    const normalized = normalizePath(path.trim().replace(/^\[\[|\]\]$/g, "").replace(/\.md$/i, "") + ".md");
    if (normalized.split("/").includes("..") || !(this.app.vault.getAbstractFileByPath(normalized) instanceof TFile)) throw new Error("Choose an existing note for the linked record.");
    return `[[${normalized.slice(0,-3)}]]`;
  }
  async createAccount(input: ManualAccountInput): Promise<TFile> {
    if (!input.name.trim() || !Number.isFinite(input.value) || input.value < 0) throw new Error("Enter a name and a non-negative value.");
    const currency = validateCurrency(input.currency); validateDate(input.valuationDate);
    const purchaseTransaction = this.link(input.purchaseTransaction), liabilityAccount = this.link(input.liabilityAccount);
    const id = createLocalId(input.kind === "cash" ? "cash-account" : "owned-asset");
    const folder = normalizePath(`${this.folder}/Accounts`); await this.ensureFolder(folder);
    const name = input.name.trim().replace(/[\\/:*?"<>|#\[\]]/g, "-");
    const fields: Record<string, unknown> = {kind:"account",financeSource:"manual",financeAccountId:id,[this.identityKey()]:id,title:input.name.trim(),accountName:input.name.trim(),accountType:input.kind === "cash" ? "depository" : "other",accountSubtype:input.kind === "cash" ? "cash" : input.assetType.trim() || "personal-property",currency,current:input.value};
    if (input.kind === "cash") { fields.openingBalance = input.value; delete fields.current; }
    else Object.assign(fields,{valuationDate:input.valuationDate,purchaseTransaction,liabilityAccount});
    return this.app.vault.create(`${folder}/${name} ${id.slice(-8)}.md`, `---\n${stringifyYaml(fields)}---\n`);
  }
  async createCashEntry(input: CashEntryInput): Promise<TFile> {
    if (!input.title.trim() || !Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter a description and a positive amount.");
    validateDate(input.date);
    const account = this.app.vault.getAbstractFileByPath(input.accountPath);
    if (!(account instanceof TFile)) throw new Error("Choose a cash account.");
    const fm = await this.fields(account);
    if (fm.financeSource !== "manual" || fm.accountType !== "depository" || fm.accountSubtype !== "cash") throw new Error("Manual transactions require a manual cash account.");
    const transfer = input.kind.startsWith("transfer-");
    const counterpart = transfer ? this.link(input.counterpart) : "";
    if (transfer && !counterpart) throw new Error("Choose the other transfer account.");
    if (counterpart === this.link(account.path)) throw new Error("Choose a different transfer account.");
    if (counterpart) {
      const other = this.app.vault.getAbstractFileByPath(counterpart.slice(2,-2)+".md") as TFile;
      const otherFm = await this.fields(other);
      if (!otherFm.financeAccountId || otherFm.currency !== fm.currency) throw new Error("Transfers require accounts in the same currency.");
      if (otherFm.financeSource === "manual" && (otherFm.accountType !== "depository" || otherFm.accountSubtype !== "cash")) throw new Error("A resale asset is not a cash transfer account.");
    }
    const linkedTransaction = this.link(input.linkedTransaction);
    const id = createLocalId("cash-transaction");
    const folder = normalizePath(`${this.folder}/Transactions`); await this.ensureFolder(folder);
    const amount = ["expense","transfer-out"].includes(input.kind) ? -input.amount : input.amount;
    const fields = {kind:"transaction",type:"transaction",financeSource:"manual",financeId:id,[this.identityKey()]:id,financeAccountId:fm.financeAccountId,account:this.link(account.path),title:input.title.trim(),date:input.date,amount,currency:fm.currency,pending:false,subtype:input.kind === "expense" ? "purchase" : input.kind,categoryOverride:input.category.trim(),tags:input.tags.map(t=>t.trim().replace(/^#+/,"")).filter(Boolean),transferAccount:counterpart,linkedTransaction};
    return this.app.vault.create(`${folder}/${id}.md`,`---\n${stringifyYaml(fields)}---\n`);
  }
}

/** Derive both cash-transfer legs from one record; bank balances remain provider-owned. */
export function applyManualCashBalances(accounts: FinanceAccount[], transactions: readonly {accountPath:string;amount:number;currency:string;manual?:boolean;transferAccount?:string;subtype?:string}[]): void {
  const cash = new Map(accounts.filter(a=>a.manual && a.type === "depository" && a.subtype === "cash").map(a=>[a.path?.replace(/\.md$/i,""),a]));
  for (const account of cash.values()) {
    if (!Number.isFinite(account.openingBalance)) throw new Error("A cash account has an invalid opening balance.");
    account.current = account.openingBalance!;
  }
  for (const entry of transactions) {
    if (!entry.manual) continue;
    if (!Number.isFinite(entry.amount)) throw new Error("A manual cash transaction has an invalid amount.");
    const transfer = entry.subtype === "transfer-in" || entry.subtype === "transfer-out";
    const counterpartPath = entry.transferAccount?.replace(/^\[\[|\]\]$/g, "").replace(/\.md$/i, "");
    const account = cash.get(entry.accountPath.replace(/\.md$/i, "")), counterpart = transfer ? cash.get(counterpartPath) : undefined;
    if (transfer) {
      const other = accounts.find(a => a.path?.replace(/\.md$/i, "") === counterpartPath);
      if (!other || other === account || other.currency !== entry.currency || (other.manual && !counterpart)) throw new Error("Repair the cash transfer’s other account link or currency.");
    }
    if (!account) throw new Error("A cash transaction has a missing cash account. Repair its account link.");
    if (account) {
      if (account.currency !== entry.currency) throw new Error("Cash transaction currency differs from its account.");
      account.current = (account.current || 0) + entry.amount;
    }
    if (counterpart) {
      if (counterpart.currency !== entry.currency) throw new Error("Cash transfer currencies differ.");
      counterpart.current = (counterpart.current || 0) - entry.amount;
    }
  }
}
