import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { normalizeTags } from "./classification";
import type { DashboardTransaction } from "./dashboard-view";
import type { FinanceBudget, FinanceRule } from "./types";

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

export class FinanceBudgetModal extends Modal {
  constructor(app: App, private readonly save: (budget: Omit<FinanceBudget, "id">) => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.titleEl.setText("New monthly budget");
    this.contentEl.createEl("p", { cls: "setting-item-description", text: "The budget repeats each calendar month and measures spending in the selected effective category." });
    let category = "";
    let limit = 0;
    textSetting(this.contentEl, "Category", "Must match your category or rule output", "", (value) => { category = value; });
    textSetting(this.contentEl, "Monthly limit", "Positive amount in dollars", "", (value) => { limit = Number(value); });
    modalActions(this.contentEl, this, async () => {
      if (!category.trim()) return void new Notice("Enter a category.");
      if (!Number.isFinite(limit) || limit <= 0) return void new Notice("Enter a positive monthly limit.");
      await this.save({ name: `${category.trim()} monthly budget`, category: category.trim(), monthlyLimit: limit });
      this.close();
    });
  }
}

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
