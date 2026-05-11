import { describe, expect, it } from "vitest";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  alignSeriesByIndex,
  buildComparisonTrend,
  computeBigNumberComparisonTrend,
  computePeriodSummary,
  formatPercentChange,
  showsCompactComparisonSummary,
  supportsAlwaysOnComparisonOverlay,
  usesInlineComparison,
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

  it("builds comparison trends", () => {
    expect(buildComparisonTrend(50, 10)).toMatchObject({
      current: 50,
      previous: 10,
      delta: 40,
      percentChange: "+400%",
      direction: "up",
    });
    expect(buildComparisonTrend(10, 0)).toMatchObject({
      direction: "none",
      percentChange: null,
    });
  });

  it("aligns bucket series by index", () => {
    expect(alignSeriesByIndex([10, 20], [5])).toEqual({
      current: [10, 20],
      previous: [5, 0],
    });
  });

  it("routes chart types to summary, overlay, and inline compare", () => {
    expect(supportsAlwaysOnComparisonOverlay("line")).toBe(true);
    expect(supportsAlwaysOnComparisonOverlay("area")).toBe(true);
    expect(supportsAlwaysOnComparisonOverlay("bigNumber")).toBe(false);
    expect(showsCompactComparisonSummary("line")).toBe(true);
    expect(showsCompactComparisonSummary("table")).toBe(false);
    expect(usesInlineComparison("timeseries-table")).toBe(true);
  });

  it("computes period summary totals and averages", () => {
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

    const summaries = computePeriodSummary(
      current,
      comparison,
      submittedExploreState,
      () => null,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0].totalTrend).toMatchObject({
      current: 50,
      previous: 10,
      percentChange: "+400%",
    });
    expect(summaries[0].averageTrend).toMatchObject({
      current: 25,
      previous: 10,
      percentChange: "+150%",
    });
  });

  it("computes big number comparison trend", () => {
    const current = buildExploration([
      {
        dimensions: [],
        values: [
          { metricId: "metric_signups", numerator: 40, denominator: null },
        ],
      },
    ]);
    const comparison = buildExploration([
      {
        dimensions: [],
        values: [
          { metricId: "metric_signups", numerator: 20, denominator: null },
        ],
      },
    ]);

    expect(
      computeBigNumberComparisonTrend(
        current,
        comparison,
        submittedExploreState,
        () => null,
      ),
    ).toMatchObject({
      current: 40,
      previous: 20,
      percentChange: "+100%",
    });
  });
});
