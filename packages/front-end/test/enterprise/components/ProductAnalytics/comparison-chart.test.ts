import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  alignComparisonOverlayToCategories,
  assignSecondaryValueAxis,
  buildComparisonOverlaySeriesMaps,
  buildValueAxes,
  buildExplorerChartTooltipFormatter,
  buildAlignedComparisonOverlayForExplorer,
  getPopulationSeriesKeys,
  fillPopulationSeriesGaps,
  buildExplorerChartComparisonSeriesList,
  sortDateXValues,
  compareBarFramePx,
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

  it("leaves % of Population gaps past a shorter comparison window", () => {
    const aligned = alignComparisonOverlayToCategories(
      ["2026-09-01", "2026-09-02", "2026-09-03"],
      {
        __metric_0__: { "2026-08-31": { value: 50 } },
        __metric_1__: { "2026-08-31": { value: 7 } },
      },
      ["__metric_0__", "__metric_1__"],
      ["2026-08-31"],
      true,
      "chronological",
      new Set(["__metric_0__"]),
    );
    expect(Object.values(aligned.__metric_0__)).toEqual([
      { value: 50 },
      { value: null },
      { value: null },
    ]);
    // Counts keep reading 0 there.
    expect(Object.values(aligned.__metric_1__)).toEqual([
      { value: 7 },
      { value: 0 },
      { value: 0 },
    ]);
  });

  it("maps comparison buckets by chronological rank when first dimension is date", () => {
    const comparisonDataMap = {
      __single__: {
        "2024-12-30": { value: 10 },
        "2024-12-31": { value: 20 },
        "2025-01-01": { value: 30 },
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

    expect(aligned.__single__["2025-01-02"]).toEqual({ value: 10 });
    expect(aligned.__single__["2025-01-03"]).toEqual({ value: 20 });
    expect(aligned.__single__["2025-01-04"]).toEqual({ value: 30 });
  });

  it("preserves display order of categories while filling values from ranked comparison dates", () => {
    const comparisonDataMap = {
      __single__: {
        "2024-01-10": { value: 100 },
        "2024-01-05": { value: 200 },
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

    expect(aligned.__single__["2025-01-08"]).toEqual({ value: 100 });
    expect(aligned.__single__["2025-01-03"]).toEqual({ value: 200 });
  });

  it("aligns non-date dimensions by category key", () => {
    const comparisonDataMap = {
      __single__: {
        US: { value: 42 },
        UK: { value: 7 },
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

    expect(aligned.__single__.UK).toEqual({ value: 7 });
    expect(aligned.__single__.US).toEqual({ value: 42 });
  });

  it("uses zero when comparison has fewer date buckets than current", () => {
    const comparisonDataMap = {
      __single__: {
        "2024-01-01": { value: 1 },
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

    expect(aligned.__single__["2025-01-01"]).toEqual({ value: 1 });
    expect(aligned.__single__["2025-01-02"]).toEqual({ value: 0 });
    expect(aligned.__single__["2025-01-03"]).toEqual({ value: 0 });
  });

  it("uses calendar year-over-year when bucket counts differ (rank would mis-align)", () => {
    const comparisonDataMap = {
      __single__: {
        "2025-05-13": { value: 1 },
        "2025-05-14": { value: 2 },
        "2025-05-15": { value: 999 },
        "2025-05-16": { value: 4 },
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

    expect(aligned.__single__["2026-05-13"]).toEqual({ value: 1 });
    expect(aligned.__single__["2026-05-14"]).toEqual({ value: 2 });
    expect(aligned.__single__["2026-05-16"]).toEqual({ value: 4 });
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

  it("returns null when the previous value is 0", () => {
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
    ).toBeNull();
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

describe("% of Population fractions", () => {
  const renderOpts = {
    values: [
      {
        showAs: "percent_of_population" as const,
        isRatio: false,
        seriesName: "Signups",
        valueAxis: "secondary" as const,
      },
      {
        showAs: "total" as const,
        isRatio: false,
        seriesName: "Logins",
        valueAxis: "primary" as const,
      },
    ],
    sharedShowAs: null,
    modesAreMixed: true,
    primaryAxisShowAs: "total" as const,
    sharedUnit: "user_id",
  };
  const rows = [
    {
      dimensions: ["2026-09-01"],
      values: [
        { metricId: "signups", numerator: 1, denominator: 1 },
        { metricId: "logins", numerator: 5, denominator: 5 },
      ],
      populationCount: 100,
    },
  ];
  const fraction = { numerator: 1, populationCount: 100 };
  const septFirstMs = Date.UTC(2026, 8, 1);
  const tooltipArgs = {
    chartType: "line" as const,
    resolvedGranularity: "day" as const,
    firstDimensionIsDate: true,
    showLineAreaCompareTooltipDates: false,
    alignedComparisonOverlay: null,
    sortedXValues: ["2026-09-01"],
    seriesConfigsLength: 2,
    formatNumber: (value: number) => String(value),
  };

  it("carries the fraction only on values shown as a share of the Population", () => {
    const { dataMap } = buildComparisonOverlaySeriesMaps(
      rows,
      submittedExploreStateFixture,
      renderOpts,
    );
    expect(dataMap.__metric_0__["2026-09-01"]).toEqual({ value: 1, fraction });
    expect(dataMap.__metric_1__["2026-09-01"]).toEqual({ value: 5 });
  });

  it("has no value and no fraction for rows without a Population", () => {
    const withoutPopulation = rows.map(({ dimensions, values }) => ({
      dimensions,
      values,
    }));
    const { dataMap } = buildComparisonOverlaySeriesMaps(
      withoutPopulation,
      submittedExploreStateFixture,
      renderOpts,
    );
    expect(dataMap.__metric_0__["2026-09-01"]).toEqual({ value: null });
  });

  it("has no value and no fraction for a day with no members", () => {
    const noMembers = rows.map((row) => ({ ...row, populationCount: 0 }));
    const { dataMap } = buildComparisonOverlaySeriesMaps(
      noMembers,
      submittedExploreStateFixture,
      renderOpts,
    );
    expect(dataMap.__metric_0__["2026-09-01"]).toEqual({ value: null });
  });

  it("draws the previous period's fraction at the current x", () => {
    const previousRows = [
      {
        dimensions: ["2026-08-25"],
        values: [
          { metricId: "signups", numerator: 3, denominator: 3 },
          { metricId: "logins", numerator: 9, denominator: 9 },
        ],
        populationCount: 50,
      },
    ];
    const overlay = buildAlignedComparisonOverlayForExplorer({
      sortedXValues: ["2026-09-01"],
      comparisonRows: previousRows,
      submittedExploreState: submittedExploreStateFixture,
      renderOpts,
      sortedSeriesKeys: ["__metric_0__", "__metric_1__"],
      firstDimensionIsDate: true,
      comparisonAlignment: "chronological",
    });
    expect(overlay?.alignedMap.__metric_0__["2026-09-01"]).toEqual({
      value: 6,
      fraction: { numerator: 3, populationCount: 50 },
    });
  });

  it("puts the fraction on the series' data item", () => {
    const { dataMap, seriesMeta } = buildComparisonOverlaySeriesMaps(
      rows,
      submittedExploreStateFixture,
      renderOpts,
    );
    const [signups] = buildExplorerChartComparisonSeriesList({
      chartType: "line",
      sourceDataMap: dataMap,
      sourceSeriesMeta: seriesMeta,
      sourceSeriesKeys: ["__metric_0__"],
      sourceSortedXValues: ["2026-09-01"],
      numMetrics: 2,
      numDimensions: 1,
      isStacked: false,
      compareOverlayActive: false,
      comparisonPeriodLabels: null,
      seriesColor: () => "#000",
      comparisonSeriesColor: () => "#000",
      animate: false,
    }) as { data: unknown[] }[];
    expect(signups.data).toEqual([{ value: [septFirstMs, 1], fraction }]);
  });

  it("puts the fraction before the value in the tooltip", () => {
    const formatter = buildExplorerChartTooltipFormatter({
      ...tooltipArgs,
      comparisonPeriodLabels: null,
    });
    const html = formatter?.([
      {
        axisValue: septFirstMs,
        marker: "",
        seriesName: "Signups",
        value: [septFirstMs, 1],
        data: { value: [septFirstMs, 1], fraction },
      },
      {
        axisValue: septFirstMs,
        marker: "",
        seriesName: "Logins",
        value: [septFirstMs, 5],
        data: { value: [septFirstMs, 5] },
      },
    ]);
    expect(html).toContain(
      'font-style:italic;opacity:0.6;margin-right:6px">1 / 100</span><b>1</b>',
    );
    expect(html).toContain("<b>5</b>");
  });

  it("shows fractions, and No data for an empty period, when comparing", () => {
    const periodLabels = {
      currentLabel: "Sep 1 – 7, 2026",
      previousLabel: "Aug 25 – 31, 2026",
    };
    const formatter = buildExplorerChartTooltipFormatter({
      ...tooltipArgs,
      comparisonPeriodLabels: periodLabels,
      showLineAreaCompareTooltipDates: true,
      alignedComparisonOverlay: { comparisonXValues: ["2026-08-25"] },
    });
    const html = formatter?.([
      {
        axisValue: septFirstMs,
        marker: "",
        seriesName: "Signups (Sep 1 – 7, 2026)",
        value: [septFirstMs, 1],
        data: { value: [septFirstMs, 1], fraction },
      },
      // A Population bucket with no members: a data item with no value.
      {
        axisValue: septFirstMs,
        marker: "",
        seriesName: "Signups (Aug 25 – 31, 2026)",
        value: null,
        data: { value: [septFirstMs, null] },
      },
      // A blank slot sparse bars are laid out with: no data item at all.
      {
        axisValue: septFirstMs,
        marker: "",
        seriesName: "Logins (Aug 25 – 31, 2026)",
        value: null,
        data: null,
      },
    ]);
    expect(html).toContain(">1 / 100</span>1<");
    expect(html).toContain("Previous");
    expect(html).toContain("No data");
    expect(html).not.toContain("Logins");
  });
});

describe("second % of Population value axis", () => {
  const renderOpts = {
    values: [
      {
        showAs: "total" as const,
        isRatio: false,
        seriesName: "Signups",
        valueAxis: "primary" as const,
      },
      {
        showAs: "percent_of_population" as const,
        isRatio: false,
        seriesName: "Purchases",
        valueAxis: "secondary" as const,
      },
    ],
    sharedShowAs: null,
    modesAreMixed: true,
    primaryAxisShowAs: "total" as const,
    sharedUnit: "user_id",
  };
  const signups = { name: "Signups", valueAxis: "primary" as const };
  const purchases = { name: "Purchases", valueAxis: "secondary" as const };

  it("copies each value's axis onto its series when it's built", () => {
    const { seriesMeta } = buildComparisonOverlaySeriesMaps(
      [
        {
          dimensions: ["2026-09-01"],
          values: [
            { metricId: "m0", numerator: 1, denominator: null },
            { metricId: "m1", numerator: 2, denominator: null },
          ],
        },
      ],
      submittedExploreStateFixture,
      renderOpts,
    );
    expect(seriesMeta.__metric_0__.valueAxis).toBe("primary");
    expect(seriesMeta.__metric_1__.valueAxis).toBe("secondary");
  });

  it("moves only the % of Population series onto the second axis", () => {
    expect(
      assignSecondaryValueAxis([signups, purchases], "yAxisIndex"),
    ).toEqual([signups, { ...purchases, yAxisIndex: 1 }]);
  });

  it("moves every series of a value, whatever it's named", () => {
    // Compare periods and breakdown groups of a value are named after the
    // period or the group, not the value.
    const current = { ...purchases, name: "Purchases (C)" };
    const previous = { ...purchases, name: "Purchases (P)" };
    const group = { ...purchases, name: "US" };
    expect(
      assignSecondaryValueAxis(
        [signups, current, previous, group],
        "yAxisIndex",
      ),
    ).toEqual([
      signups,
      { ...current, yAxisIndex: 1 },
      { ...previous, yAxisIndex: 1 },
      { ...group, yAxisIndex: 1 },
    ]);
  });

  it("keeps a vertical compare bar's category axis", () => {
    expect(
      assignSecondaryValueAxis([{ ...purchases, xAxisIndex: 1 }], "yAxisIndex"),
    ).toEqual([{ ...purchases, xAxisIndex: 1, yAxisIndex: 1 }]);
  });

  it("uses the x value axis on horizontal bars, never the category axis", () => {
    const [current, previous] = assignSecondaryValueAxis(
      [purchases, { ...purchases, yAxisIndex: 1 }],
      "xAxisIndex",
    );
    expect(current).toEqual({ ...purchases, xAxisIndex: 1 });
    expect(current).not.toHaveProperty("yAxisIndex");
    // The previous period keeps its own category axis.
    expect(previous).toEqual({ ...purchases, yAxisIndex: 1, xAxisIndex: 1 });
  });

  it("gives the second axis's stacked series their own stack", () => {
    expect(
      assignSecondaryValueAxis(
        [
          { ...signups, stack: "stack" },
          { ...purchases, stack: "stack" },
        ],
        "yAxisIndex",
      ),
    ).toEqual([
      { ...signups, stack: "stack" },
      { ...purchases, stack: "stack:secondary", yAxisIndex: 1 },
    ]);
  });

  it("leaves primary-axis series alone", () => {
    const series = [signups, { ...signups, stack: "stack" }];
    expect(assignSecondaryValueAxis(series, "yAxisIndex")).toEqual(series);
  });

  it.each(["right", "top"] as const)(
    "adds a titled %s axis whose ticks follow the primary grid lines",
    (position) => {
      const primary = {
        type: "value",
        name: "Total",
        splitLine: { show: true },
      };
      expect(buildValueAxes(primary, null, position)).toBe(primary);
      expect(
        buildValueAxes(primary, { name: "% of Population" }, position),
      ).toEqual([
        primary,
        {
          type: "value",
          name: "% of Population",
          position,
          alignTicks: true,
          splitLine: { show: false },
        },
      ]);
    },
  );
});

describe("sortDateXValues", () => {
  it("orders warehouse and ISO dates by time", () => {
    expect(
      sortDateXValues([
        "2026-09-01 02:00:00",
        "2026-09-01T01:00:00.000Z",
        "2026-09-01T03:00:00.000Z",
        "2026-09-01 00:00:00",
      ]),
    ).toEqual([
      "2026-09-01 00:00:00",
      "2026-09-01T01:00:00.000Z",
      "2026-09-01 02:00:00",
      "2026-09-01T03:00:00.000Z",
    ]);
  });
});

describe("fillPopulationSeriesGaps", () => {
  it("leaves current % of Population points past its window as gaps", () => {
    const renderOpts = {
      values: [
        {
          showAs: "percent_of_population" as const,
          isRatio: false,
          seriesName: "Signups",
          valueAxis: "secondary" as const,
        },
        {
          showAs: "total" as const,
          isRatio: false,
          seriesName: "Logins",
          valueAxis: "primary" as const,
        },
      ],
      sharedShowAs: null,
      modesAreMixed: true,
      primaryAxisShowAs: "total" as const,
      sharedUnit: "user_id",
    };
    const seriesMeta = {
      __metric_0__: {
        metricId: "signups",
        name: "Signups",
        valueIndex: 0,
        valueAxis: "secondary" as const,
      },
      __metric_1__: {
        metricId: "logins",
        name: "Logins",
        valueIndex: 1,
        valueAxis: "primary" as const,
      },
    };
    const dataMap = {
      __metric_0__: { "2026-09-01": { value: 50 } },
      __metric_1__: { "2026-09-01": { value: 7 } },
    };
    // The axis reaches past the current window for a longer comparison window.
    const xValues = ["2026-09-01", "2026-09-02", "2026-09-03"];
    fillPopulationSeriesGaps(
      dataMap,
      getPopulationSeriesKeys(seriesMeta, renderOpts),
      xValues,
    );
    const series = buildExplorerChartComparisonSeriesList({
      chartType: "line",
      sourceDataMap: dataMap,
      sourceSeriesMeta: seriesMeta,
      sourceSeriesKeys: ["__metric_0__", "__metric_1__"],
      sourceSortedXValues: xValues,
      numMetrics: 2,
      numDimensions: 1,
      isStacked: false,
      compareOverlayActive: true,
      comparisonPeriodLabels: null,
      seriesColor: () => "#000",
      comparisonSeriesColor: () => "#000",
      animate: false,
    }) as { data: { value: [number, number | null] }[] }[];
    expect(series[0].data.map((d) => d.value[1])).toEqual([50, null, null]);
    // Counts keep reading 0 there.
    expect(series[1].data.map((d) => d.value[1])).toEqual([7, 0, 0]);
  });
});

describe("compareBarFramePx", () => {
  it("rounds a share of the bar width", () => {
    expect(compareBarFramePx(50, 2, 20, 0.15)).toBe(8);
    expect(compareBarFramePx(30, 2, 20, 0.15)).toBe(5);
  });

  it("keeps the frame within the limits", () => {
    expect(compareBarFramePx(4, 2, 20, 0.15)).toBe(2);
    expect(compareBarFramePx(500, 2, 20, 0.15)).toBe(20);
  });
});
