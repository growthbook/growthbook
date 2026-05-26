const YIELD_INTERVAL = 100;

/** Yields the event loop every N iterations to avoid starving other requests. */
export async function yieldEventLoop(i: number): Promise<void> {
  if (i > 0 && i % YIELD_INTERVAL === 0) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
