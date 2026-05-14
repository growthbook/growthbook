import type {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
  enumerateProductAnalyticsDateBuckets,
  densifyComparisonExplorationTimeseries,
  productAnalyticsDateDimensionMergeKey,
  productAnalyticsDateDimensionBucketMergeKey,
} from "shared/enterprise";
import type { FactMetricInterface } from "shared/types/fact-table";

describe("enumerateProductAnalyticsDateBuckets", () => {
  it("emits one ISO string per day inclusive", () => {
    const rangeStart = new Date(Date.UTC(2024, 0, 1));
    const rangeEnd = new Date(Date.UTC(2024, 0, 3, 23, 59, 59, 999));
    const buckets = enumerateProductAnalyticsDateBuckets({
      resolvedGranularity: "day",
      rangeStart,
      rangeEnd,
    });
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toBe("2024-01-01T00:00:00.000Z");
    expect(buckets[2]).toBe("2024-01-03T00:00:00.000Z");
  });

  it("emits Monday-truncated weeks inclusive of range end", () => {
    const rangeStart = new Date(Date.UTC(2024, 0, 1));
    const rangeEnd = new Date(Date.UTC(2024, 0, 14, 23, 59, 59, 999));
    const buckets = enumerateProductAnalyticsDateBuckets({
      resolvedGranularity: "week",
      rangeStart,
      rangeEnd,
    });
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toBe("2024-01-01T00:00:00.000Z");
    expect(buckets[1]).toBe("2024-01-08T00:00:00.000Z");
  });
});

describe("productAnalyticsDateDimensionMergeKey", () => {
  it("treats date-only and full ISO as the same UTC instant when aligned", () => {
    expect(productAnalyticsDateDimensionMergeKey("2024-01-01")).toBe(
      productAnalyticsDateDimensionMergeKey("2024-01-01T00:00:00.000Z"),
    );
  });
});

describe("productAnalyticsDateDimensionBucketMergeKey", () => {
  it("merges intraday timestamps into the same UTC day bucket", () => {
    const day = "day" as const;
    expect(
      productAnalyticsDateDimensionBucketMergeKey(
        "2024-01-03T14:22:11.000Z",
        day,
      ),
    ).toBe(productAnalyticsDateDimensionBucketMergeKey("2024-01-03", day));
  });
});

describe("densifyComparisonExplorationTimeseries", () => {
  const meanMetric: FactMetricInterface = {
    id: "m1",
    organization: "o",
    datasource: "ds",
    managedBy: "",
    name: "Mean",
    description: "",
    tags: [],
    projects: [],
    owner: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    metricType: "mean",
    inverse: false,
    numerator: {
      factTableId: "ft",
      column: "c",
      aggregation: "sum",
      rowFilters: [],
    },
    denominator: null,
  } as FactMetricInterface;

  const getFactMetricById = (id: string) => (id === "m1" ? meanMetric : null);

  const baseConfig: ExplorationConfig = {
    type: "metric",
    datasource: "ds",
    dimensions: [
      { dimensionType: "date", column: "d", dateGranularity: "day" },
    ],
    chartType: "line",
    dateRange: {
      predefined: "customDateRange",
      startDate: "2024-01-01",
      endDate: "2024-01-07",
    },
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "A",
          metricId: "m1",
          unit: null,
          denominatorUnit: null,
          rowFilters: [],
        },
      ],
    },
    showAs: "total",
  };

  const prevFrame: ExplorationDateRange = {
    predefined: "customDateRange",
    startDate: "2023-01-01",
    endDate: "2023-01-07",
  };

  const shellExploration = (
    rows: ProductAnalyticsExploration["result"]["rows"],
  ): ProductAnalyticsExploration => ({
    id: "cmp",
    organization: "o",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datasource: "ds",
    configHash: "h",
    valueHashes: [],
    config: baseConfig,
    result: { rows },
    dateStart: "2023-01-01",
    dateEnd: "2023-01-07",
    runStarted: null,
    status: "success",
    queries: [],
  });

  it("fills an empty comparison with one zero row per day", () => {
    const out = densifyComparisonExplorationTimeseries({
      comparison: shellExploration([]),
      submittedConfig: baseConfig,
      previousTimeFrame: prevFrame,
      getFactMetricById,
    });
    expect(out?.result.rows).toHaveLength(7);
    expect(out?.result.rows.every((r) => r.values[0]?.numerator === 0)).toBe(
      true,
    );
  });

  it("merges a sparse day with ISO date-only string into densified buckets", () => {
    const out = densifyComparisonExplorationTimeseries({
      comparison: shellExploration([
        {
          dimensions: ["2023-01-03"],
          values: [{ metricId: "m1", numerator: 42, denominator: null }],
        },
      ]),
      submittedConfig: baseConfig,
      previousTimeFrame: prevFrame,
      getFactMetricById,
    });
    expect(out?.result.rows).toHaveLength(7);
    const jan3 = out?.result.rows.find(
      (r) =>
        productAnalyticsDateDimensionBucketMergeKey(
          r.dimensions[0] ?? "",
          "day",
        ) ===
        productAnalyticsDateDimensionBucketMergeKey(
          "2023-01-03T00:00:00.000Z",
          "day",
        ),
    );
    expect(jan3?.values[0]?.numerator).toBe(42);
    const zeros = out?.result.rows.filter((r) => r.values[0]?.numerator === 0);
    expect(zeros).toHaveLength(6);
  });

  it("merges warehouse intraday timestamps into the correct daily bucket", () => {
    const out = densifyComparisonExplorationTimeseries({
      comparison: shellExploration([
        {
          dimensions: ["2023-01-03T15:45:00.000Z"],
          values: [{ metricId: "m1", numerator: 77, denominator: null }],
        },
      ]),
      submittedConfig: baseConfig,
      previousTimeFrame: prevFrame,
      getFactMetricById,
    });
    const jan3 = out?.result.rows.find(
      (r) =>
        productAnalyticsDateDimensionBucketMergeKey(
          r.dimensions[0] ?? "",
          "day",
        ) ===
        productAnalyticsDateDimensionBucketMergeKey(
          "2023-01-03T00:00:00.000Z",
          "day",
        ),
    );
    expect(jan3?.values[0]?.numerator).toBe(77);
  });

  it("densifies by week when dateGranularity is week", () => {
    const weekConfig: ExplorationConfig = {
      ...baseConfig,
      dimensions: [
        { dimensionType: "date", column: "d", dateGranularity: "week" },
      ],
    };
    const weekPrev: ExplorationDateRange = {
      predefined: "customDateRange",
      startDate: "2024-01-01",
      endDate: "2024-01-14",
    };
    const dr = calculateProductAnalyticsDateRange(weekPrev);
    const resolved = getDateGranularity("week", dr);
    expect(resolved).toBe("week");
    const expectedBuckets = enumerateProductAnalyticsDateBuckets({
      resolvedGranularity: "week",
      rangeStart: dr.startDate,
      rangeEnd: dr.endDate,
    });
    expect(expectedBuckets).toHaveLength(2);

    const out = densifyComparisonExplorationTimeseries({
      comparison: shellExploration([]),
      submittedConfig: weekConfig,
      previousTimeFrame: weekPrev,
      getFactMetricById,
    });
    expect(out?.result.rows).toHaveLength(2);
  });
});
