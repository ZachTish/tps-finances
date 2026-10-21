import { FinanceProperties, PROPERTY_GROUPS, FINANCE_PROPERTY_KEYS, financeIdentityKey } from "./finance-properties";
import type { FinanceIdentityMigrationPreview } from "./identity-migration";
import { previewPropertyMigration, propertyChanges } from "./property-migration";
import { App, Modal, Notice, PluginSettingTab, Setting, ToggleComponent } from "obsidian";
import type TPSFinancesPlugin from "./main";

type FinanceSettingsRoute = "data" | "rules" | "properties";

const FINANCE_SETTINGS_ROUTES: Array<{
  id: FinanceSettingsRoute;
  title: string;
  description: string;
}> = [
  {
    id: "data",
    title: "Data & storage",
    description: "Choose the Finance folder and review older transaction entries.",
  },
  {
    id: "rules",
    title: "Rules & budgets",
    description: "Create rules and budgets, or open your Budgets Base.",
  },
  { id: "properties", title: "Properties", description: "Configure manual Finance fields and names used to read existing records." },
];

// Presentation only: these mappings stay in the existing codec and migration owner.
const IMPORTED_PROPERTIES = new Set([
  "authorizedDate", "pending", "merchant", "providerName", "providerTitle", "providerCategory", "providerCategoryDetail", "investmentType",
  "institution", "accountMask", "available", "limit", "name", "ticker", "holdingType", "quantity", "price", "fees", "value", "costBasis", "asOf", "stale", "active",
]);
const EARLIER_PROPERTIES: Record<string, string> = {
  accountName: "Reads older account names. New manual accounts use title without a second name field.",
  categoryOverride: "Reads older transaction categories. New manual categories use category in Common.",
  transactionLogTarget: "Retained for older property mappings and explicit renames. Current manual actions do not use a transaction log target.",
  migrationSource: "Written only by explicit older-entry conversion to verify its source. Manual entries do not add it.",
};

export class TPSFinancesSettingTab extends PluginSettingTab {
  private activeRoute: FinanceSettingsRoute = "data";
  private propertyGroup = "Common";
  private propertyDraft: Record<string, string> | null = null;
  private propertyBaseline: FinanceProperties | null = null;

  constructor(app: App, private readonly plugin: TPSFinancesPlugin) {
    super(app, plugin);
  }


  display(): void {
    this.renderSettings();
  }

  private renderSettings(focusRouteHeading = false, focusControlName?: string): void {
    const { containerEl } = this;
    const scrollTop = containerEl.scrollTop;
    const expanded = new Set(Array.from(containerEl.querySelectorAll<HTMLDetailsElement>("details[open]"))
      .map(section => section.dataset.financeDisclosure));
    containerEl.empty();
    containerEl.createEl("h2", { text: "TPS Finances" });
    new Setting(containerEl).setName("Bank connections")
      .setDesc("Bank and Wallet importing are retired here. Configure imports in TishOS; existing notes remain available.");

    const hub = containerEl.createDiv({ cls: "tps-finances-settings-hub" });
    hub.createEl("h3", { text: "Choose what to configure" });
    const navigation = hub.createDiv({
      cls: "tps-finances-settings-routes",
      attr: { role: "navigation", "aria-label": "Finances settings destinations" },
    });
    let activeRouteButton: HTMLButtonElement | null = null;
    for (const route of FINANCE_SETTINGS_ROUTES) {
      const isActive = route.id === this.activeRoute;
      const button = navigation.createEl("button", {
        cls: `tps-finances-settings-route${isActive ? " is-active" : ""}`,
        attr: {
          type: "button",
          "aria-pressed": String(isActive),
          "aria-label": route.title,
        },
      });
      if (isActive) activeRouteButton = button;
      button.createSpan({ cls: "tps-finances-settings-route-title", text: route.title });
      button.addEventListener("click", () => {
        if (route.id === this.activeRoute) return;
        this.activeRoute = route.id;
        this.renderSettings(true);
      });
    }

    const route = FINANCE_SETTINGS_ROUTES.find(({ id }) => id === this.activeRoute)
      ?? FINANCE_SETTINGS_ROUTES[0];
    const page = containerEl.createDiv({ cls: "tps-finances-settings-page" });
    const pageHeading = page.createEl("h3", { text: route.title, attr: { tabindex: "-1" } });

    if (route.id === "data") this.renderDataSettings(page);
    else if (route.id === "properties") this.renderPropertySettings(page);
    else this.renderRulesSettings(page);

    for (const section of Array.from(containerEl.querySelectorAll<HTMLDetailsElement>("details[data-finance-disclosure]"))) {
      section.open = expanded.has(section.dataset.financeDisclosure);
    }
    if (!focusRouteHeading) containerEl.scrollTop = scrollTop;
    if (focusRouteHeading || focusControlName) {
      requestAnimationFrame(() => {
        activeRouteButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (focusControlName) {
          const settingItems = Array.from(page.querySelectorAll<HTMLElement>(".setting-item"));
          const settingItem = settingItems.find((item) =>
            item.querySelector(".setting-item-name")?.textContent?.trim() === focusControlName
          );
          const control = settingItem?.querySelector<HTMLElement>("input, button, select, textarea");
          control?.focus({ preventScroll: true });
          return;
        }
        pageHeading.focus({ preventScroll: true });
        pageHeading.scrollIntoView({ block: "start" });
      });
    }
  }

