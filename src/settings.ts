import { App, ButtonComponent, Modal, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type TPSFinancesPlugin from "./main";
import type { PlaidEnvironment, TransactionLogTarget } from "./types";

type FinanceSettingsRoute = "plaid" | "data" | "connections" | "rules";

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
];

export class TPSFinancesSettingTab extends PluginSettingTab {
  private activeRoute: FinanceSettingsRoute = "plaid";

  constructor(app: App, private readonly plugin: TPSFinancesPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.renderSettings();
  }

  private renderSettings(focusRouteHeading = false, focusControlName?: string): void {
    const { containerEl } = this;
    const scrollTop = containerEl.scrollTop;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TPS Finances" });
    containerEl.createEl("p", { text: "Plaid credentials and connected Item tokens are stored in this device's Obsidian SecretStorage. They are not saved in plugin data or Markdown." });

    const hub = containerEl.createDiv({ cls: "tps-finances-settings-hub" });
    hub.createEl("h3", { text: "Choose what to configure" });
    hub.createEl("p", {
      text: "Pick one destination. Finance data and connection state stay unchanged when you move between pages.",
      cls: "setting-item-description",
    });
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
          "aria-label": `${route.title}: ${route.description}`,
        },
      });
      if (isActive) activeRouteButton = button;
      button.createSpan({ cls: "tps-finances-settings-route-title", text: route.title });
      button.createSpan({ cls: "tps-finances-settings-route-description", text: route.description });
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
    page.createEl("p", {
      text: route.description,
      cls: "setting-item-description tps-finances-settings-page-description",
    });

    if (route.id === "plaid") this.renderPlaidSettings(page);
    else if (route.id === "data") this.renderDataSettings(page);
    else if (route.id === "connections") this.renderConnectionSettings(page);
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

  private renderPlaidSettings(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Plaid environment")
      .setDesc("Start in Sandbox. Production uses real financial data and may incur Plaid subscription charges.")
      .addDropdown((dropdown) => dropdown
        .addOption("sandbox", "Sandbox")
        .addOption("development", "Development")
        .addOption("production", "Production")
        .setValue(this.plugin.settings.plaidEnvironment)
        .onChange(async (value) => {
          this.plugin.settings.plaidEnvironment = value as PlaidEnvironment;
          await this.plugin.saveSettings();
        }));

    new Setting(parent)
      .setName("Plaid client ID")
      .setDesc("Select or create a device-local Obsidian secret containing the Plaid client ID.")
      .addComponent((element) => new SecretComponent(this.app, element)
        .setValue(this.plugin.settings.plaidClientIdSecret)
        .onChange(async (value) => {
          this.plugin.settings.plaidClientIdSecret = value;
          await this.plugin.saveSettings();
          this.renderSettings(false, "Plaid client ID");
        }));

    new Setting(parent)
      .setName("Plaid secret")
      .setDesc("Select or create a device-local Obsidian secret for the active Plaid environment.")
      .addComponent((element) => new SecretComponent(this.app, element)
        .setValue(this.plugin.settings.plaidSecretSecret)
        .onChange(async (value) => {
          this.plugin.settings.plaidSecretSecret = value;
          await this.plugin.saveSettings();
          this.renderSettings(false, "Plaid secret");
        }));

    const plaidSetup = this.plugin.getPlaidSetupStatus();
    const setupDescription = plaidSetup.state === "conflicting-credentials"
      ? "Needs attention: the client ID and environment secret currently resolve to the same secret. Select or create two different Obsidian secrets above."
      : plaidSetup.state === "missing-credentials"
        ? `Missing ${[!plaidSetup.clientIdConfigured ? "client ID" : "", !plaidSetup.secretConfigured ? "environment secret" : ""].filter(Boolean).join(" and ")}. Populate both secret selections before connecting.`
        : plaidSetup.connectedItems
          ? `Credentials are configured and ${plaidSetup.connectedItems} Plaid institution${plaidSetup.connectedItems === 1 ? " is" : "s are"} connected on this device.`
          : "Credentials are configured. Connect an institution to begin syncing finance data.";
    new Setting(parent)
      .setName("Plaid setup status")
      .setDesc(setupDescription);

    new Setting(parent)
      .setName("OAuth redirect URI")
      .setDesc("Optional HTTPS redirect URI registered in Plaid. Desktop popup OAuth can work without it; configure this when an institution requires it.")
      .addText((text) => text.setPlaceholder("https://…").setValue(this.plugin.settings.oauthRedirectUri).onChange(async (value) => {
        this.plugin.settings.oauthRedirectUri = value.trim();
        await this.plugin.saveSettings();
      }));
  }

  private renderDataSettings(parent: HTMLElement): void {
    new Setting(parent)
      .setName("Finance folder")
      .setDesc("Account entities, categorization rules, budgets, and dated snapshots. Transactions are written to daily notes.")
      .addText((text) => text.setValue(this.plugin.settings.financeFolder).onChange(async (value) => {
        this.plugin.settings.financeFolder = value.trim() || "Finances";
        await this.plugin.saveSettings();
      }));

    new Setting(parent)
      .setName("Transaction history")
      .setDesc("Days requested when a new Item is connected (30–730).")
      .addText((text) => text.setValue(String(this.plugin.settings.transactionHistoryDays)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) this.plugin.settings.transactionHistoryDays = Math.max(30, Math.min(730, Math.round(parsed)));
        await this.plugin.saveSettings();
      }));

    new Setting(parent)
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

    new Setting(parent)
      .setName("Connect another institution")
      .setDesc("Opens Plaid Link in your browser through a temporary localhost callback.")
      .addButton((button) => button
        .setButtonText("Connect with Plaid")
        .setCta()
        .setDisabled(plaidSetup.state !== "ready")
        .onClick(async () => {
          await this.plugin.runConnectPlaid("settings");
          this.renderSettings(true);
        }));

    new Setting(parent)
      .setName("Sync now")
      .setDesc("Refresh accounts, transactions, investments, and snapshots for every connection on this device.")
      .addButton((button) => button
        .setButtonText("Sync finances")
        .setDisabled(this.plugin.getConnectedItems().length === 0)
        .onClick(async () => {
          await this.plugin.runSync("settings");
          this.renderSettings(true);
        }));

    parent.createEl("h4", { text: "Connections on this device" });
    const items = this.plugin.getConnectedItems();
    if (!items.length) parent.createEl("p", { text: "No Plaid Items are connected on this device.", cls: "setting-item-description" });
    for (const item of items) {
      new Setting(parent)
        .setName(item.institutionName)
        .setDesc(`${item.environment} · ${item.lastSyncAt ? `Last synced ${new Date(item.lastSyncAt).toLocaleString()}` : "Not synced yet"}`)
        .addButton((button) => button.setButtonText("Disconnect").setWarning().onClick(() => {
          new DisconnectItemModal(this.app, item.institutionName, async () => {
            await this.plugin.disconnectItem(item.localItemId);
            this.renderSettings(true);
          }).open();
        }));
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
      .setDesc("Create a monthly spending target for a category.")
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
