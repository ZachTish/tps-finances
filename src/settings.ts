import { FinanceProperties, PROPERTY_GROUPS, FINANCE_PROPERTY_KEYS } from "./finance-properties";
import { previewPropertyMigration, propertyChanges } from "./property-migration";
import { App, ButtonComponent, Modal, Notice, Platform, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type TPSFinancesPlugin from "./main";
import type { PlaidEnvironment, TransactionLogTarget } from "./types";

type FinanceSettingsRoute = "plaid" | "data" | "connections" | "rules" | "properties";

const FINANCE_SETTINGS_ROUTES: Array<{
  id: FinanceSettingsRoute;
  title: string;
  description: string;
}> = [
  {
    id: "plaid",
    title: "Plaid setup",
    description: "Choose the environment and device-local credentials.",
  },
  {
    id: "data",
    title: "Data & routing",
    description: "Choose storage, history, and transaction ownership.",
  },
  {
    id: "connections",
    title: "Connections",
    description: "Connect, sync, disconnect, and troubleshoot institutions.",
  },
  {
    id: "rules",
    title: "Rules & budgets",
    description: "Open the dashboard or create a rule or monthly budget.",
  },
  { id: "properties", title: "Properties", description: "Choose the property names written to finance notes." },
];

export class TPSFinancesSettingTab extends PluginSettingTab {
  private activeRoute: FinanceSettingsRoute = "plaid";
  private propertyGroup = "Common";
  private propertyDraft: Record<string, string> | null = null;
  private propertyBaseline: FinanceProperties | null = null;

  constructor(app: App, private readonly plugin: TPSFinancesPlugin) {
    super(app, plugin);
  }

  openConnections(): void {
    this.activeRoute = "connections";
    const settings = (this.app as any).setting;
    settings?.open(); settings?.openTabById("tps-finances");
  }

  display(): void {
    this.renderSettings();
  }

  private renderSettings(focusRouteHeading = false, focusControlName?: string): void {
    const { containerEl } = this;
    const scrollTop = containerEl.scrollTop;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TPS Finances" });
    containerEl.createEl("p", { text: "Bank credentials stay in the Controller’s SecretStorage when devices are paired." });

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

    if (route.id === "plaid") this.renderPlaidSettings(page);
    else if (route.id === "data") this.renderDataSettings(page);
    else if (route.id === "connections") this.renderConnectionSettings(page);
    else if (route.id === "properties") this.renderPropertySettings(page);
    else this.renderRulesSettings(page);

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
      this.propertyDraft = Object.fromEntries(FINANCE_PROPERTY_KEYS.map(key => [key, this.propertyBaseline!.key(key)]));
    }
    new Setting(parent).setName("Property names")
      .setDesc("Saving asks whether to rename existing properties. IDs stay fixed; atomic-line fields are unchanged.")
      .addButton(button => button.setButtonText("Save property names").setCta().onClick(async () => {
        button.setDisabled(true);
        try {
          const from = this.propertyBaseline!, to = new FinanceProperties({keys: this.propertyDraft!});
          to.assertIdentityKey((this.app as any).plugins?.plugins?.["tps-global-context-menu"]?.settings?.nativeRecordIdentityPropertyKey || "tpsId");
          if (!propertyChanges(from, to).length) { new Notice("No property names changed."); return; }
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
    for (const key of PROPERTY_GROUPS[this.propertyGroup]) {
      new Setting(parent).setName(propertyLabel(key)).addText(text => {
        text.setValue(this.propertyDraft![key]).onChange(value => { this.propertyDraft![key] = value.trim(); });
        text.inputEl.setAttribute("aria-label", `${propertyLabel(key)} property name`);
        text.inputEl.spellcheck = false;
      });
    }
  }

  private renderPlaidSettings(parent: HTMLElement): void {
    new Setting(parent).setName("Plaid connection · This device")
      .setDesc("TPS Controller owns the environment, credentials, and Plaid requests. Manage your institutions here under Connections.")
      .addButton(button => button.setButtonText("Open Controller settings").onClick(() => {
        const controller = (this.app as any).plugins?.plugins?.["tps-controller"]?.api;
        if (typeof controller?.openPlaidSettings === "function") { controller.openPlaidSettings(); return; }
        const settings = (this.app as any).setting;
        settings?.open(); settings?.openTabById("tps-controller");
      }));
  }

  private renderDataSettings(parent: HTMLElement): void {
    new Setting(parent).setName("Record format")
      .addDropdown(dropdown => dropdown.addOption("atomic-note", "Atomic note").addOption("atomic-line", "Atomic line")
        .setValue(this.plugin.settings.recordMode).onChange(async value => {
          try { await this.plugin.setRecordMode(value === "atomic-line" ? "atomic-line" : "atomic-note"); }
          catch (error) { new Notice(String(error)); }
          this.display();
        }));
    if (this.plugin.settings.recordMode === "atomic-note") {
      new Setting(parent).setName("Convert existing transactions")
        .setDesc("Save each ledger entry as a note, then replace the original line with a link. Unresolved entries remain in place.")
        .addButton(button => button.setButtonText("Convert to atomic notes").onClick(async () => {
          button.setDisabled(true);
          try { await this.plugin.migrateAtomicTransactions(); }
          catch (error) { new Notice(String(error)); }
          finally { button.setDisabled(false); }
        }));
    }

    new Setting(parent)
      .setName("Finance folder")
      .setDesc("Leave blank for the vault root, without subfolders. Existing notes stay where they are.")
      .addText((text) => text.setPlaceholder("Vault root").setValue(this.plugin.settings.financeFolder).onChange(async (value) => {
        try {
          await this.plugin.setFinanceFolder(value);
        } catch (error) { new Notice(String(error)); }
      }));

    new Setting(parent)
      .setName("Transaction history")
      .setDesc("Days requested when a new Item is connected (30–730).")
      .addText((text) => text.setValue(String(this.plugin.settings.transactionHistoryDays)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) this.plugin.settings.transactionHistoryDays = Math.max(30, Math.min(730, Math.round(parsed)));
        await this.plugin.saveSettings();
      }));

    if (this.plugin.settings.recordMode === "atomic-line") new Setting(parent)
      .setName("Default transaction location")
      .setDesc("Daily notes are the TPS default. Individual accounts can override this from their dashboard card.")
      .addDropdown((dropdown) => dropdown
        .addOption("daily-note", "Transaction date's daily note")
        .addOption("account-note", "The transaction's account note")
        .setValue(this.plugin.settings.transactionLogTarget)
        .onChange(async (value) => {
          await this.plugin.setDefaultTransactionLogTarget(value as TransactionLogTarget);
        }));
  }

  private renderConnectionSettings(parent: HTMLElement): void {
    const plaidSetup = this.plugin.getPlaidSetupStatus();
    const relay = this.plugin.getRelayStatus();
    if (relay) new Setting(parent).setName(relay.online ? "Controller connected" : "Waiting for Controller").setDesc(relay.message);

    new Setting(parent)
      .setName("Connect another institution")
      .setDesc(relay ? "Sign in through Plaid in your browser. The Controller saves the connection and imports your notes." : Platform.isDesktopApp && !Platform.isMobile
        ? "Opens Plaid Link in your browser through a temporary localhost callback."
        : "Connect or reconnect on desktop, then sync the finance notes with your vault. Manual accounts and transactions work here.")
      .addButton((button) => button
        .setButtonText("Connect with Plaid")
        .setCta()
        .setDisabled(!this.plugin.canConnectPlaid() || plaidSetup.state !== "ready")
        .onClick(async () => {
          await this.plugin.runConnectPlaid("settings");
          this.renderSettings(!relay);
        }));

    new Setting(parent)
      .setName("Sync now")
      .setDesc("Refresh accounts, transactions, investments, and snapshots. Paired devices send the request to the Controller.")
      .addButton((button) => button
        .setButtonText("Sync finances")
        .setDisabled(!relay && this.plugin.getConnectedItems().length === 0)
        .onClick(async () => {
          await this.plugin.runSync("settings");
          this.renderSettings(!relay);
        }));

    parent.createEl("h4", { text: relay ? "Shared connections" : "Connections on this device" });
    const items = this.plugin.getConnectedItems();
    if (!items.length) parent.createEl("p", { text: relay ? "No shared connections received yet." : "No Plaid Items are connected on this device.", cls: "setting-item-description" });
    for (const item of items) {
      new Setting(parent)
        .setName(item.institutionName)
        .setDesc(`${item.environment} · ${item.lastSyncAt ? `Last synced ${new Date(item.lastSyncAt).toLocaleString()}` : "Not synced yet"}`)
        .addButton((button) => button.setButtonText("Reconnect").setDisabled(!this.plugin.canConnectPlaid()).onClick(async () => {
          await this.plugin.runReconnectItem(item.localItemId);
          this.renderSettings(!relay);
        }))
        .addButton((button) => button.setButtonText("Disconnect").setWarning().onClick(() => {
          new DisconnectItemModal(this.app, item.institutionName, async () => {
            await this.plugin.disconnectItem(item.localItemId);
            this.renderSettings(true);
          }).open();
        }));
    }

    for (const operation of this.plugin.getRelayOperations().slice(-10).reverse()) {
      new Setting(parent).setName(`${operation.action[0].toUpperCase()}${operation.action.slice(1)} · ${operation.state}`)
        .setDesc(operation.message)
        .addButton(button=>button.setButtonText(operation.url ? "Continue sign-in" : "View request").onClick(()=>this.plugin.showFinanceRequest(operation.id)));
    }

    new Setting(parent)
      .setName("Debug logging")
      .setDesc("Log sync routes and aggregate results. Tokens, raw payloads, and transaction descriptions are never logged.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableLogging).onChange(async (value) => {
        this.plugin.settings.enableLogging = value;
        await this.plugin.saveSettings();
      }));
  }

  private renderRulesSettings(parent: HTMLElement): void {
    parent.createEl("p", {
      text: "Rules and budgets are ordinary notes. Use these shortcuts to create them, then manage the full collections from the dashboard or their Bases.",
      cls: "tps-finances-settings-callout",
    });

    new Setting(parent)
      .setName("Finance dashboard")
      .setDesc("Review accounts, recent transactions, rules, budgets, and sync status.")
      .addButton((button) => button.setButtonText("Open finances").setCta().onClick(() => void this.plugin.openDashboard()));

    new Setting(parent)
      .setName("Categorization rules")
      .setDesc("Create a rule for ordered account, name, merchant, amount, category, and tag matching.")
      .addButton((button) => button.setButtonText("Add rule").onClick(() => this.plugin.addCategorizationRule()));

    new Setting(parent)
      .setName("Monthly budgets")
      .setDesc("Plan income, fixed expenses, flexible spending, and savings contributions.")
      .addButton((button) => button.setButtonText("Open budget").onClick(() => void this.plugin.openDashboard("budget")))
      .addButton((button) => button.setButtonText("Add budget").onClick(() => this.plugin.addMonthlyBudget()));
  }
}

class DisconnectItemModal extends Modal {
  constructor(app: App, private readonly institution: string, private readonly confirm: () => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.titleEl.setText(`Disconnect ${this.institution}?`);
    this.contentEl.createEl("p", { text: "This removes the Plaid Item and its local access token. Existing Markdown account, ledger, and snapshot records remain in the vault." });
    const actions = this.contentEl.createDiv({ cls: "tps-finances-confirm-actions" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    new ButtonComponent(actions).setButtonText("Disconnect").setWarning().onClick(async () => {
      try {
        await this.confirm();
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error), 10000);
      }
    });
  }
}

function propertyLabel(key: string): string {
  if (key === "type") return "Record type";
  if (key === "kind") return "Record kind";
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
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
