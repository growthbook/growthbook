import { readMetricData } from "back-end/src/queryRunners/PopulationDataQueryRunner";

type MetricArg = Parameters<typeof readMetricData>[0]["metric"];

const metric = {
  id: "m1",
  metricType: "mean",
  numerator: { factTableId: "ft", column: "value" },
} as unknown as MetricArg;

describe("readMetricData", () => {
  it("counts each day once when bucketing users by week", () => {
    // 2026-09-08 through 2026-09-10 fall in one week bucket, 2026-09-15 in the next
    const rows = [
      { dim_pre_date: "2026-09-08", users: 100, count: 100, main_sum: 100 },
      { dim_pre_date: "2026-09-09", users: 200, count: 200, main_sum: 200 },
      { dim_pre_date: "2026-09-10", users: 300, count: 300, main_sum: 300 },
      { dim_pre_date: "2026-09-15", users: 50, count: 50, main_sum: 50 },
    ];

    const { units } = readMetricData({ metric, rows });

    expect(units.length).toBe(2);
    expect(units.map((u) => u.count).sort((a, b) => a - b)).toEqual([50, 600]);
  });
});