  private renderPropertySettings(parent: HTMLElement): void {
    new Setting(parent).setName("Record classification")
      .setDesc("Global Context Menu owns record classification, Scheduled and record IDs. Review older IDs under Data & storage → Older records.")
      .addButton(button => button.setButtonText("Configure in GCM").onClick(() => {
        const open = (this.app as any).plugins?.plugins?.["tps-global-context-menu"]?.api?.ui?.openCustomPropertySettings;
        if (typeof open !== "function" || !open()) new Notice("Enable TPS Global Context Menu to configure record classifications.");
      }));
    if (this.plugin.settings.propertyMigration) {
      new Setting(parent).setName("Property migration paused")
        .setDesc("Resume to finish renaming properties. Finance writes remain paused until it completes.")
        .addButton(button => button.setButtonText("Resume migration").onClick(async () => {
          button.setDisabled(true);
          try { await this.plugin.resumePropertyMigration(); this.propertyDraft = null; new Notice("Property migration complete."); }
          catch (error) { new Notice(String(error), 12000); }
          finally { this.renderSettings(false, "Property migration paused"); }
        }));
      return;
    }
    if (!this.propertyDraft) {
      this.propertyBaseline = new FinanceProperties(this.plugin.settings.propertyNames);
      this.propertyDraft = { ...this.propertyBaseline.names.keys };
    }
    new Setting(parent).setName("Property names")
      .setDesc("Current manual fields appear first. Imported and older-record mappings remain below. The toggle pins a property name; turning it off restores the default name, not whether a field is written. Import output is configured in TishOS. Save asks before renaming existing properties; ID values stay unchanged.")
      .addButton(button => button.setButtonText("Save property names").setCta().onClick(async () => {
        button.setDisabled(true);
        try {
          const from = this.propertyBaseline!, to = new FinanceProperties({keys: this.propertyDraft!});
          to.assertIdentityKey(financeIdentityKey(this.app));
          if (JSON.stringify(from.names) === JSON.stringify(to.names)) { new Notice("No property names changed."); return; }
          if (!propertyChanges(from, to).length) {
            await this.plugin.changePropertyNames(from, to, false);
            this.propertyDraft = null;
            new Notice("Finance property names saved.");
            this.renderSettings(false, "Property names");
            return;
          }
          const preview = await previewPropertyMigration(this.app, from, to, this.plugin.settings.financeFolder);
          new PropertyNamesModal(this.app, from, to, preview, async migrate => {
            await this.plugin.changePropertyNames(from, to, migrate);
            this.propertyDraft = null;
          }, () => this.renderSettings(false, "Property names")).open();
        } catch (error) { new Notice(String(error), 12000); }
        finally { button.setDisabled(false); }
      })).addButton(button => button.setButtonText("Discard edits").onClick(() => {
        this.propertyDraft = null; this.renderSettings(false, "Property names");
      }));
    new Setting(parent).setName("Property group").addDropdown(dropdown => {
      for (const group of Object.keys(PROPERTY_GROUPS)) dropdown.addOption(group, group);
      dropdown.setValue(this.propertyGroup).onChange(value => {
        this.propertyGroup = value; this.renderSettings(false, "Property group");
      });
      dropdown.selectEl.setAttribute("aria-label", "Property group");
    });
    const keys = PROPERTY_GROUPS[this.propertyGroup];
    const earlier = keys.filter(key => IMPORTED_PROPERTIES.has(key) || key in EARLIER_PROPERTIES);
    this.renderPropertyFields(parent, keys.filter(key => !earlier.includes(key)));
    if (earlier.length) {
      const section = this.compatibilitySection(parent, "imported-properties", `Imported and older records (${earlier.length})`);
      section.createEl("p", {text: "These names read existing data or support explicit conversion. Changing them does not change TishOS import settings. Conversion can preserve source values; opening this section changes no notes."});
      this.renderPropertyFields(section, earlier);
    }
  }

