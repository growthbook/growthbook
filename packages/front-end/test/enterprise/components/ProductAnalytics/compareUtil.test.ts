import {
  alignComparisonOverlayToCategories,
  formatComparisonMetricLabel,
  getAlignedComparisonDimensionKeyForTooltip,
  parseComparisonTooltipSeriesName,
  sortProductAnalyticsTooltipAxisItems,
} from "@/enterprise/components/ProductAnalytics/compareUtil";

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
