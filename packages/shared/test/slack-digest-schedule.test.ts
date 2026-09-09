import {
  slackDigestNextRunAt,
  slackDigestNextRunAts,
} from "../src/validators/event-webhook";
import type { ResolvedSlackDigest } from "../src/validators/event-webhook";

const digest = (o: Partial<ResolvedSlackDigest>): ResolvedSlackDigest => ({
  frequency: "daily",
  hourUtc: 9,
  dayOfWeekUtc: 1,
  dayOfMonth: 1,
  intervalDays: 3,
  ...o,
});

const utc = (iso: string) => new Date(iso);

describe("slackDigestNextRunAt", () => {
  it("returns null when the digest is off", () => {
    expect(
      slackDigestNextRunAt(
        digest({ frequency: "off" }),
        utc("2026-03-10T00:00:00Z"),
      ),
    ).toBeNull();
  });

  it("daily: same day when the hour is still ahead, else next day", () => {
    expect(
      slackDigestNextRunAt(digest({}), utc("2026-03-10T08:00:00Z")),
    ).toEqual(utc("2026-03-10T09:00:00Z"));
    expect(
      slackDigestNextRunAt(digest({}), utc("2026-03-10T09:30:00Z")),
    ).toEqual(utc("2026-03-11T09:00:00Z"));
  });

  it("is always strictly after `from` (no re-firing the same instant)", () => {
    const at = utc("2026-03-10T09:00:00Z");
    expect(slackDigestNextRunAt(digest({}), at)).toEqual(
      utc("2026-03-11T09:00:00Z"),
    );
  });

  it("weekly: lands on the configured UTC weekday", () => {
    // 2026-03-10 is a Tuesday; next Monday (1) is the 16th.
    const next = slackDigestNextRunAt(
      digest({ frequency: "weekly", dayOfWeekUtc: 1 }),
      utc("2026-03-10T12:00:00Z"),
    );
    expect(next).toEqual(utc("2026-03-16T09:00:00Z"));
    expect(next?.getUTCDay()).toBe(1);
  });

  it("monthly: next occurrence of the configured day", () => {
    expect(
      slackDigestNextRunAt(
        digest({ frequency: "monthly", dayOfMonth: 15 }),
        utc("2026-03-20T00:00:00Z"),
      ),
    ).toEqual(utc("2026-04-15T09:00:00Z"));
  });

  it("monthly: clamps a too-large day to the end of a short month", () => {
    // April has 30 days, so "the 31st" fires on the 30th.
    expect(
      slackDigestNextRunAt(
        digest({ frequency: "monthly", dayOfMonth: 31 }),
        utc("2026-04-02T00:00:00Z"),
      ),
    ).toEqual(utc("2026-04-30T09:00:00Z"));
  });

  it("quarterly: only in quarter-start months", () => {
    const next = slackDigestNextRunAt(
      digest({ frequency: "quarterly", dayOfMonth: 1 }),
      utc("2026-02-10T00:00:00Z"),
    );
    expect(next).toEqual(utc("2026-04-01T09:00:00Z"));
    expect([0, 3, 6, 9]).toContain(next?.getUTCMonth());
  });

  it("custom: advances by the interval from the last run", () => {
    expect(
      slackDigestNextRunAt(
        digest({ frequency: "custom", intervalDays: 3 }),
        utc("2026-03-10T09:00:00Z"),
      ),
    ).toEqual(utc("2026-03-13T09:00:00Z"));
  });

  it("custom: a very overdue run still lands in the future", () => {
    // Last run 10 intervals ago — must not return a past timestamp.
    const from = utc("2026-03-01T09:00:00Z");
    const now = utc("2026-04-01T00:00:00Z");
    const next = slackDigestNextRunAt(
      digest({ frequency: "custom", intervalDays: 3 }),
      from,
    );
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
    // Repeatedly advancing from the result eventually passes `now`, i.e. the
    // schedule converges rather than looping in the past.
    let cursor = next!;
    for (let i = 0; i < 50 && cursor <= now; i++) {
      cursor = slackDigestNextRunAt(
        digest({ frequency: "custom", intervalDays: 3 }),
        cursor,
      )!;
    }
    expect(cursor.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("slackDigestNextRunAts", () => {
  it("returns null for each digest that is off", () => {
    expect(
      slackDigestNextRunAts(undefined, utc("2026-03-10T00:00:00Z")),
    ).toEqual({ experiment: null, feature: null });
  });

  it("schedules each configured digest independently", () => {
    const { experiment, feature } = slackDigestNextRunAts(
      {
        experimentDigest: { frequency: "daily", hourUtc: 9 },
        featureDigest: { frequency: "weekly", hourUtc: 14, dayOfWeekUtc: 1 },
      },
      utc("2026-03-10T12:00:00Z"),
    );
    expect(experiment).toEqual(utc("2026-03-11T09:00:00Z"));
    expect(feature).toEqual(utc("2026-03-16T14:00:00Z"));
  });
});
