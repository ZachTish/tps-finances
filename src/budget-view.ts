import { setIcon } from "obsidian";
import type { DashboardModel, DashboardTransaction } from "./dashboard-view";
import type { FinanceBudget } from "./types";
import { BUDGET_BUCKETS, buildFlexBudget, budgetCurrency, type BudgetBucket, type BudgetRow } from "./flex-budget";

export interface BudgetViewState { month:string; currency:string; expanded:Set<string> }
export interface BudgetViewActions {
  render():void;
  add(bucket:BudgetBucket,currency:string):void;
  edit(budget:FinanceBudget):void;
  open(transaction:DashboardTransaction):void;
}
export function renderBudgetView(root:HTMLElement, data:DashboardModel, state:BudgetViewState, actions:BudgetViewActions):void {
  const entries=data.budgetEntries || [];
  const currencies=Array.from(new Set([state.currency,...entries.map(budgetCurrency),...data.accounts.map(a=>a.currency),...data.transactions.map(t=>t.currency)].filter(value=>/^[A-Z]{3}$/.test(value)))).sort();
  const money=(value:number):string=>new Intl.NumberFormat(undefined,{style:"currency",currency:state.currency,maximumFractionDigits:2}).format(value);
  const toolbar=root.createDiv({cls:"tps-finances-budget-toolbar"});
  toolbar.createEl("h2",{text:"Budget"});
  const month=toolbar.createEl("input",{type:"month",value:state.month,attr:{"aria-label":"Budget month","data-budget-focus":"month"}});
  month.addEventListener("change",()=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)){state.month=month.value;actions.render();}});
  const currency=toolbar.createEl("select",{attr:{"aria-label":"Budget currency","data-budget-focus":"currency"}});
  for(const value of currencies)currency.createEl("option",{value,text:value});currency.value=state.currency;
  currency.addEventListener("change",()=>{state.currency=currency.value;actions.render();});
  root.createEl("small",{cls:"tps-finances-budget-caption",text:"Recurring monthly plan · Actuals for the selected month"});
  const model=buildFlexBudget(entries,data.transactions,data.accounts,state.month,state.currency);
  if(model.errors.length){const error=root.createDiv({cls:"tps-finances-status is-warning",attr:{role:"alert"}});for(const message of Array.from(new Set(model.errors)))error.createDiv({text:message});}
  const summary=root.createDiv({cls:"tps-finances-flex-summary"});
  const metric=(label:string,value:number,detail:string):void=>{
    const card=summary.createDiv({cls:`tps-finances-flex-metric${value<0?" is-over":""}`});card.createEl("small",{text:label});
    card.createEl("strong",{text:model.errors.length?"Review plan":money(value)});card.createEl("small",{text:detail});
  };
  metric(model.unallocated<0?"Overallocated":"Left to allocate",model.unallocated,"Income − fixed − flexible − savings");
  metric(model.flexRemaining<0?"Flexible overspending":"Flexible remaining",model.flexRemaining,`${money(model.actual.flex)} spent of ${money(model.planned.flex)}`);
  const columns=(parent:HTMLElement):void=>{const row=parent.createDiv({cls:"tps-finances-plan-columns",attr:{"aria-hidden":"true"}});for(const text of ["","Planned","Actual","Remaining",""])row.createSpan({text});};
  const number=(parent:HTMLElement,label:string,value:number|null):void=>{const cell=parent.createDiv({cls:"tps-finances-plan-number"});cell.createEl("small",{text:label});cell.createSpan({text:value===null||!Number.isFinite(value)?"—":money(value)});};
  const transactions=(parent:HTMLElement,rows:DashboardTransaction[],amounts?:Map<string,number>):void=>{
    const list=parent.createDiv({cls:"tps-finances-plan-transactions"});
    for(const transaction of rows){
      const amount=amounts?.get(transaction.financeId) ?? -transaction.amount;if(amounts && Math.abs(amount)<0.005)continue;
      const button=list.createEl("button",{type:"button",cls:"tps-finances-plan-transaction"});
      const label=button.createDiv();label.createSpan({text:transaction.name});label.createEl("small",{text:`${transaction.date} · ${transaction.account}${transaction.pending?" · Pending":""}`});
      button.createSpan({text:money(amount)});button.addEventListener("click",()=>actions.open(transaction));
    }
  };
  const renderRow=(parent:HTMLElement,row:BudgetRow):void=>{
    const wrapper=parent.createDiv({cls:"tps-finances-plan-entry"});const line=wrapper.createDiv({cls:"tps-finances-plan-row"});
    const label=line.createDiv({cls:"tps-finances-plan-name"});
    const hasTransactions=row.transactions.some(t=>Math.abs(row.amounts.get(t.financeId)||0)>=0.005);
    if(hasTransactions){const expand=label.createEl("button",{type:"button",cls:"tps-finances-plan-toggle",attr:{"data-budget-focus":`expand-${row.budget.id}`,"aria-label":`Transactions for ${row.budget.name}`,"aria-expanded":String(state.expanded.has(row.budget.id))}});setIcon(expand,state.expanded.has(row.budget.id)?"chevron-down":"chevron-right");expand.addEventListener("click",()=>{state.expanded.has(row.budget.id)?state.expanded.delete(row.budget.id):state.expanded.add(row.budget.id);actions.render();});}
    label.createSpan({text:row.budget.name});
    number(line,"Planned",row.budget.monthlyLimit);number(line,"Actual",row.error?null:row.actual);
    number(line,"Remaining",row.error||row.actual===null?null:row.budget.monthlyLimit-row.actual);
    const edit=line.createEl("button",{type:"button",cls:"tps-finances-plan-edit",attr:{"aria-label":`Edit ${row.budget.name}`}});setIcon(edit,"pencil");edit.addEventListener("click",()=>actions.edit(row.budget));
    if(row.error)wrapper.createEl("small",{cls:"tps-finances-error",text:row.error});
    if(hasTransactions&&state.expanded.has(row.budget.id))transactions(wrapper,row.transactions,row.amounts);
  };
  for(const bucket of ["income","fixed","flex","savings"] as const){
    const section=root.createEl("section",{cls:`tps-finances-plan-section tps-finances-plan-${bucket}`});const header=section.createDiv({cls:"tps-finances-plan-heading"});header.createEl("h3",{text:BUDGET_BUCKETS[bucket]});
    const add=header.createEl("button",{text:bucket==="flex"&&model.rows.flex.length?"Edit allowance":"Add",type:"button",attr:{"aria-label":bucket==="flex"&&model.rows.flex.length?"Edit flexible allowance":`Add ${BUDGET_BUCKETS[bucket].toLowerCase()}`}});
    add.addEventListener("click",()=>bucket==="flex"&&model.rows.flex.length?actions.edit(model.rows.flex[0].budget):actions.add(bucket,state.currency));
    columns(section);
    const total=section.createDiv({cls:"tps-finances-plan-row tps-finances-plan-total"});total.createEl("strong",{cls:"tps-finances-plan-name",text:"Total"});
    number(total,"Planned",model.planned[bucket]);number(total,"Actual",model.actual[bucket]);number(total,"Remaining",model.planned[bucket]-model.actual[bucket]);total.createSpan();
    if(bucket!=="flex")for(const row of model.rows[bucket])renderRow(section,row);
    if(!model.rows[bucket].length)section.createEl("small",{cls:"tps-finances-plan-empty",text:bucket==="flex"?"Set one allowance for spending outside fixed categories.":bucket==="savings"?"Add a target and choose its contribution accounts.":"No monthly targets yet."});
    if(bucket==="flex"){
      if(model.flexTransactions.length){const details=section.createEl("details");details.open=state.expanded.has("flex-transactions");details.createEl("summary",{text:`${model.flexTransactions.length} flexible transactions`});details.addEventListener("toggle",()=>{details.open?state.expanded.add("flex-transactions"):state.expanded.delete("flex-transactions");});transactions(details,model.flexTransactions);}
      const limits=section.createEl("details");limits.open=state.expanded.has("category-limits");limits.createEl("summary",{text:"Category limits"});limits.addEventListener("toggle",()=>{limits.open?state.expanded.add("category-limits"):state.expanded.delete("category-limits");});
      const addLimit=limits.createEl("button",{text:"Add category limit",type:"button"});addLimit.addEventListener("click",()=>actions.add("category",state.currency));
      limits.createEl("small",{cls:"tps-finances-budget-caption",text:"Optional caps; these do not change your flexible allowance."});
      for(const row of model.rows.category)renderRow(limits,row);
    }
  }
  const notes=[model.pendingCount?`${model.pendingCount} pending transactions included in income/spending; savings uses posted transfers.`:"",model.uncategorizedCount?`${model.uncategorizedCount} uncategorized transactions count toward flexible spending.`:""].filter(Boolean);
  if(notes.length)root.createEl("small",{cls:"tps-finances-budget-caption",text:notes.join(" ")});
  if(model.review.length){const details=root.createEl("details",{cls:"tps-finances-status is-warning"});details.createEl("summary",{text:`Review ${model.review.length} unclassified movements`});transactions(details,model.review,new Map(model.review.map(t=>[t.financeId,t.amount])));}
}
