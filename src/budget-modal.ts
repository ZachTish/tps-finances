import { App, Modal, Setting } from "obsidian";
import type { FinanceAccount, FinanceBudget } from "./types";
import { accountLinkPath, BUDGET_BUCKETS, budgetBucket, budgetCurrency, budgetInputError, type BudgetBucket } from "./flex-budget";

export class FinanceBudgetModal extends Modal {
  constructor(app: App, private readonly budget: FinanceBudget, private readonly accounts: FinanceAccount[],
    private readonly categories: string[], private readonly save: (budget: FinanceBudget) => Promise<void>) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal", "tps-finances-budget-modal");
    this.titleEl.setText(this.budget.sourcePath ? "Edit monthly target" : "New monthly target");
    const draft = {...this.budget, bucket:budgetBucket(this.budget), currency:budgetCurrency(this.budget), accounts:[...(this.budget.accounts || [])]};
    const form = this.contentEl.createEl("form");
    const fields = form.createEl("fieldset");
    let conditional: HTMLElement;
    new Setting(fields).setName("Section").addDropdown(drop => {
      for (const [value,label] of Object.entries(BUDGET_BUCKETS)) drop.addOption(value,label);
      drop.setValue(draft.bucket).onChange(value => {draft.bucket=value as BudgetBucket;renderConditional();});
      drop.selectEl.setAttribute("aria-label","Section");
    });
    new Setting(fields).setName("Name").addText(input=>{
      input.setValue(draft.name).onChange(value=>{draft.name=value;});input.inputEl.required=true;input.inputEl.setAttribute("aria-label","Name");
    });
    new Setting(fields).setName("Monthly amount").addText(input=>{
      input.inputEl.type="number";input.inputEl.min="0";input.inputEl.step="0.01";input.inputEl.required=true;
      input.inputEl.inputMode="decimal";input.inputEl.setAttribute("aria-label","Monthly amount");
      input.setValue(Number.isFinite(draft.monthlyLimit)?String(draft.monthlyLimit):"").onChange(value=>{draft.monthlyLimit=value.trim()?Number(value):NaN;});
    });
    new Setting(fields).setName("Currency").addText(input=>{
      input.setValue(draft.currency).onChange(value=>{draft.currency=value.trim().toUpperCase();renderConditional();});
      input.inputEl.maxLength=3;input.inputEl.setAttribute("aria-label","Currency");
    });
    conditional=fields.createDiv();
    const renderConditional=():void=>{
      conditional.empty();
      if (["income","fixed","category"].includes(draft.bucket)) {
        new Setting(conditional).setName(draft.bucket==="income"?"Income category (optional)":"Category").addText(input=>{
          input.setValue(draft.category).onChange(value=>{draft.category=value;});input.inputEl.setAttribute("aria-label","Category");
          const id=`tps-finances-budget-categories-${draft.id}`;
          input.inputEl.setAttribute("list",id);
          const list=conditional.createEl("datalist",{attr:{id}});
          for(const category of this.categories)list.createEl("option",{value:category});
        });
        if(draft.bucket==="income")conditional.createEl("small",{text:"Leave blank for a planned amount only; total income still includes every income transaction."});
      }
      if(draft.bucket==="savings") {
        conditional.createEl("h3",{text:"Contribution accounts"});
        const available=this.accounts.filter(account=>account.path && account.currency===draft.currency && ["depository","investment","brokerage"].includes(account.type));
        if(!available.length)conditional.createEl("p",{text:"Add a cash account or sync savings/investment accounts in this currency first."});
        for(const account of available) {
          const path=accountLinkPath(account.path!);
          const label=conditional.createEl("label",{cls:"tps-finances-budget-account"});
          const check=label.createEl("input",{type:"checkbox"});check.checked=draft.accounts.some(link=>accountLinkPath(link)===path);
          label.createSpan({text:`${account.name}${account.mask?` •${account.mask}`:""}`});
          check.addEventListener("change",()=>{draft.accounts=draft.accounts.filter(link=>accountLinkPath(link)!==path);if(check.checked)draft.accounts.push(`[[${path}]]`);});
        }
        const availablePaths=new Set(available.map(account=>accountLinkPath(account.path!)));
        for(const link of draft.accounts.filter(link=>!availablePaths.has(accountLinkPath(link)))) {
          const label=conditional.createEl("label",{cls:"tps-finances-budget-account"});
          const check=label.createEl("input",{type:"checkbox"});check.checked=true;
          label.createSpan({text:`Unavailable: ${accountLinkPath(link)}`});
          check.addEventListener("change",()=>{draft.accounts=draft.accounts.filter(value=>value!==link);if(check.checked)draft.accounts.push(link);});
        }
        conditional.createEl("small",{text:"Posted transfers in minus transfers out. Balances, gains and dividends do not count."});
      }
    };
    renderConditional();
    const error=form.createDiv({cls:"tps-finances-error",attr:{role:"alert"}});
    const actions=form.createDiv({cls:"tps-finances-confirm-actions"});
    if(draft.sourcePath){const open=actions.createEl("button",{text:"Open note",attr:{type:"button"}});open.addEventListener("click",()=>{void this.app.workspace.openLinkText(draft.sourcePath!,"");this.close();});}
    const cancel=actions.createEl("button",{text:"Cancel",attr:{type:"button"}});cancel.addEventListener("click",()=>this.close());
    const submit=actions.createEl("button",{text:draft.sourcePath?"Save":"Create",attr:{type:"submit"},cls:"mod-cta"});
    let saving=false;
    form.addEventListener("submit",async event=>{
      event.preventDefault();if(saving)return;
      const input={...draft,category:["income","fixed","category"].includes(draft.bucket)?draft.category.trim():"",accounts:draft.bucket==="savings"?draft.accounts:[]};
      const validation=budgetInputError(input);if(validation){error.setText(validation);return;}
      saving=true;fields.disabled=true;submit.disabled=true;error.empty();
      try{await this.save(input);this.close();}
      catch(reason){error.setText(reason instanceof Error?reason.message:String(reason));}
      finally{saving=false;fields.disabled=false;submit.disabled=false;}
    });
  }
}
