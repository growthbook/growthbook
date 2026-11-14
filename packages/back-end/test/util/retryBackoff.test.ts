import {
  getNextRetryAt,
  getRetryBackoffMs,
} from "back-end/src/util/retryBackoff";

describe("getRetryBackoffMs", () => {
  it("retries within seconds, then backs off to a 30-minute ceiling", () => {
    const seconds = Array.from(
      { length: 11 },
      (_, i) => getRetryBackoffMs(i + 1) / 1000,
    );
    expect(seconds).toEqual([
      5, 10, 30, 60, 120, 240, 480, 960, 1800, 1800, 1800,
    ]);
  });

  it("treats attempts below 1 as the first attempt", () => {
    expect(getRetryBackoffMs(0)).toBe(5000);
    expect(getRetryBackoffMs(-5)).toBe(5000);
  });
});

describe("getNextRetryAt", () => {
  const now = new Date("2026-11-13T12:00:00.000Z");

  it("schedules the next attempt after the backoff", () => {
    expect(getNextRetryAt(1, 10, now)).toEqual(new Date(now.getTime() + 5000));
    expect(getNextRetryAt(4, 10, now)).toEqual(
      new Date(now.getTime() + 60_000),
    );
  });

  it("stops once the last allowed attempt has failed", () => {
    expect(getNextRetryAt(9, 10, now)).not.toBeNull();
    expect(getNextRetryAt(10, 10, now)).toBeNull();
  });
});
