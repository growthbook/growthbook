import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  alignComparisonOverlayToCategories,
  computeBigNumberComparisonTrendForMetricIndex,
  buildCompareChartLegendModel,
  computeBigNumberComparisonTrends,
  formatCollapsedDateRange,
  formatComparisonMetricLabel,
  getAlignedComparisonDimensionKeyForTooltip,
  parseComparisonTooltipSeriesName,
  sortProductAnalyticsTooltipAxisItems,
} from "@/enterprise/components/ProductAnalytics/comparison-chart";

describe("buildCompareChartLegendModel", () => {
  const labels = { currentLabel: "C", previousLabel: "P" };

  it("groups series by metric, preserving order and pairing current/previous", () => {
    const series = [
      { name: "Any Purchases (C)", color: "#111" },
      { name: "Any Purchases (P)", color: "#222" },
      { name: "Revenue (C)", color: "#333" },
      { name: "Revenue (P)", color: "#444" },
    ];

    expect(buildCompareChartLegendModel(series, labels)).toEqual([
      {
        baseName: "Any Purchases",
        currentColor: "#111",
        currentSeriesName: "Any Purchases (C)",
        previousColor: "#222",
        previousSeriesName: "Any Purchases (P)",
      },
      {
        baseName: "Revenue",
        currentColor: "#333",
        currentSeriesName: "Revenue (C)",
        previousColor: "#444",
        previousSeriesName: "Revenue (P)",
      },
    ]);
  });

  it("ignores series whose names carry no period suffix", () => {
    const series = [
      { name: "Just a series", color: "#111" },
      { name: 42, color: "#222" },
    ];
    expect(buildCompareChartLegendModel(series, labels)).toEqual([]);
  });
});

describe("formatCollapsedDateRange", () => {
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

  it("shows a single date when start and end are the same day", () => {
    expect(formatCollapsedDateRange(utc(2026, 4, 3), utc(2026, 4, 3))).toBe(
      "May 3, 2026",
    );
  });

  it("collapses month and year when both fall in the same month", () => {
    expect(formatCollapsedDateRange(utc(2026, 4, 3), utc(2026, 4, 7))).toBe(
      "May 3 – 7, 2026",
    );
  });

  it("collapses only the year when both fall in the same year", () => {
    expect(formatCollapsedDateRange(utc(2026, 4, 3), utc(2026, 5, 4))).toBe(
      "May 3 – Jun 4, 2026",
    );
  });

  it("shows full dates when the years differ", () => {
    expect(formatCollapsedDateRange(utc(2025, 11, 30), utc(2026, 0, 2))).toBe(
      "Dec 30, 2025 – Jan 2, 2026",
    );
  });
});

describe("alignComparisonOverlayToCategories", () => {
  const seriesKeys = ["__single__"];

  it("maps comparison buckets by chronological rank when first dimension is date", () => {
    const comparisonDataMap = {
      __single__: {
        "2024-12-30": 10,
        "2024-12-31": 20,
        "2025-01-01": 30,
      },
    };
    const comparisonXValues = ["2024-12-31", "2025-01-01", "2024-12-30"];

    const sortedXValues = ["2025-01-02", "2025-01-03", "2025-01-04"];

    const aligned = alignComparisonOverlayToCategories(
      sortedXValues,
      comparisonDataMap,
      seriesKeys,
      comparisonXValues,
      true,
    );

    expect(aligned.__single__["2025-01-02"]).toBe(10);
    expect(aligned.__single__["2025-01-03"]).toBe(20);
    expect(aligned.__single__["2025-01-04"]).toBe(30);
  });

  it("preserves display order of categories while filling values from ranked comparison dates", () => {
    const comparisonDataMap = {
      __single__: {
        "2024-01-10": 100,
        "2024-01-05": 200,
      },
    };
    const sortedXValues = ["2025-01-08", "2025-01-03"];
    const aligned = alignComparisonOverlayToCategories(
      sortedXValues,
      comparisonDataMap,
      seriesKeys,
      ["2024-01-05", "2024-01-10"],
      true,
    );

    expect(aligned.__single__["2025-01-08"]).toBe(100);
    expect(aligned.__single__["2025-01-03"]).toBe(200);
  });

  it("aligns non-date dimensions by category key", () => {
    const comparisonDataMap = {
      __single__: {
        US: 42,
        UK: 7,
      },
    };
    const sortedXValues = ["UK", "US"];
    const aligned = alignComparisonOverlayToCategories(
      sortedXValues,
      comparisonDataMap,
      seriesKeys,
      ["US", "UK"],
      false,
    );

    expect(aligned.__single__.UK).toBe(7);
    expect(aligned.__single__.US).toBe(42);
  });

  it("uses zero when comparison has fewer date buckets than current", () => {
    const comparisonDataMap = {
      __single__: {
        "2024-01-01": 1,
      },
    };
    const sortedXValues = ["2025-01-01", "2025-01-02", "2025-01-03"];
    const aligned = alignComparisonOverlayToCategories(
      sortedXValues,
      comparisonDataMap,
      seriesKeys,
      ["2024-01-01"],
      true,
    );

    expect(aligned.__single__["2025-01-01"]).toBe(1);
    expect(aligned.__single__["2025-01-02"]).toBe(0);
    expect(aligned.__single__["2025-01-03"]).toBe(0);
  });

  it("uses calendar year-over-year when bucket counts differ (rank would mis-align)", () => {
    const comparisonDataMap = {
      __single__: {
        "2025-05-13": 1,
        "2025-05-14": 2,
        "2025-05-15": 999,
        "2025-05-16": 4,
      },
    };
    const sortedXValues = ["2026-05-13", "2026-05-14", "2026-05-16"];
    const comparisonXValues = [
      "2025-05-16",
      "2025-05-13",
      "2025-05-15",
      "2025-05-14",
    ];
    const aligned = alignComparisonOverlayToCategories(
      sortedXValues,
      comparisonDataMap,
      seriesKeys,
      comparisonXValues,
      true,
    );

    expect(aligned.__single__["2026-05-13"]).toBe(1);
    expect(aligned.__single__["2026-05-14"]).toBe(2);
    expect(aligned.__single__["2026-05-16"]).toBe(4);
  });
});