  private renderPropertyFields(parent: HTMLElement, keys: readonly string[]): void {
    const gcmKinds = (this.app as any).plugins?.plugins?.["tps-global-context-menu"]?.api?.frontmatterKinds;
    for (const key of keys) {
      if (gcmKinds?.version === 2 && (key === "kind" || key === "date")) {
        const currentKey = gcmKinds.propertyKey?.(key === "date" ? "scheduled" : "kind");
        new Setting(parent).setName(key === "date" ? "Scheduled" : "Record kind")
          .setDesc(`Managed in Global Context Menu${currentKey ? ` as “${currentKey}”` : ""}. Legacy Finance key “${this.propertyDraft![key] ?? key}” remains readable during migration.`);
        continue;
      }
      let explicitToggle: ToggleComponent | null = null;
      const field = new Setting(parent).setName(propertyLabel(key));
      field.setDesc(EARLIER_PROPERTIES[key] || (IMPORTED_PROPERTIES.has(key)
        ? "Reads imported or manually edited data. TishOS controls import output; Finance manual actions do not add this field."
        : key === "category" ? "Shared saved category for transactions, rules and budgets."
        : key === "type" && gcmKinds?.version === 2
          ? "Reads older records and distinguishes transaction kinds that share one list value. Finances omits it when the configured kind values differ."
          : "Used by Finance manual creation or editing and by existing-record readers."));
      field.addText(text => {
        text.setValue(this.propertyDraft![key] ?? key).onChange(value => {
          this.propertyDraft![key] = value.trim();
          explicitToggle?.setValue(true);
        });
        text.inputEl.setAttribute("aria-label", `${propertyLabel(key)} property name`);
        text.inputEl.spellcheck = false;
      }).addToggle(toggle => {
        explicitToggle = toggle;
        toggle.setValue(Object.prototype.hasOwnProperty.call(this.propertyDraft, key)).onChange(explicit => {
          if (explicit) this.propertyDraft![key] = this.propertyDraft![key] ?? key;
          else {
            delete this.propertyDraft![key];
            this.renderSettings(false, propertyLabel(key));
          }
        });
        toggle.setTooltip("Store this property name explicitly in Finance settings; turn off to restore its default name.");
        toggle.toggleEl.setAttribute("aria-label", `Store ${propertyLabel(key)} name explicitly`);
      });
    }
  }

