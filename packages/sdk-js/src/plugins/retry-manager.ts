export type BackoffConfig = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  jitterMs?: number;
  scheduler?: (
    fn: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  random?: () => number;
};

/**
 * Creates an exponential back-off handler for retriable failures.
 *
 * @example
 * const backoff = createBackoff({ baseDelayMs: 1000, maxAttempts: 3 });
 *
 * async function fetchWithRetry() {
 *   try {
 *     await fetch("/api");
 *     backoff.reset();
 *   } catch (e) {
 *     const delay = backoff.scheduleRetry(fetchWithRetry);
 *     if (delay === null) console.error("giving up after", backoff.attempts, "attempts");
 *     else console.warn("retrying in", delay, "ms");
 *   }
 * }
 */
export function createBackoff(config: BackoffConfig = {}) {
  const {
    baseDelayMs = 1_000,
    maxDelayMs = 30_000,
    maxAttempts = 5,
    jitterMs = 500,
    scheduler = (fn, delay) => setTimeout(fn, delay),
    random = () => Math.random(),
  } = config;

  let _attempts = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return {
    get attempts(): number {
      return _attempts;
    },

    get isExhausted(): boolean {
      return _attempts >= maxAttempts;
    },

    scheduleRetry(fn: () => void): number | null {
      if (_attempts >= maxAttempts) return null;
      const delay = Math.min(
        baseDelayMs * Math.pow(2, _attempts) + random() * jitterMs,
        maxDelayMs,
      );
      _attempts++;
      timeoutId = scheduler(fn, delay);
      return delay;
    },

    reset(): void {
      _attempts = 0;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },

    cancel(): void {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}

export type Backoff = ReturnType<typeof createBackoff>;
