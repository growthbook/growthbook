/**
 * A lazily-loaded snapshot of an expensive async fetch. `get()` loads once and
 * returns the same in-flight/resolved promise to every caller until
 * `invalidate()` is called (e.g. after a write changes the underlying data).
 *
 * Lets a hot path that reads the same collection many times within one request
 * share a single fetch instead of re-querying. A rejected load is not cached,
 * so a later `get()` retries.
 */
export type AsyncSnapshot<T> = {
  get(): Promise<T>;
  invalidate(): void;
};

export function createAsyncSnapshot<T>(
  load: () => Promise<T>,
): AsyncSnapshot<T> {
  let cached: Promise<T> | null = null;
  return {
    get() {
      if (cached === null) {
        cached = load().catch((err) => {
          cached = null;
          throw err;
        });
      }
      return cached;
    },
    invalidate() {
      cached = null;
    },
  };
}
