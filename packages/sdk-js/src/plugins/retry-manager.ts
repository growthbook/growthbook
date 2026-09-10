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

export class RetryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly cause: unknown,
  ) {
    super(`Failed after ${attempts} attempt(s)`);
    this.name = "RetryExhaustedError";
  }
}

export class RetryCancelledError extends Error {
  constructor() {
    super("Retry cancelled");
    this.name = "RetryCancelledError";
  }
}

export type RetryConfig = BackoffConfig & {
  /** Return false to skip retrying (e.g. permanent 4xx). Default: always retry. */
  isRetriable?: (error: unknown) => boolean;
};

type RetryHandle<TArgs extends unknown[], TReturn> = {
  (...args: TArgs): Promise<TReturn>;
  cancel(): void;
  readonly attempts: number;
};

/**
 * Wraps an async function with exponential back-off retry logic.
 *
 * @example
 * const send = createRetry({ maxAttempts: 3 }, fetchData);
 * try {
 *   const result = await send(url);
 * } catch (e) {
 *   if (e instanceof RetryExhaustedError) { ... }
 * }
 */
export function createRetry<TArgs extends unknown[], TReturn>(
  config: RetryConfig,
  fn: (...args: TArgs) => Promise<TReturn>,
): RetryHandle<TArgs, TReturn> {
  const {
    baseDelayMs = 1_000,
    maxDelayMs = 30_000,
    maxAttempts = 5,
    jitterMs = 500,
    scheduler = (f, delay) => setTimeout(f, delay),
    random = () => Math.random(),
    isRetriable = () => true,
  } = config;

  let _attempts = 0;
  let _cancelFn: (() => void) | null = null;

  const run = async (...args: TArgs): Promise<TReturn> => {
    _attempts = 0;

    while (true) {
      // Only fn() is inside the try so that RetryCancelledError (thrown from
      // the sleep below) propagates directly out without being caught here.
      let caughtError: unknown;
      let didThrow = false;
      try {
        return await fn(...args);
      } catch (e) {
        caughtError = e;
        didThrow = true;
      }

      if (didThrow) {
        if (!isRetriable(caughtError)) throw caughtError;
        if (_attempts >= maxAttempts)
          throw new RetryExhaustedError(_attempts, caughtError);

        const delay = Math.min(
          baseDelayMs * Math.pow(2, _attempts) + random() * jitterMs,
          maxDelayMs,
        );
        _attempts++;

        // Awaiting outside the try/catch so a RetryCancelledError thrown here
        // propagates to the caller without being swallowed by our retry logic.
        await new Promise<void>((resolve, reject) => {
          const id = scheduler(resolve, delay);
          _cancelFn = () => {
            clearTimeout(id);
            _cancelFn = null;
            reject(new RetryCancelledError());
          };
        });
        _cancelFn = null;
      }
    }
  };

  const handle = run as RetryHandle<TArgs, TReturn>;
  handle.cancel = () => _cancelFn?.();
  Object.defineProperty(handle, "attempts", { get: () => _attempts });

  return handle;
}
