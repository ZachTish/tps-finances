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

  constructor(private readonly app: App, private readonly sourcePaths?: Set<string>) {
    this.properties = financeProperties(app);
    this.files = app.vault.getMarkdownFiles();
  }

  includeSource(file: TFile): void {
    this.sourcePaths?.add(file.path);
  }

  cache(file: TFile): FileCache {
    try {
      if (!this.caches.has(file)) this.caches.set(file, this.app.metadataCache.getFileCache(file));
      return this.caches.get(file) ?? null;
    } catch (error) {
      this.includeSource(file);
      throw error;
    }
  }

  fields(file: TFile): Fields {
    try {
      if (!this.decoded.has(file)) this.decoded.set(file, this.properties.read(this.cache(file)?.frontmatter || {}));
      return this.decoded.get(file)!;
    } catch (error) {
      this.includeSource(file);
      throw error;
    }
  }
}
