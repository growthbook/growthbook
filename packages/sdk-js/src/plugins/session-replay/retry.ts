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

export type RetryConfig = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  jitterMs?: number;
  scheduler?: (
    fn: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  random?: () => number;
  // Return false to skip retrying (e.g. permanent 4xx). Default: always retry.
  isRetriable?: (error: unknown) => boolean;
};

type RetryHandle<TArgs extends unknown[], TReturn> = {
  (...args: TArgs): Promise<TReturn>;
  cancel(): void;
  readonly attempts: number;
};

// Wraps an async function with exponential back-off retry logic; throws
// RetryExhaustedError / RetryCancelledError so callers can tell outcomes apart.
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
  handle.cancel = () => {
    if (_cancelFn) _cancelFn();
  };
  Object.defineProperty(handle, "attempts", { get: () => _attempts });

  return handle;
}
