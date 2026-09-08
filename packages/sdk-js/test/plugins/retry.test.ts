import {
  createRetry,
  RetryExhaustedError,
  RetryCancelledError,
  RetryConfig,
} from "../../src/plugins/session-replay/retry";

// Shared config shorthand: zero jitter makes delay assertions exact.
const noJitter: Pick<RetryConfig, "random"> = { random: () => 0 };

// Scheduler that fires synchronously — used for tests that care about
// behavior (success/failure paths) but not about delay timing.
function immediateScheduler(fn: () => void, _delay: number) {
  fn();
  return 0 as unknown as ReturnType<typeof setTimeout>;
}

// Scheduler that stores pending timers so the test can fire them manually.
function createDeferredScheduler() {
  const pending: Array<{ fn: () => void; delay: number }> = [];
  const scheduler = jest.fn(
    (fn: () => void, delay: number): ReturnType<typeof setTimeout> => {
      pending.push({ fn, delay });
      return pending.length as unknown as ReturnType<typeof setTimeout>;
    },
  );
  const runNext = () => pending.shift()?.fn();
  return { scheduler, pending, runNext };
}

// Scheduler that fires the callback immediately AND records the delay.
// Use for tests that need to verify delay values without pausing mid-flight.
function createCapturingScheduler() {
  const delays: number[] = [];
  const scheduler = (
    fn: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout> => {
    delays.push(delay);
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  };
  return { scheduler, delays };
}

// Drains all pending microtasks. setTimeout(0) is a macrotask that fires after
// all microtasks (including multiple promise-chain levels from ts-jest's
// async→generator transform) have drained.
const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createRetry", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves with fn return value on first-attempt success", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const retry = createRetry({ scheduler: immediateScheduler }, fn);

    await expect(retry()).resolves.toBe("ok");
  });

  it("passes arguments through to fn", async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    const retry = createRetry<[string, number], void>(
      { scheduler: immediateScheduler },
      fn,
    );

    await retry("hello", 42);
    expect(fn).toHaveBeenCalledWith("hello", 42);
  });

  it("retries fn with the same args after a retriable failure", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("ok");
    const retry = createRetry(
      { scheduler: immediateScheduler, ...noJitter },
      fn,
    );

    await expect(retry("arg")).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(2, "arg");
  });

  it("does not retry when isRetriable returns false", async () => {
    const err = new Error("permanent");
    const fn = jest.fn().mockRejectedValue(err);
    const retry = createRetry(
      { scheduler: immediateScheduler, isRetriable: () => false },
      fn,
    );

    await expect(retry()).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws RetryExhaustedError after maxAttempts retriable failures", async () => {
    const cause = new Error("transient");
    const fn = jest.fn().mockRejectedValue(cause);
    const retry = createRetry(
      { scheduler: immediateScheduler, ...noJitter, maxAttempts: 3 },
      fn,
    );

    const err = await retry().catch((e) => e);
    expect(err).toBeInstanceOf(RetryExhaustedError);
    expect((err as RetryExhaustedError).attempts).toBe(3);
    expect((err as RetryExhaustedError).cause).toBe(cause);
    // 1 original + 3 retries = 4 total calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("uses exponential backoff delays between retries", async () => {
    // Use a capturing scheduler that fires immediately — lets the retry run
    // end-to-end so we can assert the recorded delays after completion.
    const { scheduler, delays } = createCapturingScheduler();

    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockRejectedValueOnce(new Error())
      .mockResolvedValue(undefined);
    const retry = createRetry(
      { scheduler, ...noJitter, baseDelayMs: 1000 },
      fn,
    );

    await retry();

    expect(delays).toEqual([1000, 2000]); // 1000*2^0, 1000*2^1
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("caps delay at maxDelayMs", async () => {
    const { scheduler, delays } = createCapturingScheduler();

    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValue(undefined);
    const retry = createRetry(
      { scheduler, ...noJitter, baseDelayMs: 1000, maxDelayMs: 500 },
      fn,
    );

    await retry();
    expect(delays).toEqual([500]); // 1000 would exceed 500 cap
  });

  it("adds jitter to the delay", async () => {
    const { scheduler, delays } = createCapturingScheduler();

    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValue(undefined);
    const retry = createRetry(
      { scheduler, random: () => 1, baseDelayMs: 1000, jitterMs: 200 },
      fn,
    );

    await retry();
    expect(delays).toEqual([1200]); // 1000 + 1 * 200
  });

  it("resets attempt count at the start of each call", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValue(undefined);
    const retry = createRetry(
      { scheduler: immediateScheduler, ...noJitter, maxAttempts: 1 },
      fn,
    );

    await retry(); // uses 1 retry

    // Second call: attempts resets — fn succeeds on first try
    fn.mockResolvedValue(undefined);
    await expect(retry()).resolves.toBeUndefined();
  });

  describe("cancel", () => {
    it("rejects with RetryCancelledError when called during a retry delay", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("transient"));
      const { scheduler } = createDeferredScheduler();
      const retry = createRetry({ scheduler, ...noJitter }, fn);

      const promise = retry();
      // flushPromises uses setImmediate which drains all microtask levels —
      // reliable even with ts-jest's async→generator transform.
      await flushPromises();
      retry.cancel();

      await expect(promise).rejects.toBeInstanceOf(RetryCancelledError);
    });

    it("is a no-op when no retry is pending", async () => {
      const retry = createRetry(
        { scheduler: immediateScheduler },
        jest.fn().mockResolvedValue(undefined),
      );
      expect(() => retry.cancel()).not.toThrow();
    });

    it("does not fire clearTimeout when nothing is pending", () => {
      const clearSpy = jest.spyOn(global, "clearTimeout");
      const retry = createRetry(
        { scheduler: immediateScheduler },
        jest.fn().mockResolvedValue(undefined),
      );
      retry.cancel();
      expect(clearSpy).not.toHaveBeenCalled();
    });
  });

  describe("attempts property", () => {
    it("reflects 0 before any call", () => {
      const retry = createRetry(
        { scheduler: immediateScheduler },
        jest.fn().mockResolvedValue(undefined),
      );
      expect(retry.attempts).toBe(0);
    });

    it("increments with each retry", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error())
        .mockRejectedValueOnce(new Error())
        .mockResolvedValue(undefined);
      const retry = createRetry(
        { scheduler: immediateScheduler, ...noJitter },
        fn,
      );
      await retry();
      expect(retry.attempts).toBe(2);
    });
  });
});
