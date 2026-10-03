import { App, TFile } from "obsidian";
import { financeProperties, type FinanceProperties } from "./finance-properties";

type FileCache = ReturnType<App["metadataCache"]["getFileCache"]>;
type Fields = ReturnType<FinanceProperties["read"]>;

/** One read-only dashboard model owns this list and its decoded metadata. */
export class DashboardFileSnapshot {
  readonly files: TFile[];
  readonly properties: FinanceProperties;
  private readonly caches = new Map<TFile, FileCache>();
  private readonly decoded = new Map<TFile, Fields>();

  constructor(private readonly app: App) {
    this.properties = financeProperties(app);
    this.files = app.vault.getMarkdownFiles();
  }

  cache(file: TFile): FileCache {
    if (!this.caches.has(file)) this.caches.set(file, this.app.metadataCache.getFileCache(file));
    return this.caches.get(file) ?? null;
  }

  fields(file: TFile): Fields {
    if (!this.decoded.has(file)) this.decoded.set(file, this.properties.read(this.cache(file)?.frontmatter || {}));
    return this.decoded.get(file)!;
  }
}
