import { validHostedLink } from "./hosted-link";
import { App, Modal, Notice } from 'obsidian';
/** Versioned Controller API. Secret values and provider identifiers never cross it to a client. */
export interface RelayItem {
    localItemId: string;
    institutionName: string;
    environment: string;
    lastSyncAt: string;
}
export interface LinkSession {
    linkToken: string;
    url: string;
    expiresAt: number;
    environment: string;
    clientRef: string;
    secretRef: string;
    itemId?: string;
}
export interface LinkResult {
    state: 'waiting' | 'complete' | 'cancelled';
    publicToken?: string;
    institutionName?: string;
}
export interface RelayOperation {
    id: string;
    state: string;
    message: string;
    action: string;
    url?: string;
    expiresAt: number;
}
export interface RelayStatus {
    configured: boolean;
    mode?: 'host' | 'client';
    enabled: boolean;
    online: boolean;
    message: string;
    lastSyncAt: number;
    updatedAt: number;
    items: RelayItem[];
}
export interface FinanceRelay {
    version: 1;
    getConfiguration(): {
        mode: 'host' | 'client';
        enabled: boolean;
    } | null;
    getStatus(): RelayStatus;
    getOperations(): RelayOperation[];
    request(action: 'connect' | 'reconnect' | 'sync' | 'disconnect', itemId?: string): Promise<string>;
    tick(): Promise<void>;
}
export function getFinanceRelay(app: App): FinanceRelay | null {
    const api = (app as any).plugins?.plugins?.['tps-controller']?.api?.financeRelay;
    if (api?.version === 1 && api.getConfiguration())
        return api;
    // A disabled or unloaded Controller must never make a paired client import independently.
    if (app.loadLocalStorage?.('tps-finance-relay-v1'))
        throw new Error('Enable TPS Controller 1.4.0+ to use this device’s shared finance connection.');
    return null;
}
/** Closing this view never cancels a durable request or discards its sign-in URL. */
export class FinanceRequestModal extends Modal {
    private timer: number | null = null;
    private message!: HTMLElement;
    private openButton!: HTMLButtonElement;
    private lastState = '';
    private returnFocus: HTMLElement | null = null;
    constructor(app: App, private relay: FinanceRelay, private id: string, private onUpdate: () => void) { super(app); }
    onOpen(): void {
        this.returnFocus = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
        this.titleEl.setText('Finance connection');
        this.contentEl.addClass('tps-finances-relay-modal');
        this.message = this.contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
        this.openButton = this.contentEl.createEl('button', { text: 'Open bank sign-in', cls: 'mod-cta', attr: { type: 'button' } });
        this.openButton.addEventListener('click', () => {
            const op = this.relay.getOperations().find(op => op.id === this.id);
            if (!op?.url || !validHostedLink(op.url)) {
                new Notice('Bank sign-in is not ready yet.');
                return;
            }
            window.open(op.url, '_blank', 'noopener,noreferrer');
        });
        const refresh = this.contentEl.createEl('button', { text: 'Check status', attr: { type: 'button' } });
        refresh.addEventListener('click', async () => { refresh.disabled = true; try {
            await this.relay.tick();
            this.update();
        }
        finally {
            refresh.disabled = false;
        } });
        this.update();
        this.timer = window.setInterval(() => this.update(), 1000);
    }
    private update(): void {
        const operation = this.relay.getOperations().find(op => op.id === this.id);
        this.message.setText(operation?.message || 'Waiting for the Controller and vault sync. You can close this window and return from Connections.');
        this.openButton.hidden = !operation?.url || !validHostedLink(operation.url);
        if (operation?.state !== this.lastState) {
            this.lastState = operation?.state || '';
            this.onUpdate();
        }
    }
    onClose(): void {
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
        const document = this.contentEl.ownerDocument;
        this.contentEl.empty();
        requestAnimationFrame(() => {
            const target = this.returnFocus?.isConnected ? this.returnFocus : document.querySelector<HTMLElement>('.tps-finances-settings-page h3');
            target?.focus({preventScroll:true});
        });
    }
}
