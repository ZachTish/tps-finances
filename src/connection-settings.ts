import { App, ButtonComponent, Modal, Notice, Platform, Setting } from "obsidian";
import type TPSFinancesPlugin from "./main";

/** Mounted only in Controller. Existing operations and device state stay with their tested adapter. */
export class FinanceConnectionSettings {
  private disposed = false;
  constructor(private app: App, private plugin: TPSFinancesPlugin, private parent: HTMLElement) {}
  dispose(): void { this.disposed = true; }
  render(): void {
    const parent = this.parent;
    if (this.disposed) return;
    parent.empty();
    const plaidSetup = this.plugin.getPlaidSetupStatus();
    const relay = this.plugin.getRelayStatus();
    if (plaidSetup.state !== "ready") parent.createEl("p", { text: "Open Bank setup below to configure Plaid or pair this device with your Controller." });
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
          button.setDisabled(true);
          try { await this.plugin.runConnectPlaid("settings"); } finally { this.render(); }
        }));

    new Setting(parent)
      .setName("Sync now")
      .setDesc("Refresh accounts, transactions, investments, and snapshots. Paired devices send the request to the Controller.")
      .addButton((button) => button
        .setButtonText("Sync finances")
        .setDisabled(!relay && this.plugin.getConnectedItems().length === 0)
        .onClick(async () => {
          button.setDisabled(true);
          try { await this.plugin.runSync("settings"); } finally { this.render(); }
        }));

    new Setting(parent)
      .setName("Transaction history")
      .setDesc("Days requested when a new Item is connected (30–730).")
      .addText((text) => text.setValue(String(this.plugin.settings.transactionHistoryDays)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) this.plugin.settings.transactionHistoryDays = Math.max(30, Math.min(730, Math.round(parsed)));
        await this.plugin.saveSettings();
      }));

    parent.createEl("h4", { text: relay ? "Shared connections" : "Connections on this device" });
    const items = this.plugin.getConnectedItems();
    if (!items.length) parent.createEl("p", { text: relay ? "No shared connections received yet." : "No Plaid Items are connected on this device.", cls: "setting-item-description" });
    for (const item of items) {
      new Setting(parent)
        .setName(item.institutionName)
        .setDesc(`${item.environment} · ${item.lastSyncAt ? `Last synced ${new Date(item.lastSyncAt).toLocaleString()}` : "Not synced yet"}`)
        .addButton((button) => button.setButtonText("Reconnect").setDisabled(!this.plugin.canConnectPlaid()).onClick(async () => {
          button.setDisabled(true);
          try { await this.plugin.runReconnectItem(item.localItemId); } finally { this.render(); }
        }))
        .addButton((button) => button.setButtonText("Disconnect").setWarning().onClick(() => {
          new DisconnectItemModal(this.app, item.institutionName, async () => {
            await this.plugin.disconnectItem(item.localItemId);
            this.render();
          }).open();
        }));
    }

    for (const operation of this.plugin.getRelayOperations().slice(-10).reverse()) {
      new Setting(parent).setName(`${operation.action[0].toUpperCase()}${operation.action.slice(1)} · ${operation.state}`)
        .setDesc(operation.message)
        .addButton(button=>button.setButtonText(operation.url ? "Continue sign-in" : "View request").onClick(()=>this.plugin.showFinanceRequest(operation.id)));
    }

  }
}

class DisconnectItemModal extends Modal {
  private busy = false;
  constructor(app: App, private readonly institution: string, private readonly confirm: () => Promise<void>) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tps-keyboard-aware-modal");
    this.titleEl.setText(`Disconnect ${this.institution}?`);
    this.contentEl.createEl("p", { text: "This removes the Plaid Item and its local access token. Existing Markdown account, ledger, and snapshot records remain in the vault." });
    const actions = this.contentEl.createDiv({ cls: "tps-finances-confirm-actions" });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
    const disconnect = new ButtonComponent(actions).setButtonText("Disconnect").setWarning().onClick(async () => {
      if (this.busy) return;
      this.busy = true; disconnect.setDisabled(true);
      try {
        await this.confirm();
        this.close();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error), 10000);
      } finally { this.busy = false; disconnect.setDisabled(false); }
    });
  }
}
