/** Stop scheduling after a failure, but drain started work before the caller can retry. */
export async function boundedWork<T>(items: readonly T[], action: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try {
        await action(item);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };
  // Bound filesystem pressure and event bursts on both desktop and mobile.
  await Promise.all(Array.from({ length: Math.min(16, items.length) }, worker));
  if (failed) throw failure;
}
