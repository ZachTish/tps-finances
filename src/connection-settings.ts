import { App } from 'obsidian';
import type TPSFinancesPlugin from './main';

/** Read-only compatibility surface for existing settings handoffs. */
export class FinanceConnectionSettings {
  constructor(_app: App, _plugin: TPSFinancesPlugin, private parent: HTMLElement) {}
  dispose(): void {}
  render(): void {
    this.parent.empty();
    this.parent.createEl('p', { text: 'Bank and Wallet importing are retired in this plugin. Configure imports in TishOS. Existing connections, mappings and notes are unchanged.' });
  }
}
