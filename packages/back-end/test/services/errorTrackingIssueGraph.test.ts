import {
  buildTrendBucketsFromRange,
  chooseAllTimeGranularity,
  utcStartOfDay,
  utcStartOfHour,
} from "back-end/src/services/errorTrackingIssueGraph";

describe("errorTrackingIssueGraph", () => {
  it("uses hourly buckets for a few days of activity", () => {
    const first = utcStartOfDay(new Date("2026-05-10T12:00:00Z"));
    const last =
      utcStartOfDay(new Date("2026-05-13T18:00:00Z")) + 18 * 3_600_000;

    expect(chooseAllTimeGranularity(first, last)).toBe("hour");
    const buckets = buildTrendBucketsFromRange(first, last, "hour");
    expect(buckets.length).toBeGreaterThanOrEqual(24);
    expect(buckets.length).toBeLessThanOrEqual(96);
  });

  it("uses week or month buckets for long-lived issues", () => {
    const first = utcStartOfDay(new Date("2025-01-01T00:00:00Z"));
    const last = utcStartOfDay(new Date("2026-05-14T00:00:00Z"));

    const granularity = chooseAllTimeGranularity(first, last);
    expect(["week", "month"]).toContain(granularity);
    const buckets = buildTrendBucketsFromRange(first, last, granularity);
    expect(buckets.length).toBeGreaterThanOrEqual(8);
    expect(buckets.length).toBeLessThanOrEqual(96);
  });

  it("uses finer buckets for short spans", () => {
    const first = utcStartOfHour(new Date("2026-05-14T10:00:00Z"));
    const last = first + 2 * 3_600_000;

    const granularity = chooseAllTimeGranularity(first, last);
    expect(["fiveMinute", "fifteenMinute", "minute"]).toContain(granularity);
    const buckets = buildTrendBucketsFromRange(first, last, granularity);
    expect(buckets.length).toBeGreaterThanOrEqual(8);
    expect(buckets.length).toBeLessThanOrEqual(72);
  });
});
