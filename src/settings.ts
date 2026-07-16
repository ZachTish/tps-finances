import { App, ButtonComponent, Modal, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type TPSFinancesPlugin from "./main";
import type { PlaidEnvironment, TransactionLogTarget } from "./types";

export class TPSFinancesSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TPSFinancesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TPS Finances" });
    containerEl.createEl("p", { text: "Plaid credentials and connected Item tokens are stored in this device's Obsidian SecretStorage. They are not saved in plugin data or Markdown." });

    new Setting(containerEl)
      .setName("Finance folder")
      .setDesc("Account entities, categorization rules, budgets, and dated snapshots. Transactions are written to daily notes.")
      .addText((text) => text.setValue(this.plugin.settings.financeFolder).onChange(async (value) => {
        this.plugin.settings.financeFolder = value.trim() || "Finances";
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Plaid client ID")
      .setDesc("Select or create a device-local Obsidian secret containing the Plaid client ID.")
      .addComponent((element) => new SecretComponent(this.app, element)
        .setValue(this.plugin.settings.plaidClientIdSecret)
        .onChange(async (value) => {
          this.plugin.settings.plaidClientIdSecret = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName("Plaid secret")
      .setDesc("Select or create a device-local Obsidian secret for the active Plaid environment.")
      .addComponent((element) => new SecretComponent(this.app, element)
        .setValue(this.plugin.settings.plaidSecretSecret)
        .onChange(async (value) => {
          this.plugin.settings.plaidSecretSecret = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    const plaidSetup = this.plugin.getPlaidSetupStatus();
    const setupDescription = plaidSetup.state === "conflicting-credentials"
      ? "Needs attention: the client ID and environment secret currently resolve to the same secret. Select or create two different Obsidian secrets above."
      : plaidSetup.state === "missing-credentials"
        ? `Missing ${[!plaidSetup.clientIdConfigured ? "client ID" : "", !plaidSetup.secretConfigured ? "environment secret" : ""].filter(Boolean).join(" and ")}. Populate both secret selections before connecting.`
        : plaidSetup.connectedItems
          ? `Credentials are configured and ${plaidSetup.connectedItems} Plaid institution${plaidSetup.connectedItems === 1 ? " is" : "s are"} connected on this device.`
          : "Credentials are configured. Connect an institution to begin syncing finance data.";
    new Setting(containerEl)
      .setName("Plaid setup status")
      .setDesc(setupDescription);

    new Setting(containerEl)
      .setName("OAuth redirect URI")
      .setDesc("Optional HTTPS redirect URI registered in Plaid. Desktop popup OAuth can work without it; configure this when an institution requires it.")
      .addText((text) => text.setPlaceholder("https://…").setValue(this.plugin.settings.oauthRedirectUri).onChange(async (value) => {
        this.plugin.settings.oauthRedirectUri = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Transaction history")
      .setDesc("Days requested when a new Item is connected (30–730).")
      .addText((text) => text.setValue(String(this.plugin.settings.transactionHistoryDays)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) this.plugin.settings.transactionHistoryDays = Math.max(30, Math.min(730, Math.round(parsed)));
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Default transaction location")
      .setDesc("Daily notes are the TPS default. Individual accounts can override this from their dashboard card.")
      .addDropdown((dropdown) => dropdown
        .addOption("daily-note", "Transaction date's daily note")
        .addOption("account-note", "The transaction's account note")
        .setValue(this.plugin.settings.transactionLogTarget)
        .onChange(async (value) => {
          await this.plugin.setDefaultTransactionLogTarget(value as TransactionLogTarget);
        }));

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Log sync routes and aggregate results. Tokens, raw payloads, and transaction descriptions are never logged.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.enableLogging).onChange(async (value) => {
        this.plugin.settings.enableLogging = value;
        await this.plugin.saveSettings();
      }));

    containerEl.createEl("h3", { text: "Connections on this device" });
    const items = this.plugin.getConnectedItems();
    if (!items.length) containerEl.createEl("p", { text: "No Plaid Items are connected on this device." });
    for (const item of items) {
      new Setting(containerEl)
        .setName(item.institutionName)
        .setDesc(`${item.environment} · ${item.lastSyncAt ? `Last synced ${new Date(item.lastSyncAt).toLocaleString()}` : "Not synced yet"}`)
        .addButton((button) => button.setButtonText("Disconnect").setWarning().onClick(() => {
          new DisconnectItemModal(this.app, item.institutionName, async () => {
            await this.plugin.disconnectItem(item.localItemId);
            this.display();
          }).open();
        }));
    }

    new Setting(containerEl)
      .setName("Connect another institution")
      .setDesc("Opens Plaid Link in your browser through a temporary localhost callback.")
      .addButton((button) => button
        .setButtonText("Connect with Plaid")
        .setCta()
        .setDisabled(plaidSetup.state !== "ready")
        .onClick(() => this.plugin.runConnectPlaid("settings")));
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
