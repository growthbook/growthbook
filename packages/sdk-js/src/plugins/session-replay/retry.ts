export class RetryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly cause: unknown,
  ) {
    super(`Failed after ${attempts} retries`);
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

  let attempts = 0;
  let cancelFn: (() => void) | null = null;

  const run = async (...args: TArgs): Promise<TReturn> => {
    attempts = 0;

    while (true) {
      // Only fn() is inside the try: a RetryCancelledError from the sleep
      // below must reach the caller, not this catch
      let caughtError: unknown;
      try {
        return await fn(...args);
      } catch (e) {
        caughtError = e;
      }

      if (!isRetriable(caughtError)) throw caughtError;
      if (attempts >= maxAttempts)
        throw new RetryExhaustedError(attempts, caughtError);

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempts) + random() * jitterMs,
        maxDelayMs,
      );
      attempts++;

      await new Promise<void>((resolve, reject) => {
        const id = scheduler(resolve, delay);
        cancelFn = () => {
          clearTimeout(id);
          cancelFn = null;
          reject(new RetryCancelledError());
        };
      });
      cancelFn = null;
    }
  };

  const handle = run as RetryHandle<TArgs, TReturn>;
  handle.cancel = () => {
    if (cancelFn) cancelFn();
  };
  Object.defineProperty(handle, "attempts", { get: () => attempts });

  return handle;
}
