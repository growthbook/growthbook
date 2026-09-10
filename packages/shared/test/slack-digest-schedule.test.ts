import {
  slackDigestNextRunAt,
  slackDigestNextRunAts,
  type ResolvedSlackDigest,
} from "../src/validators/event-webhook";

const make = (
  overrides: Partial<ResolvedSlackDigest> = {},
): ResolvedSlackDigest => ({
  frequency: "daily",
  hourUtc: 9,
  dayOfWeekUtc: 1,
  dayOfMonth: 1,
  intervalDays: 3,
  ...overrides,
});

describe("slack digest schedule", () => {
  it("returns the next daily occurrence strictly after the input", () => {
    expect(
      slackDigestNextRunAt(make(), new Date("2026-03-10T08:00:00Z")),
    ).toEqual(new Date("2026-03-10T09:00:00Z"));
    expect(
      slackDigestNextRunAt(make(), new Date("2026-03-10T09:00:00Z")),
    ).toEqual(new Date("2026-03-11T09:00:00Z"));
  });

  it("supports weekly, monthly, quarterly, and custom schedules", () => {
    expect(
      slackDigestNextRunAt(
        make({ frequency: "weekly", dayOfWeekUtc: 1 }),
        new Date("2026-03-10T12:00:00Z"),
      ),
    ).toEqual(new Date("2026-03-16T09:00:00Z"));
    expect(
      slackDigestNextRunAt(
        make({ frequency: "monthly", dayOfMonth: 15 }),
        new Date("2026-03-20T00:00:00Z"),
      ),
    ).toEqual(new Date("2026-04-15T09:00:00Z"));
    expect(
      slackDigestNextRunAt(
        make({ frequency: "quarterly", dayOfMonth: 1 }),
        new Date("2026-02-10T00:00:00Z"),
      ),
    ).toEqual(new Date("2026-04-01T09:00:00Z"));
    expect(
      slackDigestNextRunAt(
        make({ frequency: "custom", intervalDays: 3 }),
        new Date("2026-03-10T09:00:00Z"),
      ),
    ).toEqual(new Date("2026-03-13T09:00:00Z"));
  });

  it("returns independent schedules and null for off", () => {
    expect(
      slackDigestNextRunAts(
        { experimentDigest: { frequency: "off" } },
        new Date("2026-03-10T00:00:00Z"),
      ).experiment,
    ).toBeNull();
    expect(
      slackDigestNextRunAts(
        {
          experimentDigest: { frequency: "daily", hourUtc: 9 },
          featureDigest: { frequency: "weekly", hourUtc: 14, dayOfWeekUtc: 1 },
        },
        new Date("2026-03-10T12:00:00Z"),
      ),
    ).toEqual({
      experiment: new Date("2026-03-11T09:00:00Z"),
      feature: new Date("2026-03-16T14:00:00Z"),
    });
  });
});