describe("sortProductAnalyticsTooltipAxisItems", () => {
  const labels = {
    currentLabel: "Jan 8 – Jan 14, 2025",
    previousLabel: "Jan 1 – Jan 7, 2025",
  };

  it("groups current then previous per metric and sorts metrics alphabetically", () => {
    const aCurr = formatComparisonMetricLabel("A", labels.currentLabel);
    const aPrev = formatComparisonMetricLabel("A", labels.previousLabel);
    const bCurr = formatComparisonMetricLabel("B", labels.currentLabel);
    const bPrev = formatComparisonMetricLabel("B", labels.previousLabel);
    const shuffled = [
      { seriesName: bPrev, v: 1 },
      { seriesName: aCurr, v: 2 },
      { seriesName: aPrev, v: 3 },
      { seriesName: bCurr, v: 4 },
    ];
    const sorted = sortProductAnalyticsTooltipAxisItems(shuffled, labels);
    expect(sorted.map((x) => x.seriesName)).toEqual([
      aCurr,
      aPrev,
      bCurr,
      bPrev,
    ]);
  });

  it("orders pivot compare rows as current period then previous", () => {
    const shuffled = [
      { seriesName: labels.previousLabel },
      { seriesName: labels.currentLabel },
    ];
    const sorted = sortProductAnalyticsTooltipAxisItems(shuffled, labels);
    expect(sorted.map((x) => x.seriesName)).toEqual([
      labels.currentLabel,
      labels.previousLabel,
    ]);
  });

  it("sorts by series name when not comparing", () => {
    const rows = [
      { seriesName: "Z" },
      { seriesName: "a" },
      { seriesName: "M" },
    ];
    const sorted = sortProductAnalyticsTooltipAxisItems(rows, null);
    expect(sorted.map((x) => x.seriesName)).toEqual(["a", "M", "Z"]);
  });
});

describe("parseComparisonTooltipSeriesName", () => {
  const labels = {
    currentLabel: "Jan 8 – Jan 14, 2025",
    previousLabel: "Jan 1 – Jan 7, 2025",
  };

  it("returns neutral base when not comparing", () => {
    expect(parseComparisonTooltipSeriesName("Anything", null)).toEqual({
      baseName: "Anything",
      period: "neutral",
    });
  });

  it("parses suffixed metric names into base and period", () => {
    const curr = formatComparisonMetricLabel("Revenue", labels.currentLabel);
    const prev = formatComparisonMetricLabel("Revenue", labels.previousLabel);
    expect(parseComparisonTooltipSeriesName(curr, labels)).toEqual({
      baseName: "Revenue",
      period: "current",
    });
    expect(parseComparisonTooltipSeriesName(prev, labels)).toEqual({
      baseName: "Revenue",
      period: "previous",
    });
  });

  it("parses pivot period labels", () => {
    expect(
      parseComparisonTooltipSeriesName(labels.currentLabel, labels),
    ).toEqual({ baseName: "", period: "current" });
    expect(
      parseComparisonTooltipSeriesName(labels.previousLabel, labels),
    ).toEqual({ baseName: "", period: "previous" });
  });

  it("treats unrelated names as neutral", () => {
    expect(parseComparisonTooltipSeriesName("Plain metric", labels)).toEqual({
      baseName: "Plain metric",
      period: "neutral",
    });
  });
});

