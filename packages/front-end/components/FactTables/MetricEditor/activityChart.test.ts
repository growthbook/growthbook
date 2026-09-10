import { getActivityChart } from "./activityChart";

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