  private renderDataSettings(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Finance folder")
      .setDesc("Leave blank for the vault root, without subfolders. Existing notes stay where they are.")
      .addText((text) => text.setPlaceholder("Vault root").setValue(this.plugin.settings.financeFolder).onChange(async (value) => {
        try {
          await this.plugin.setFinanceFolder(value);
        } catch (error) { new Notice(String(error)); }
      }));

    new Setting(parent).setName("Debug logging")
      .setDesc("Log record operations without tokens or transaction descriptions.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.enableLogging).onChange(async value => {
        this.plugin.settings.enableLogging = value;
        await this.plugin.saveSettings();
      }));

    const earlier = this.compatibilitySection(parent, "older-records", "Older records");
    new Setting(earlier).setName("Legacy inline transactions")
      .setDesc(this.plugin.legacyReviewRequired()
        ? "Older inline entries may still exist. Transaction notes are the active format; adding transactions stays paused until a full check finds no remaining markers. Existing notes are left untouched."
        : "Transaction notes are the active format. Check older inline entries when reviewing an imported or older vault; the check changes no notes.")
      .addButton(button => button.setButtonText("Check old entries").onClick(async () => {
        button.setDisabled(true);
        try {
          const result = await this.plugin.reviewLegacyTransactionMarkers();
          new Notice(result.markers
            ? `${result.markers} inline financeId marker${result.markers === 1 ? "" : "s"} remain; first file: ${result.firstPath}. Review or convert them before adding transactions. No notes changed.`
            : "No inline financeId markers remain. Transaction writes are ready.", 12000);
        } catch (error) { new Notice(String(error), 12000); }
        finally { this.renderSettings(false, "Legacy inline transactions"); }
      }))
      .addButton(button => button.setButtonText("Convert to transaction notes").onClick(async () => {
        button.setDisabled(true);
        try { await this.plugin.migrateAtomicTransactions(); }
        catch (error) { new Notice(String(error), 12000); }
        finally { button.setDisabled(false); }
      }));

    this.renderIdentityReview(earlier);
  }

  private compatibilitySection(parent: HTMLElement, id: string, label: string): HTMLDetailsElement {
    const section = parent.createEl("details", {cls: "tps-finances-settings-compatibility", attr: {"data-finance-disclosure": id}});
    section.createEl("summary", {text: label});
    return section;
  }

  private renderIdentityReview(parent: HTMLElement): void {
    new Setting(parent).setName("Record IDs")
      .setDesc("New finance notes use one record ID. Review existing notes to remove matching duplicate self IDs. Notes with only an older ID stay unchanged and readable. Account and security references remain unchanged.")
      .addButton(button => button.setButtonText("Review existing IDs").onClick(async () => {
        button.setDisabled(true);
        try {
          const preview = await this.plugin.previewFinanceIdentityConsolidation();
          if (!preview.notes.length && !preview.bases.length && !preview.conflicts.length) {
            new Notice("No matching duplicate finance IDs or generated views need changes.");
            return;
          }
          new FinanceIdentityModal(this.app, preview,
            reviewed => this.plugin.consolidateFinanceIdentities(reviewed),
            () => this.renderSettings(false, "Record IDs")).open();
        } catch (error) { new Notice(String(error), 12000); }
        finally { button.setDisabled(false); }
      }));
  }

  private renderRulesSettings(parent: HTMLElement): void {
    parent.createEl("p", {
      text: "Rules and budgets are ordinary notes. Use these shortcuts to create them, then manage the full collections in their notes or your Bases.",
      cls: "tps-finances-settings-callout",
    });

    new Setting(parent)
      .setName("Categorization rules")
      .setDesc("Create a rule for ordered account, name, merchant, amount, category, and tag matching.")
      .addButton((button) => button.setButtonText("Add rule").onClick(() => this.plugin.addCategorizationRule()));

    new Setting(parent)
      .setName("Monthly budgets")
      .setDesc("Plan income, fixed expenses, flexible spending, and savings contributions.")
      .addButton((button) => button.setButtonText("Open Budgets Base").onClick(() => void this.plugin.openFinanceBase("Budgets").catch(error => new Notice(String(error)))))
      .addButton((button) => button.setButtonText("Add budget").onClick(() => this.plugin.addMonthlyBudget()));
  }
}

function propertyLabel(key: string): string {
  if (key === "type") return "Record type";
  if (key === "kind") return "Record kind";
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}

