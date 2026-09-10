import {
  createBackoff,
  createRetry,
  RetryExhaustedError,
  RetryCancelledError,
  BackoffConfig,
} from "../../src/plugins/retry-manager";

function createTestScheduler() {
  const calls: Array<{ fn: () => void; delay: number }> = [];
  const scheduler = jest.fn(
    (fn: () => void, delay: number): ReturnType<typeof setTimeout> => {
      calls.push({ fn, delay });
      return calls.length as unknown as ReturnType<typeof setTimeout>;
    },
  );
  const runScheduled = (index = calls.length - 1) => calls[index]?.fn();
  return { scheduler, calls, runScheduled };
}

// Shared config shorthand: zero jitter makes delay assertions exact.
const noJitter: Pick<BackoffConfig, "random"> = { random: () => 0 };

describe("createBackoff", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("initial state", () => {
    it("starts with 0 attempts and is not exhausted", () => {
      const backoff = createBackoff();
      expect(backoff.attempts).toBe(0);
      expect(backoff.isExhausted).toBe(false);
    });
  });

  describe("scheduleRetry", () => {
    it("returns the computed delay on the first call", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter });

      const delay = backoff.scheduleRetry(() => {});

      expect(delay).toBe(1000); // baseDelayMs * 2^0
    });

    it("increments attempts after each call", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter });

      backoff.scheduleRetry(() => {});
      expect(backoff.attempts).toBe(1);

      backoff.scheduleRetry(() => {});
      expect(backoff.attempts).toBe(2);
    });

    it("doubles the delay on each successive retry", () => {
      const { scheduler, calls } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter });

      for (let i = 0; i < 5; i++) backoff.scheduleRetry(() => {});

      expect(calls.map((c) => c.delay)).toEqual([
        1000, 2000, 4000, 8000, 16000,
      ]);
    });

    it("caps delay at maxDelayMs", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({
        scheduler,
        ...noJitter,
        baseDelayMs: 1000,
        maxDelayMs: 3000,
      });

      backoff.scheduleRetry(() => {}); // 1000
      backoff.scheduleRetry(() => {}); // 2000
      const delay = backoff.scheduleRetry(() => {}); // would be 4000, capped at 3000

      expect(delay).toBe(3000);
    });

    it("adds jitter from the injected random function", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({
        scheduler,
        random: () => 1, // max jitter: random * jitterMs = 1 * 500 = 500
        baseDelayMs: 1000,
        jitterMs: 500,
      });

      const delay = backoff.scheduleRetry(() => {});

      expect(delay).toBe(1500); // 1000 + 500
    });

    it("passes the correct fn and delay to the scheduler", () => {
      const { scheduler, calls, runScheduled } = createTestScheduler();
      const fn = jest.fn();
      const backoff = createBackoff({ scheduler, ...noJitter });

      backoff.scheduleRetry(fn);

      expect(scheduler).toHaveBeenCalledTimes(1);
      expect(calls[0].delay).toBe(1000);

      runScheduled(); // simulate the timer firing
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("returns null once maxAttempts is reached", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter, maxAttempts: 3 });

      backoff.scheduleRetry(() => {});
      backoff.scheduleRetry(() => {});
      backoff.scheduleRetry(() => {});

      expect(backoff.scheduleRetry(() => {})).toBeNull();
    });

    it("does not call the scheduler once maxAttempts is reached", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter, maxAttempts: 2 });

      backoff.scheduleRetry(() => {});
      backoff.scheduleRetry(() => {});
      backoff.scheduleRetry(() => {}); // exhausted — should not schedule

      expect(scheduler).toHaveBeenCalledTimes(2);
    });

    it("marks isExhausted true at maxAttempts", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter, maxAttempts: 2 });

      expect(backoff.isExhausted).toBe(false);
      backoff.scheduleRetry(() => {});
      expect(backoff.isExhausted).toBe(false);
      backoff.scheduleRetry(() => {});
      expect(backoff.isExhausted).toBe(true);
    });
  });

  describe("reset", () => {
    it("resets attempts to 0", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter });

      backoff.scheduleRetry(() => {});
      backoff.scheduleRetry(() => {});
      backoff.reset();

      expect(backoff.attempts).toBe(0);
    });

    it("clears isExhausted", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter, maxAttempts: 2 });

      backoff.scheduleRetry(() => {});
      backoff.scheduleRetry(() => {});
      expect(backoff.isExhausted).toBe(true);

      backoff.reset();
      expect(backoff.isExhausted).toBe(false);
    });

    it("restarts the delay from the base after reset", () => {
      const { scheduler, calls } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter });

      backoff.scheduleRetry(() => {});
      backoff.scheduleRetry(() => {}); // delay would be 2000
      backoff.reset();
      backoff.scheduleRetry(() => {}); // should restart at 1000

      expect(calls[2].delay).toBe(1000);
    });

    it("calls clearTimeout on the pending timer", () => {
      const fakeId = 42;
      const scheduler = jest.fn(
        () => fakeId as unknown as ReturnType<typeof setTimeout>,
      );
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const backoff = createBackoff({ scheduler, ...noJitter });

      backoff.scheduleRetry(() => {});
      backoff.reset();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeId);
    });

    it("does not call clearTimeout when no timer is pending", () => {
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const backoff = createBackoff({ ...noJitter });

      backoff.reset();

      expect(clearTimeoutSpy).not.toHaveBeenCalled();
    });

    it("allows scheduling retries again after reset", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter, maxAttempts: 1 });

      backoff.scheduleRetry(() => {}); // exhausted
      expect(backoff.scheduleRetry(() => {})).toBeNull();

      backoff.reset();
      expect(backoff.scheduleRetry(() => {})).not.toBeNull();
    });
  });

  describe("cancel", () => {
    it("preserves the attempt count", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter });

      backoff.scheduleRetry(() => {});
      backoff.scheduleRetry(() => {});
      backoff.cancel();

      expect(backoff.attempts).toBe(2);
    });

    it("calls clearTimeout on the pending timer", () => {
      const fakeId = 99;
      const scheduler = jest.fn(
        () => fakeId as unknown as ReturnType<typeof setTimeout>,
      );
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const backoff = createBackoff({ scheduler, ...noJitter });

      backoff.scheduleRetry(() => {});
      backoff.cancel();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeId);
    });

    it("does not call clearTimeout when no timer is pending", () => {
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const backoff = createBackoff({ ...noJitter });

      backoff.cancel();

      expect(clearTimeoutSpy).not.toHaveBeenCalled();
    });

    it("does not call clearTimeout a second time if called again with no new timer", () => {
      const { scheduler } = createTestScheduler();
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const backoff = createBackoff({ scheduler, ...noJitter });

      backoff.scheduleRetry(() => {});
      backoff.cancel();
      clearTimeoutSpy.mockClear();

      backoff.cancel(); // no timer pending — should be a no-op
      expect(clearTimeoutSpy).not.toHaveBeenCalled();
    });
  });

  describe("default config", () => {
    it("uses maxAttempts of 5 by default", () => {
      const { scheduler } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter });

      for (let i = 0; i < 5; i++) {
        expect(backoff.scheduleRetry(() => {})).not.toBeNull();
      }
      expect(backoff.scheduleRetry(() => {})).toBeNull();
    });

    it("uses baseDelayMs of 1000 by default", () => {
      const { scheduler, calls } = createTestScheduler();
      const backoff = createBackoff({ scheduler, ...noJitter });

      backoff.scheduleRetry(() => {});

      expect(calls[0].delay).toBe(1000);
    });

    it("uses maxDelayMs of 30000 by default", () => {
      const { scheduler, calls } = createTestScheduler();
      // Force delay above 30s: 1000 * 2^10 = ~1M ms; cap should kick in
      const backoff = createBackoff({
        scheduler,
        ...noJitter,
        maxAttempts: 15,
      });

      for (let i = 0; i < 15; i++) backoff.scheduleRetry(() => {});

      const lastDelay = calls[calls.length - 1].delay;
      expect(lastDelay).toBe(30000);
    });
  });
});

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
