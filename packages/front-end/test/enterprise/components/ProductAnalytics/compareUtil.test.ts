import { describe, expect, it } from "vitest";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  alignComparisonOverlayToCategories,
  alignSeriesByIndex,
  buildComparisonOverlaySeriesMaps,
  buildComparisonSeriesKey,
  buildComparisonSeriesName,
  buildComparisonTrend,
  computeBigNumberComparisonTrend,
  computePeriodSummary,
  CURRENT_COMPARISON_STACK_ID,
  formatPercentChange,
  getComparisonGroupKey,
  getComparisonPeriodLabels,
  getComparisonStackId,
  PREVIOUS_COMPARISON_STACK_ID,
  showsCompactComparisonSummary,
  showsComparisonOverview,
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

  it("builds comparison series keys and display names per metric and group", () => {
    expect(buildComparisonSeriesKey(1, "US")).toBe(
      JSON.stringify({ i: 1, g: "US" }),
    );
    expect(
      buildComparisonSeriesName({
        metricName: "Signups",
        groupKey: "US",
        numMetrics: 2,
      }),
    ).toBe("Signups (US)");
    expect(
      buildComparisonSeriesName({
        metricName: "Signups",
        groupKey: "US",
        numMetrics: 1,
      }),
    ).toBe("US");
    expect(
      buildComparisonSeriesName({
        metricName: "Signups",
        groupKey: "",
        numMetrics: 1,
      }),
    ).toBe("Signups");
  });

  it("uses separate stack ids for current and previous stacked bars", () => {
    expect(getComparisonStackId(false, true)).toBe(CURRENT_COMPARISON_STACK_ID);
    expect(getComparisonStackId(true, true)).toBe(PREVIOUS_COMPARISON_STACK_ID);
    expect(getComparisonStackId(false, false)).toBeUndefined();
  });

  it("aligns categorical bar overlay by category label", () => {
    const seriesKey = buildComparisonSeriesKey(0, "");
    const comparisonDataMap = {
      [seriesKey]: {
        A: 10,
        B: 20,
        C: 5,
      },
    };

    const aligned = alignComparisonOverlayToCategories(
      "bar",
      ["C", "A", "B"],
      comparisonDataMap,
      [seriesKey],
      ["A", "B", "C"],
    );

    expect(aligned[seriesKey]).toEqual({
      C: 5,
      A: 10,
      B: 20,
    });
  });

  it("aligns stacked bar overlay by category label", () => {
    const seriesKey = buildComparisonSeriesKey(0, "US");
    const comparisonDataMap = {
      [seriesKey]: {
        A: 10,
        B: 20,
      },
    };

    const aligned = alignComparisonOverlayToCategories(
      "stackedBar",
      ["B", "A"],
      comparisonDataMap,
      [seriesKey],
      ["A", "B"],
    );

    expect(aligned[seriesKey]).toEqual({
      B: 20,
      A: 10,
    });
  });

  it("aligns line overlay buckets by ordinal index", () => {
    const seriesKey = buildComparisonSeriesKey(0, "");
    const comparisonDataMap = {
      [seriesKey]: {
        "2026-05-03T00:00:00.000Z": 10,
        "2026-05-04T00:00:00.000Z": 20,
        "2026-05-05T00:00:00.000Z": 30,
      },
    };

    const aligned = alignComparisonOverlayToCategories(
      "line",
      [
        "2026-05-10T00:00:00.000Z",
        "2026-05-11T00:00:00.000Z",
        "2026-05-12T00:00:00.000Z",
      ],
      comparisonDataMap,
      [seriesKey],
      [
        "2026-05-05T00:00:00.000Z",
        "2026-05-03T00:00:00.000Z",
        "2026-05-04T00:00:00.000Z",
      ],
    );

    expect(aligned[seriesKey]).toEqual({
      "2026-05-10T00:00:00.000Z": 10,
      "2026-05-11T00:00:00.000Z": 20,
      "2026-05-12T00:00:00.000Z": 30,
    });
  });

  it("maps missing prior categories to zero in bar overlay", () => {
    const seriesKey = buildComparisonSeriesKey(0, "");
    const comparisonDataMap = {
      [seriesKey]: {
        A: 10,
      },
    };

    const aligned = alignComparisonOverlayToCategories(
      "horizontalBar",
      ["A", "B"],
      comparisonDataMap,
      [seriesKey],
      ["A"],
    );

    expect(aligned[seriesKey]).toEqual({
      A: 10,
      B: 0,
    });
  });

  it("routes chart types to summary, overlay, and inline compare", () => {
    expect(supportsAlwaysOnComparisonOverlay("line")).toBe(true);
    expect(supportsAlwaysOnComparisonOverlay("area")).toBe(true);
    expect(supportsAlwaysOnComparisonOverlay("bigNumber")).toBe(false);
    expect(showsCompactComparisonSummary("line")).toBe(true);
    expect(showsCompactComparisonSummary("table")).toBe(false);
    expect(showsComparisonOverview("table")).toBe(true);
    expect(showsComparisonOverview("bigNumber")).toBe(false);
    expect(usesInlineComparison("timeseries-table")).toBe(true);
  });

  it("formats short comparison period labels for charts and tables", () => {
    const referenceDate = new Date("2026-05-11T12:00:00.000Z");

    expect(
      getComparisonPeriodLabels(
        {
          predefined: "last7Days",
          lookbackValue: null,
          lookbackUnit: null,
          startDate: null,
          endDate: null,
        },
        referenceDate,
      ),
    ).toEqual({
      currentLabel: "May 4–11",
      previousLabel: "Apr 27–May 3",
    });

    expect(
      getComparisonPeriodLabels(
        {
          predefined: "customDateRange",
          lookbackValue: null,
          lookbackUnit: null,
          startDate: "2026-04-01",
          endDate: "2026-05-01",
        },
        referenceDate,
      ),
    ).toEqual({
      currentLabel: "Apr 1–May 1",
      previousLabel: "Mar 1–31",
    });
  });

  it("builds overlay series maps with one pair per metric and group", () => {
    const rows = [
      {
        dimensions: ["2026-05-10T00:00:00.000Z", "US"],
        values: [
          { metricId: "metric_signups", numerator: 30, denominator: null },
          { metricId: "metric_revenue", numerator: 100, denominator: null },
        ],
      },
      {
        dimensions: ["2026-05-10T00:00:00.000Z", "CA"],
        values: [
          { metricId: "metric_signups", numerator: 10, denominator: null },
          { metricId: "metric_revenue", numerator: 40, denominator: null },
        ],
      },
    ];
    const { dataMap, seriesMeta } = buildComparisonOverlaySeriesMaps(
      rows,
      {
        ...submittedExploreState,
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
            {
              name: "Revenue",
              type: "metric",
              metricId: "metric_revenue",
              rowFilters: [],
              unit: null,
              denominatorUnit: null,
            },
          ],
        },
      },
      {
        showAs: "total",
        isRatioByIndex: [false, false],
      },
    );

    const signupsKey = buildComparisonSeriesKey(0, "US");
    const revenueKey = buildComparisonSeriesKey(1, "CA");
    expect(getComparisonGroupKey(rows[0])).toBe("US");
    expect(seriesMeta[signupsKey].name).toBe("Signups (US)");
    expect(seriesMeta[revenueKey].name).toBe("Revenue (CA)");
    expect(dataMap[signupsKey]["2026-05-10T00:00:00.000Z"]).toBe(30);
    expect(dataMap[revenueKey]["2026-05-10T00:00:00.000Z"]).toBe(40);
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