export class FinanceIdentityModal extends Modal {
  private busy = false;
  constructor(app: App, private preview: FinanceIdentityMigrationPreview,
    private apply: (preview: FinanceIdentityMigrationPreview) => Promise<number>, private finished: () => void) {
    super(app);
    this.scope.register([], "Enter", () => {
      const focused = this.contentEl.ownerDocument.activeElement;
      if (focused?.tagName !== "BUTTON" || !this.contentEl.contains(focused)) return true;
      const button = focused as HTMLButtonElement;
      if (!button.disabled) button.click();
      return false;
    });
  }
  onOpen(): void {
    this.titleEl.setText("Consolidate finance record IDs?");
    this.contentEl.addClass("tps-finances-property-confirm");
    this.contentEl.createEl("p", {text: `Remove matching duplicate ID properties from ${this.preview.notes.length} finance notes, keeping each existing “${this.preview.primaryKey}” ID. Notes with only an older ID stay unchanged and readable.`});
    if (this.preview.bases.length) this.contentEl.createEl("p", {text: `Update ${this.preview.bases.length} plugin-generated views to use the same ID property. Customized views stay unchanged.`});
    this.contentEl.createEl("p", {text: "ID values, note paths, links, bodies, provider state and account/security references are preserved. Nothing changes until you confirm."});
    const actions = this.contentEl.createDiv({cls: "tps-finances-title-actions"});
    const apply = actions.createEl("button", {text: "Consolidate IDs", cls: "mod-cta", attr: {type: "button"}});
    apply.disabled = !(this.preview.notes.length || this.preview.bases.length) || this.preview.conflicts.length > 0;
    apply.onclick = () => void this.confirm();
    const cancel = actions.createEl("button", {text: "Cancel", attr: {type: "button"}});
    cancel.onclick = () => this.close();
    if (this.preview.conflicts.length) {
      const errors = this.contentEl.createDiv({attr: {role: "alert"}});
      errors.createEl("p", {text: `${this.preview.conflicts.length} conflicts must be resolved before consolidation. No notes have changed.`});
      for (const conflict of this.preview.conflicts.slice(0, 10)) errors.createEl("p", {text: conflict});
    }
    const list = this.contentEl.createEl("ul");
    for (const note of this.preview.notes.slice(0, 20)) list.createEl("li", {text: note.path});
    for (const base of this.preview.bases) list.createEl("li", {text: base.path});
    if (this.preview.notes.length > 20) this.contentEl.createEl("p", {text: `And ${this.preview.notes.length - 20} other notes.`});
  }
  private async confirm(): Promise<void> {
    if (this.busy || this.preview.conflicts.length || !(this.preview.notes.length || this.preview.bases.length)) return;
    this.busy = true;
    this.contentEl.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = true; });
    try {
      const updated = await this.apply(this.preview);
      new Notice(`Consolidated IDs in ${updated} finance notes${this.preview.bases.length ? " and updated generated views" : ""}.`);
    } catch (error) { new Notice(String(error), 12000); }
    finally { this.busy = false; this.close(); }
  }
  onClose(): void { this.finished(); }
}

class PropertyNamesModal extends Modal {
  private busy = false;
  constructor(app: App, private from: FinanceProperties, private to: FinanceProperties,
    private preview: Awaited<ReturnType<typeof previewPropertyMigration>>,
    private save: (migrate: boolean) => Promise<void>, private finished: () => void) {
    super(app);
    this.scope.register([], "Enter", () => {
      const focused = this.contentEl.ownerDocument.activeElement;
      if (focused?.tagName !== "BUTTON" || !this.contentEl.contains(focused)) return true;
      const button = focused as HTMLButtonElement;
      if (!button.disabled) button.click();
      return false;
    });
  }
  onOpen(): void {
    this.titleEl.setText("Migrate existing properties?");
    this.contentEl.addClass("tps-finances-property-confirm");
    this.contentEl.createEl("p", {text: `Rename properties in ${this.preview.journal.notes.length} finance ${this.preview.journal.notes.length === 1 ? "note" : "notes"}?`});
    const actions = this.contentEl.createDiv({cls: "tps-finances-title-actions"});
    const migrate = actions.createEl("button", {text: "Migrate and save", cls: "mod-cta", attr: {type: "button"}});
    migrate.disabled = this.preview.conflicts.length > 0;
    const skip = actions.createEl("button", {text: "Save without migrating", attr: {type: "button"}});
    const cancel = actions.createEl("button", {text: "Cancel", attr: {type: "button"}});
    cancel.onclick = () => this.close();
    migrate.onclick = () => void this.apply(true);
    skip.onclick = () => void this.apply(false);
    this.contentEl.createEl("p", {text: "Without migration, old properties stay in the notes but Finances stops using them. Customized Bases and other plugins must be updated separately."});
    const list = this.contentEl.createEl("ul");
    for (const change of propertyChanges(this.from, this.to)) list.createEl("li", {text: `${change.from} → ${change.to}`});
    if (this.preview.conflicts.length) {
      const errors = this.contentEl.createDiv({attr: {role: "alert"}});
      errors.createEl("p", {text: `${this.preview.conflicts.length} conflicts must be resolved before migrating.`});
      for (const conflict of this.preview.conflicts.slice(0, 10)) errors.createEl("p", {text: conflict});
    }
  }
  private async apply(migrate: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.contentEl.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = true; });
    try { await this.save(migrate); new Notice("Finance property names saved."); }
    catch (error) { new Notice(String(error), 12000); }
    finally { this.busy = false; this.close(); }
  }
  onClose(): void { this.finished(); }
}
