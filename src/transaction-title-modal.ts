import { App, Modal, Notice } from "obsidian";
import type { AtomicFinanceStore } from "./atomic-finance-store";
import type { TransactionTitleChange } from "./transaction-titles";
import * as logger from "./logger";

export class TransactionTitleModal extends Modal {
  private selected = new Set<TransactionTitleChange>();
  private page = 0;
  private busy = false;
  constructor(app: App, private changes: TransactionTitleChange[], private store: AtomicFinanceStore,
    private refreshed: () => Promise<void>, private includeEmptyProperties = false) {
    super(app);
    // Obsidian's modal scope consumes Enter before the browser activates a button.
    this.scope.register([], "Enter", () => {
      const focused = this.contentEl.ownerDocument.activeElement;
      if (focused?.tagName !== "BUTTON" || !this.contentEl.contains(focused)) return true;
      const button = focused as HTMLButtonElement;
      if (!button.disabled) button.click();
      return false;
    });
  }

  onOpen(): void {
    this.titleEl.setText(this.includeEmptyProperties ? "Review transaction records" : "Review transaction titles");
    this.contentEl.addClass("tps-finances-title-review");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    const actions = this.contentEl.createDiv({ cls: "tps-finances-title-actions" });
    const save = actions.createEl("button", { text: `Apply selected (${this.selected.size})`, cls: "mod-cta", attr: { type: "button" } });
    save.disabled = this.busy || !this.selected.size;
    save.onclick = () => void this.save();
    const close = actions.createEl("button", { text: "Close", attr: { type: "button" } });
    close.disabled = this.busy;
    close.onclick = () => this.close();
    if (!this.changes.length) {
      this.contentEl.createEl("p", { text: this.includeEmptyProperties ? "No transaction records need cleanup." : "No transaction titles need updating.", attr: { role: "status" } });
      return;
    }
    const pageSize = 40;
    this.page = Math.min(this.page, Math.floor((this.changes.length - 1) / pageSize));
    const visible = this.changes.slice(this.page * pageSize, (this.page + 1) * pageSize);
    const choose = actions.createEl("button", { text: "Select shown", attr: { type: "button" } });
    choose.disabled = this.busy;
    choose.onclick = () => { visible.forEach(change => this.selected.add(change)); this.render(); this.contentEl.querySelector<HTMLButtonElement>(".mod-cta")?.focus(); };
    for (const change of visible) {
      const row = this.contentEl.createEl("label", { cls: "tps-finances-title-choice" });
      const input = row.createEl("input", { type: "checkbox" });
      input.checked = this.selected.has(change);
      input.disabled = this.busy;
      const text = row.createDiv();
      text.createEl("span", { text: change.before || "(No title)" });
      if (change.before !== change.after) text.createEl("strong", {
        text: change.before.replace(/\s+/g, " ").trim() === change.after ? "Normalize spacing" : `→ ${change.after}`,
      });
      if (change.removeFields?.length) text.createEl("span", { text: `Remove empty: ${change.removeFields.join(", ")}` });
      text.createEl("small", { text: [change.date, change.path].filter(Boolean).join(" · ") });
      input.onchange = () => {
        if (input.checked) this.selected.add(change); else this.selected.delete(change);
        save.setText(`Apply selected (${this.selected.size})`);
        save.disabled = !this.selected.size;
      };
    }
    const pages = this.contentEl.createDiv({ cls: "tps-finances-title-actions" });
    for (const [label, direction] of [["Previous", -1], ["Next", 1]] as const) {
      const button = pages.createEl("button", { text: label, attr: { type: "button" } });
      button.disabled = this.busy || (direction < 0 ? this.page === 0 : (this.page + 1) * pageSize >= this.changes.length);
      button.onclick = () => { this.page += direction; this.render(); this.contentEl.querySelector<HTMLInputElement>('input')?.focus(); };
    }
    pages.createEl("span", { text: `${this.page + 1} / ${Math.ceil(this.changes.length / pageSize)}`, attr: { role: "status" } });
  }

  private async save(): Promise<void> {
    if (this.busy || !this.selected.size) return;
    this.busy = true;
    this.render();
    let saved = 0;
    try {
      for (const change of [...this.selected]) {
        await this.store.applyTransactionTitle(change);
        this.selected.delete(change);
        this.changes = this.changes.filter(candidate => candidate !== change);
        saved++;
      }
      new Notice(`Updated ${saved} transaction ${this.includeEmptyProperties ? "record" : "title"}${saved === 1 ? "" : "s"}.`);
      logger.flow("Titles", "review-applied", { saved, includeEmptyProperties: this.includeEmptyProperties });
    } catch (error) {
      logger.flow("Titles", "review-failed", { saved, remaining: this.selected.size });
      new Notice(`Saved ${saved}. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
      this.render();
      this.contentEl.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      if (saved) await this.refreshed().catch(() => new Notice(`${this.includeEmptyProperties ? "Records" : "Titles"} saved. Reopen Finances to refresh.`));
    }
  }
}
