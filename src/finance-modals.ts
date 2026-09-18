import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { normalizeTags } from "./classification";
import type { DashboardTransaction } from "./dashboard-view";
import type { FinanceRule } from "./types";

export class FinanceRuleModal extends Modal {
  constructor(app: App, private readonly save: (rule: Omit<FinanceRule, "id">) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.titleEl.setText("New categorization rule");
    this.contentEl.createEl("p", { cls: "setting-item-description", text: "All populated match fields must match. Matching ignores capitalization and checks whether the text contains your value." });
    let name = "";
    let merchantContains = "";
    let nameContains = "";
    let accountContains = "";
    let minAmount: number | null = null;
    let maxAmount: number | null = null;
    let category = "";
    let tags: string[] = [];
    let priority = 100;
    textSetting(this.contentEl, "Rule name", "For example, Grocery stores", "", (value) => { name = value; });
    textSetting(this.contentEl, "Vendor contains", "Merchant/vendor name", "", (value) => { merchantContains = value; });
    textSetting(this.contentEl, "Transaction name contains", "Description from the institution", "", (value) => { nameContains = value; });
    textSetting(this.contentEl, "Account contains", "For example, Sapphire", "", (value) => { accountContains = value; });
    textSetting(this.contentEl, "Minimum amount", "Optional absolute amount", "", (value) => { minAmount = optionalPositive(value); });
    textSetting(this.contentEl, "Maximum amount", "Optional absolute amount", "", (value) => { maxAmount = optionalPositive(value); });
    textSetting(this.contentEl, "Category", "For example, groceries", "", (value) => { category = value; });
    textSetting(this.contentEl, "Tags", "Comma-separated; # is optional", "", (value) => { tags = normalizeTags(value.split(",")); });
    textSetting(this.contentEl, "Priority", "Lower rules run first", "100", (value) => { priority = Number.isFinite(Number(value)) ? Number(value) : 100; });
    modalActions(this.contentEl, this, async () => {
      if (!name.trim()) return void new Notice("Give the rule a name.");
      if (![merchantContains, nameContains, accountContains].some((value) => value.trim()) && minAmount == null && maxAmount == null) return void new Notice("Add at least one match condition.");
      if (!category.trim() && !tags.length) return void new Notice("Add a category or at least one tag.");
      await this.save({ name: name.trim(), enabled: true, priority, accountContains: accountContains.trim(), nameContains: nameContains.trim(), merchantContains: merchantContains.trim(), minAmount, maxAmount, category: category.trim(), tags });
      this.close();
    });
  }
}

export { FinanceBudgetModal } from "./budget-modal";

export class TransactionClassificationModal extends Modal {
  constructor(app: App, private readonly transaction: DashboardTransaction, private readonly save: (category: string, tags: string[]) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.titleEl.setText("Categorize transaction");
    this.contentEl.createEl("p", { cls: "tps-finances-modal-transaction", text: `${this.transaction.name} · ${this.transaction.account}` });
    let category = this.transaction.categorySource === "manual" ? this.transaction.category : "";
    let tags = [...this.transaction.manualTags];
    textSetting(this.contentEl, "Category override", `Current: ${this.transaction.category || "Uncategorized"}. Leave blank to use rules or Plaid.`, category, (value) => { category = value; });
    textSetting(this.contentEl, "Manual tags", "Comma-separated; rule tags are added automatically", tags.join(", "), (value) => { tags = normalizeTags(value.split(",")); });
    modalActions(this.contentEl, this, async () => {
      await this.save(category.trim(), tags);
      this.close();
    }, "Save classification");
  }
}

function textSetting(parent: HTMLElement, name: string, description: string, value: string, change: (value: string) => void): void {
  new Setting(parent).setName(name).setDesc(description).addText((text) => text.setValue(value).onChange(change));
}

function modalActions(parent: HTMLElement, modal: Modal, save: () => Promise<void>, label = "Create"): void {
  const actions = parent.createDiv({ cls: "tps-finances-confirm-actions" });
  new ButtonComponent(actions).setButtonText("Cancel").onClick(() => modal.close());
  let saving = false;
  const saveButton = new ButtonComponent(actions).setButtonText(label).setCta().onClick(async () => {
    if (saving) return;
    saving = true;
    saveButton.setDisabled(true);
    try {
      await save();
    } catch (error) {
      new Notice(`TPS Finances could not save: ${error instanceof Error ? error.message : String(error)}`, 10000);
    } finally {
      saving = false;
      saveButton.setDisabled(false);
    }
  });
}

