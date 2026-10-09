import {
  fillDailyBuckets,
  formatUtcWeekday,
  getActivityChart,
} from "./activityChart";

describe("getActivityChart", () => {
  it("orders daily counts, fills empty days, and totals the full range", () => {
    expect(
      getActivityChart({
        dateStart: "2026-09-01T00:00:00Z",
        dateEnd: "2026-09-03T12:00:00Z",
        result: {
          rows: [
            {
              dimensions: ["2026-09-03"],
              values: [{ metricId: "count", numerator: 12, denominator: null }],
            },
            {
              dimensions: ["2026-09-01"],
              values: [{ metricId: "count", numerator: 8, denominator: null }],
            },
          ],
        },
      }),
    ).toEqual({
      days: ["2026-09-01", "2026-09-02", "2026-09-03"],
      counts: [8, 0, 12],
      total: 20,
    });
  });
});

describe("fillDailyBuckets", () => {
  it("adds missing days and keeps warehouse-formatted keys", () => {
    expect(
      fillDailyBuckets(["2026-09-03 00:00:00", "2026-09-01 00:00:00"], {
        dateStart: "2026-09-01T00:00:00Z",
        dateEnd: "2026-09-03T23:59:59.999Z",
      }),
    ).toEqual(["2026-09-01 00:00:00", "2026-09-02", "2026-09-03 00:00:00"]);
  });
});

describe("formatUtcWeekday", () => {
  it("reads warehouse timestamps as UTC days", () => {
    // 2026-09-21 is a Monday.
    expect(formatUtcWeekday("2026-09-21 00:00:00", "short")).toBe("Mon");
    expect(formatUtcWeekday("2026-09-21T00:00:00.000Z", "narrow")).toBe("M");
    expect(formatUtcWeekday("2026-09-21", "short")).toBe("Mon");
    expect(formatUtcWeekday("not a date", "short")).toBe("not a date");
  });
});
