import {
  getEventForwarderActivityConfig,
  getEventForwarderDailyCounts,
  getEventForwarderNoEventsMessage,
} from "./eventForwarderActivityConfig";

const dateRange = {
  predefined: "customDateRange" as const,
  startDate: "2026-10-01",
  endDate: "2026-10-03",
};

describe("getEventForwarderActivityConfig", () => {
  it("counts events per day on the managed events fact table", () => {
    const config = getEventForwarderActivityConfig({
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

describe("getEventForwarderDailyCounts", () => {
  it("fills missing days with zero and sums the total", () => {
    const result = getEventForwarderDailyCounts({
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

describe("getEventForwarderNoEventsMessage", () => {
  it("blames a pause before the usage limit", () => {
    expect(
      getEventForwarderNoEventsMessage({ isPaused: true, isOverLimit: true }),
    ).toBe("Forwarding is paused, so no new events are arriving.");
  });
  it("names the usage limit when forwarding is blocked", () => {
    expect(
      getEventForwarderNoEventsMessage({ isPaused: false, isOverLimit: true }),
    ).toBe(
      "The monthly event limit has been reached, so no new events are arriving.",
    );
  });
  it("says nothing was forwarded otherwise", () => {
    expect(
      getEventForwarderNoEventsMessage({ isPaused: false, isOverLimit: false }),
    ).toBe("No events were forwarded during this period.");
  });
});
