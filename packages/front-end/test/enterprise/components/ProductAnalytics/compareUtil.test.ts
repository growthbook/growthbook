import { describe, expect, it } from "vitest";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  alignSeriesByIndex,
  computeBucketComparisons,
  computePeriodTotals,
  formatPercentChange,
  supportsComparisonOverlay,
} from "@/enterprise/components/ProductAnalytics/compareUtil";

const submittedExploreState = {
  type: "metric",
  datasource: "ds_123",
  chartType: "line",
  showAs: "total",
  dateRange: {
    predefined: "last7Days",
    lookbackValue: null,
    lookbackUnit: null,
    startDate: null,
    endDate: null,
  },
  dimensions: [
    {
      dimensionType: "date",
      column: null,
      dateGranularity: "day",
    },
  ],
  dataset: {
    type: "metric",
    values: [
      {
        name: "Signups",
        type: "metric",
        metricId: "metric_signups",
        rowFilters: [],
        unit: null,
        denominatorUnit: null,
      },
    ],
  },
} satisfies ExplorationConfig;

function buildExploration(
  rows: ProductAnalyticsExploration["result"]["rows"],
): ProductAnalyticsExploration {
  return {
    id: "exp_123",
    organization: "org_123",
    dateCreated: new Date("2026-05-11T00:00:00.000Z"),
    dateUpdated: new Date("2026-05-11T00:00:00.000Z"),
    datasource: "ds_123",
    configHash: "hash",
    valueHashes: [],
    config: submittedExploreState,
    result: { rows },
    dateStart: "2026-05-04T00:00:00.000Z",
    dateEnd: "2026-05-11T00:00:00.000Z",
    runStarted: new Date("2026-05-11T00:00:00.000Z"),
    status: "success",
    error: null,
    queries: [],
  };
}

describe("compareUtil", () => {
  it("formats percent change", () => {
    expect(formatPercentChange(25, 100)).toBe("+25%");
    expect(formatPercentChange(-10, 50)).toBe("-20%");
    expect(formatPercentChange(10, 0)).toBeNull();
  });

  it("aligns bucket series by index", () => {
    expect(alignSeriesByIndex([10, 20], [5])).toEqual({
      current: [10, 20],
      previous: [5, 0],
    });
  });

  it("supports line and bar overlays only", () => {
    expect(supportsComparisonOverlay("line")).toBe(true);
    expect(supportsComparisonOverlay("bar")).toBe(true);
    expect(supportsComparisonOverlay("area")).toBe(false);
    expect(supportsComparisonOverlay("bigNumber")).toBe(false);
  });

  it("computes period totals per metric", () => {
    const current = buildExploration([
      {
        dimensions: ["2026-05-10T00:00:00.000Z"],
        values: [
          { metricId: "metric_signups", numerator: 30, denominator: null },
        ],
      },
      {
        dimensions: ["2026-05-11T00:00:00.000Z"],
        values: [
          { metricId: "metric_signups", numerator: 20, denominator: null },
        ],
      },
    ]);
    const comparison = buildExploration([
      {
        dimensions: ["2026-05-03T00:00:00.000Z"],
        values: [
          { metricId: "metric_signups", numerator: 10, denominator: null },
        ],
      },
    ]);

    const totals = computePeriodTotals(
      current,
      comparison,
      submittedExploreState,
      () => null,
    );

    expect(totals).toEqual([
      {
        metricId: "metric_signups",
        metricName: "Signups",
        groupKey: "",
        currentTotal: 50,
        previousTotal: 10,
        delta: 40,
        percentChange: "+400%",
      },
    ]);
  });

  it("computes index-aligned bucket comparisons", () => {
    const current = buildExploration([
      {
        dimensions: ["2026-05-10T00:00:00.000Z"],
        values: [
          { metricId: "metric_signups", numerator: 30, denominator: null },
        ],
      },
    ]);
    const comparison = buildExploration([
      {
        dimensions: ["2026-05-03T00:00:00.000Z"],
        values: [
          { metricId: "metric_signups", numerator: 10, denominator: null },
        ],
      },
    ]);

    const buckets = computeBucketComparisons(
      current,
      comparison,
      submittedExploreState,
      () => null,
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      metricName: "Signups",
      currentTotal: 30,
      previousTotal: 10,
      delta: 20,
      percentChange: "+200%",
    });
  });
});
