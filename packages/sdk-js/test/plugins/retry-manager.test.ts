import { createBackoff, BackoffConfig } from "../../src/plugins/retry-manager";

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