describe("getAlignedComparisonDimensionKeyForTooltip", () => {
  it("maps current date keys to comparison keys by chronological rank", () => {
    const sortedXValues = ["2025-01-02", "2025-01-03", "2025-01-04"];
    const comparisonXValues = ["2024-12-31", "2025-01-01", "2024-12-30"];

    expect(
      getAlignedComparisonDimensionKeyForTooltip(
        sortedXValues,
        comparisonXValues,
        "2025-01-02",
        true,
      ),
    ).toBe("2024-12-30");
    expect(
      getAlignedComparisonDimensionKeyForTooltip(
        sortedXValues,
        comparisonXValues,
        "2025-01-03",
        true,
      ),
    ).toBe("2024-12-31");
    expect(
      getAlignedComparisonDimensionKeyForTooltip(
        sortedXValues,
        comparisonXValues,
        "2025-01-04",
        true,
      ),
    ).toBe("2025-01-01");
  });

  it("returns the same category key when first dimension is not a date", () => {
    expect(
      getAlignedComparisonDimensionKeyForTooltip(
        ["UK", "US"],
        ["US", "UK"],
        "UK",
        false,
      ),
    ).toBe("UK");
  });

  it("returns undefined when comparison has fewer ranked date buckets", () => {
    expect(
      getAlignedComparisonDimensionKeyForTooltip(
        ["2025-01-01", "2025-01-02", "2025-01-03"],
        ["2024-01-01"],
        "2025-01-02",
        true,
      ),
    ).toBeUndefined();
  });
});

const getFactMetricById = () => null;

function cell(numerator: number, denominator: number | null = null) {
  return { metricId: "", numerator, denominator };
}

function explorationFromValues(
  values: ReturnType<typeof cell>[],
): ProductAnalyticsExploration {
  return {
    result: { rows: [{ dimensions: [], values }] },
  } as unknown as ProductAnalyticsExploration;
}

const submittedExploreStateFixture = {
  type: "fact_table",
  datasource: "ds",
  chartType: "bigNumber",
  dimensions: [],
  dateRange: {
    predefined: "last7Days",
    lookbackValue: null,
    lookbackUnit: null,
    startDate: null,
    endDate: null,
  },
  showAs: "total",
  dataset: {
    type: "fact_table",
    factTableId: "ft",
    values: [
      {
        type: "fact_table",
        name: "M0",
        rowFilters: [],
        valueType: "sum",
        valueColumn: "a",
        unit: null,
      },
      {
        type: "fact_table",
        name: "M1",
        rowFilters: [],
        valueType: "sum",
        valueColumn: "b",
        unit: null,
      },
    ],
  },
} as unknown as ExplorationConfig;

describe("computeBigNumberComparisonTrendForMetricIndex", () => {
  it("returns pctChange from current and previous aggregate cells", () => {
    const current = explorationFromValues([cell(100), cell(50)]);
    const previous = explorationFromValues([cell(80), cell(40)]);
    expect(
      computeBigNumberComparisonTrendForMetricIndex(
        current,
        previous,
        submittedExploreStateFixture,
        getFactMetricById,
        0,
      ),
    ).toEqual({
      currentValue: 100,
      previousValue: 80,
      pctChange: 0.25,
    });
    expect(
      computeBigNumberComparisonTrendForMetricIndex(
        current,
        previous,
        submittedExploreStateFixture,
        getFactMetricById,
        1,
      ),
    ).toEqual({
      currentValue: 50,
      previousValue: 40,
      pctChange: 0.25,
    });
  });

  it("returns pctChange 0 when previous value is 0", () => {
    const current = explorationFromValues([cell(10)]);
    const previous = explorationFromValues([cell(0)]);
    expect(
      computeBigNumberComparisonTrendForMetricIndex(
        current,
        previous,
        submittedExploreStateFixture,
        getFactMetricById,
        0,
      ),
    ).toEqual({ currentValue: 10, previousValue: 0, pctChange: 0 });
  });

  it("returns null when comparison cell is missing", () => {
    const current = explorationFromValues([cell(1), cell(2)]);
    const previous = explorationFromValues([cell(1)]);
    expect(
      computeBigNumberComparisonTrendForMetricIndex(
        current,
        previous,
        submittedExploreStateFixture,
        getFactMetricById,
        1,
      ),
    ).toBeNull();
  });

  it("returns null for negative metric index", () => {
    const current = explorationFromValues([cell(1)]);
    const previous = explorationFromValues([cell(1)]);
    expect(
      computeBigNumberComparisonTrendForMetricIndex(
        current,
        previous,
        submittedExploreStateFixture,
        getFactMetricById,
        -1,
      ),
    ).toBeNull();
  });
});

describe("computeBigNumberComparisonTrends", () => {
  it("returns one trend entry per dataset value", () => {
    const current = explorationFromValues([cell(100), cell(50)]);
    const previous = explorationFromValues([cell(80), cell(40)]);
    const trends = computeBigNumberComparisonTrends(
      current,
      previous,
      submittedExploreStateFixture,
      getFactMetricById,
    );
    expect(trends).toHaveLength(2);
    expect(trends[0]?.pctChange).toBe(0.25);
    expect(trends[1]?.pctChange).toBe(0.25);
  });
});
