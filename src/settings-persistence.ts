type SettingsRecord = Record<string, unknown>;

type SaveRequest<T extends object> = {
  snapshot: T;
  intentKeys: Set<string>;
};

type SaveCycle = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export type CoalescedSnapshotWriterOptions<T extends object> = {
  initialSnapshot: T;
  readLatest: () => Promise<unknown>;
  writeMerged: (value: SettingsRecord) => Promise<void>;
  normalize: (value: unknown) => T;
  reconcile: (requested: T, persisted: T) => void;
  clone?: (value: T) => T;
};

/**
 * Serializes settings writes while merging only this instance's top-level
 * changes into the latest copy on disk. Every save in one drain cycle shares
 * a promise, so handlers cannot finish while a newer coalesced request is
 * still pending.
 */
export class CoalescedSnapshotWriter<T extends object> {
  private baseline: T;
  private pendingRequest: SaveRequest<T> | null = null;
  private activeRequest: SaveRequest<T> | null = null;
  private cycle: SaveCycle | null = null;
  private running = false;
  private readonly clone: (value: T) => T;

  constructor(private readonly options: CoalescedSnapshotWriterOptions<T>) {
    this.clone = options.clone ?? cloneJsonSnapshot;
    this.baseline = this.clone(options.initialSnapshot);
  }

  save(value: T): Promise<void> {
    const snapshot = this.clone(value);
    const priorDesired = this.pendingRequest ?? this.activeRequest;
    const intentKeys = changedTopLevelKeys(this.baseline, snapshot);

    // Comparing with the prior requested state retains an explicit revert
    // (old -> new -> old) even though the final value equals the baseline.
    if (priorDesired) {
      for (const key of priorDesired.intentKeys) intentKeys.add(key);
      for (const key of changedTopLevelKeys(priorDesired.snapshot, snapshot)) {
        intentKeys.add(key);
      }
    }

    this.pendingRequest = { snapshot, intentKeys };
    if (!this.cycle) this.cycle = createSaveCycle();
    if (!this.running) {
      this.running = true;
      void this.drain();
    }
    return this.cycle.promise;
  }

  private async drain(): Promise<void> {
    let terminalError: unknown;
    let failed = false;
    try {
      // Publish the shared cycle promise before any synchronous dependency can
      // fail, then keep a microtask-sized completion window for late callers.
      await Promise.resolve();
      while (true) {
        if (!this.pendingRequest) {
          await Promise.resolve();
          if (!this.pendingRequest) break;
        }

        const request = this.pendingRequest;
        this.pendingRequest = null;
        this.activeRequest = request;
        try {
          await this.persist(request);
        } catch (error) {
          // A request queued as the failed write settles is allowed to
          // supersede it. Otherwise every caller in this cycle sees failure.
          await Promise.resolve();
          if (!this.pendingRequest) {
            terminalError = error;
            failed = true;
            break;
          }
        } finally {
          this.activeRequest = null;
        }
      }
    } catch (error) {
      terminalError = error;
      failed = true;
    }

    const cycle = this.cycle;
    this.cycle = null;
    this.running = false;
    if (!cycle) return;
    if (failed) cycle.reject(terminalError);
    else cycle.resolve();
  }

  private async persist(request: SaveRequest<T>): Promise<void> {
    const latestRaw = settingsRecord(await this.options.readLatest());
    const mergedRaw: SettingsRecord = cloneJsonSnapshot(latestRaw);
    const requestedRecord = request.snapshot as SettingsRecord;

    for (const key of request.intentKeys) {
      if (Object.prototype.hasOwnProperty.call(requestedRecord, key)) {
        mergedRaw[key] = cloneJsonValue(requestedRecord[key]);
      } else {
        delete mergedRaw[key];
      }
    }

    if (request.intentKeys.size > 0) await this.options.writeMerged(mergedRaw);
    const persisted = this.options.normalize(mergedRaw);
    this.baseline = this.clone(persisted);
    this.rebasePendingSnapshot(request.snapshot, persisted);
    this.options.reconcile(request.snapshot, persisted);
  }

  private rebasePendingSnapshot(requested: T, persisted: T): void {
    if (!this.pendingRequest) return;
    const pendingRecord = this.pendingRequest.snapshot as SettingsRecord;
    const requestedRecord = requested as SettingsRecord;
    const persistedRecord = persisted as SettingsRecord;
    for (const key of Object.keys(persistedRecord)) {
      if (
        !this.pendingRequest.intentKeys.has(key)
        && jsonEqual(pendingRecord[key], requestedRecord[key])
      ) {
        pendingRecord[key] = cloneJsonValue(persistedRecord[key]);
      }
    }
  }
}

export function changedTopLevelKeys(left: object, right: object): Set<string> {
  const leftRecord = left as SettingsRecord;
  const rightRecord = right as SettingsRecord;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  return new Set([...keys].filter((key) => !jsonEqual(leftRecord[key], rightRecord[key])));
}

export function reconcilePersistedSnapshot<T extends object>(
  current: T,
  requested: T,
  persisted: T,
): T {
  const reconciled = cloneJsonSnapshot(current);
  const currentRecord = current as SettingsRecord;
  const requestedRecord = requested as SettingsRecord;
  const persistedRecord = persisted as SettingsRecord;
  const reconciledRecord = reconciled as SettingsRecord;
  for (const key of Object.keys(persistedRecord)) {
    // Preserve a local edit made after this request. Values that still match
    // its snapshot are safe to replace with externally updated persisted data.
    if (jsonEqual(currentRecord[key], requestedRecord[key])) {
      reconciledRecord[key] = cloneJsonValue(persistedRecord[key]);
    }
  }
  return reconciled;
}

export function cloneJsonSnapshot<T>(value: T): T {
  return cloneJsonValue(value) as T;
}

function settingsRecord(value: unknown): SettingsRecord {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TPS Finances settings data is not an object; refusing to overwrite it.");
  }
  return value as SettingsRecord;
}

function cloneJsonValue(value: unknown): any {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function createSaveCycle(): SaveCycle {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
