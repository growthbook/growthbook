import {
  getEventActivityConfig,
  getEventActivityDailyCounts,
} from "./eventActivityConfig";

const dateRange = {
  predefined: "customDateRange" as const,
  startDate: "2026-10-01",
  endDate: "2026-10-03",
};

describe("getEventActivityConfig", () => {
  it("counts events per day on the managed events fact table", () => {
    const config = getEventActivityConfig({
      datasourceId: "ds_1",
      factTableId: "ds_1_events",
      dateRange,
    });
    expect(config).toMatchObject({
      type: "fact_table",
      datasource: "ds_1",
      dateRange,
      dimensions: [
        { dimensionType: "date", column: "date", dateGranularity: "day" },
      ],
      dataset: {
        type: "fact_table",
        factTableId: "ds_1_events",
        values: [{ valueType: "count", valueColumn: null, unit: null }],
      },
    });
  });
});

describe("getEventActivityDailyCounts", () => {
  it("fills missing days with zero and sums the total", () => {
    const result = getEventActivityDailyCounts({
      dateStart: "2026-10-01T00:00:00Z",
      dateEnd: "2026-10-03T23:59:59Z",
      result: {
        rows: [
          {
            dimensions: ["2026-10-01 00:00:00"],
            values: [{ metricId: "", numerator: 5, denominator: null }],
          },
          {
            dimensions: ["2026-10-03 00:00:00"],
            values: [{ metricId: "", numerator: 2, denominator: null }],
          },
        ],
      },
    });
    expect(result.dailyValues).toEqual([
      { day: "2026-10-01", value: 5 },
      { day: "2026-10-02", value: 0 },
      { day: "2026-10-03", value: 2 },
    ]);
    expect(result.total).toBe(7);
  });
});