function optionalPositive(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

export class ManualAccountModal extends Modal {
  constructor(app: App, private kind: "cash" | "asset", private save: (input: import("./manual-finance").ManualAccountInput) => Promise<void>) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.titleEl.setText(this.kind === "cash" ? "New cash account" : "New resale asset");
    const input: import("./manual-finance").ManualAccountInput = {name:"",kind:this.kind,value:0,currency:"USD",valuationDate:today(),assetType:"personal-property",purchaseTransaction:"",liabilityAccount:""};
    textSetting(this.contentEl,"Name","",input.name,v=>input.name=v);
    textSetting(this.contentEl,this.kind === "cash" ? "Opening balance" : "Current resale value","",String(input.value),v=>input.value=v.trim() ? Number(v) : NaN);
    textSetting(this.contentEl,"Currency","Three-letter code",input.currency,v=>input.currency=v);
    if (this.kind === "asset") {
      new Setting(this.contentEl).setName("Asset type").addDropdown(d=>d.addOptions({"personal-property":"Other","house":"House","car":"Car","computer":"Computer"}).setValue(input.assetType).onChange(v=>input.assetType=v));
      textSetting(this.contentEl,"Valuation date","YYYY-MM-DD",input.valuationDate,v=>input.valuationDate=v);
      textSetting(this.contentEl,"Purchase transaction","Optional note path",input.purchaseTransaction,v=>input.purchaseTransaction=v);
      textSetting(this.contentEl,"Loan account","Optional note path; its balance is already counted separately",input.liabilityAccount,v=>input.liabilityAccount=v);
    }
    modalActions(this.contentEl,this,async()=>{await this.save(input);this.close();});
  }
}

export class CashTransactionModal extends Modal {
  constructor(app: App, private accounts: import("./types").FinanceAccount[], private save: (input: import("./manual-finance").CashEntryInput) => Promise<void>) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.titleEl.setText("Log cash transaction");
    const cash = this.accounts.filter(a=>a.manual && a.type === "depository" && a.subtype === "cash" && a.path);
    const input: import("./manual-finance").CashEntryInput = {accountPath:cash[0]?.path || "",title:"",amount:NaN,date:today(),kind:"expense",category:"",tags:[],counterpart:"",linkedTransaction:""};
    new Setting(this.contentEl).setName("Cash account").addDropdown(d=>{for(const a of cash)d.addOption(a.path!,`${a.name} (${a.currency})`);d.setValue(input.accountPath).onChange(v=>input.accountPath=v);});
    let transferFields: HTMLDivElement;
    new Setting(this.contentEl).setName("Transaction").addDropdown(d=>d.addOptions({expense:"Expense",income:"Income","transfer-in":"Transfer into cash","transfer-out":"Transfer out of cash"}).setValue(input.kind).onChange(v=>{input.kind=v as typeof input.kind;transferFields.hidden=!v.startsWith("transfer-");}));
    textSetting(this.contentEl,"Description","",input.title,v=>input.title=v);
    textSetting(this.contentEl,"Amount","Positive amount in the cash account’s currency","",v=>input.amount=Number(v));
    textSetting(this.contentEl,"Date","YYYY-MM-DD",input.date,v=>input.date=v);
    textSetting(this.contentEl,"Category","Optional",input.category,v=>input.category=v);
    textSetting(this.contentEl,"Tags","Comma-separated","",v=>input.tags=normalizeTags(v.split(",")));
    transferFields=this.contentEl.createDiv();transferFields.hidden=true;
    new Setting(transferFields).setName("Other account").setDesc("Bank balances remain managed by Plaid. Record each cash-to-cash transfer only once.").addDropdown(d=>{d.addOption("","Choose account");for(const a of this.accounts.filter(a=>a.path && (!a.manual || a.type === "depository")))d.addOption(a.path!,`${a.name} (${a.currency})`);d.onChange(v=>input.counterpart=v);});
    textSetting(transferFields,"Matching bank transaction","Optional note path",input.linkedTransaction,v=>input.linkedTransaction=v);
    modalActions(this.contentEl,this,async()=>{await this.save(input);this.close();},"Record");
  }
}

export class AssetValueModal extends Modal {
  constructor(app: App, private account: import("./types").FinanceAccount, private save: (value:number,date:string)=>Promise<void>) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.titleEl.setText(`Value ${this.account.name}`);
    let value=this.account.current ?? 0, date=today();
    textSetting(this.contentEl,"Current resale value",this.account.currency,String(value),v=>value=v.trim() ? Number(v) : NaN);
    textSetting(this.contentEl,"Valuation date","YYYY-MM-DD",date,v=>date=v);
    modalActions(this.contentEl,this,async()=>{await this.save(value,date);this.close();},"Save");
  }
}
