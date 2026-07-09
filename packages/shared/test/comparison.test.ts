import type {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import {
  buildAlignedComparisonRowLookup,
  buildComparisonDateRange,
  buildFixedSpanComparisonOptions,
  buildFixedSpanRangeEndingBeforeAnchor,
  buildFixedSpanRangeStartingAtAnchor,
  calculateProductAnalyticsDateRange,
  computeExplorationComparisonPayload,
  createComparisonAlignmentResolver,
  densifyComparisonExplorationTimeseries,
  enumerateProductAnalyticsDateBuckets,
  explorerDimensionDateToUtcYyyyMmDd,
  getDateGranularity,
  getInclusiveUtcCalendarDayCount,
  isUtcYyyyMmDdWithinInclusiveRange,
  productAnalyticsDateDimensionBucketMergeKey,
  resolveBlockComparison,
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import type { FactMetricInterface } from "shared/types/fact-table";

const meanMetric = {
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
} as unknown as FactMetricInterface;

const ratioMetric = {
  ...meanMetric,
  name: "Ratio",
  metricType: "ratio",
  denominator: {
    factTableId: "ft",
    column: "d",
    aggregation: "sum",
    rowFilters: [],
  },
} as unknown as FactMetricInterface;

const getFactMetricById = (id: string) => (id === "m1" ? meanMetric : null);

describe("buildComparisonDateRange", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shifts last7Days to the contiguous prior window", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));

    const out = buildComparisonDateRange({
      predefined: "last7Days",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: null,
      endDate: null,
    });

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2024-05-31");
    expect(out.endDate).toBe("2024-06-07");
  });

  it("shifts last30Days to the contiguous prior window", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));

    const out = buildComparisonDateRange({
      predefined: "last30Days",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: null,
      endDate: null,
    });

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2024-04-15");
    expect(out.endDate).toBe("2024-05-15");
  });

  it("shifts custom lookback by one span", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));

    const out = buildComparisonDateRange({
      predefined: "customLookback",
      lookbackValue: 90,
      lookbackUnit: "day",
      startDate: null,
      endDate: null,
    });

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2023-12-17");
    expect(out.endDate).toBe("2024-03-16");
    expect(out.lookbackValue).toBe(90);
    expect(out.lookbackUnit).toBe("day");
  });

  it("maps today to previous UTC calendar day", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));

    const out = buildComparisonDateRange({
      predefined: "today",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: null,
      endDate: null,
    });

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2024-06-14");
    expect(out.endDate).toBe("2024-06-14");
  });

  it("maps customDateRange to the contiguous prior window (equal inclusive UTC days)", () => {
    const dr: ExplorationConfig["dateRange"] = {
      predefined: "customDateRange",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    };

    const out = buildComparisonDateRange(dr);

    expect(out.predefined).toBe("customDateRange");
    expect(out.startDate).toBe("2025-11-30");
    expect(out.endDate).toBe("2025-12-31");
  });

  it("uses abutting prior range for customDateRange (Feb 1–5 → Jan 27–31)", () => {
    const dr: ExplorationConfig["dateRange"] = {
      predefined: "customDateRange",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: "2026-02-01",
      endDate: "2026-02-05",
    };

    const out = buildComparisonDateRange(dr);

    expect(out.startDate).toBe("2026-01-27");
    expect(out.endDate).toBe("2026-01-31");
  });

  it("preserves lookback from customDateRange when using contiguous prior window", () => {
    const dr: ExplorationConfig["dateRange"] = {
      predefined: "customDateRange",
      lookbackValue: 30,
      lookbackUnit: "day",
      startDate: "2026-05-13",
      endDate: "2026-05-22",
    };

    const out = buildComparisonDateRange(dr);

    expect(out.predefined).toBe("customDateRange");
    expect(out.lookbackValue).toBe(30);
    expect(out.lookbackUnit).toBe("day");
    expect(out.startDate).toBe("2026-05-03");
    expect(out.endDate).toBe("2026-05-12");
  });
});

describe("resolveComparisonPreviousTimeFrame", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  const predefined: ExplorationDateRange = {
    predefined: "last7Days",
    lookbackValue: null,
    lookbackUnit: null,
    startDate: null,
    endDate: null,
  };

  it("derives (and rolls) the previous window for predefined ranges", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
    const out = resolveComparisonPreviousTimeFrame(predefined, {});
    expect(out.startDate).toBe("2024-05-31");
    expect(out.endDate).toBe("2024-06-07");

    // A day later the derived window has rolled forward.
    jest.setSystemTime(new Date("2024-06-16T12:00:00.000Z"));
    const next = resolveComparisonPreviousTimeFrame(predefined, {});
    expect(next.startDate).toBe("2024-06-01");
    expect(next.endDate).toBe("2024-06-08");
  });

  it("uses an explicit previousTimeFrame as-is (fixed window)", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
    const fixed: ExplorationDateRange = {
      predefined: "customDateRange",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    };
    const out = resolveComparisonPreviousTimeFrame(predefined, {
      previousTimeFrame: fixed,
    });
    expect(out).toEqual(fixed);
  });
});

describe("resolveBlockComparison", () => {
  const enabled = { enabled: true };
  const disabled = { enabled: false };

  it("returns the block comparison when enabled", () => {
    expect(resolveBlockComparison({ comparison: enabled })).toEqual(enabled);
  });

  it("returns null when disabled or unset", () => {
    expect(resolveBlockComparison({ comparison: disabled })).toBeNull();
    expect(resolveBlockComparison({})).toBeNull();
  });

  it("lets a dashboard-wide comparison override the block (forward-compat)", () => {
    const dashboardCmp = {
      enabled: true,
      previousTimeFrame: {
        predefined: "customDateRange" as const,
        lookbackValue: null,
        lookbackUnit: null,
        startDate: "2024-01-01",
        endDate: "2024-01-31",
      },
    };
    expect(
      resolveBlockComparison(
        { comparison: disabled },
        { comparison: dashboardCmp },
      ),
    ).toEqual(dashboardCmp);
  });
});

describe("fixed-span comparison options", () => {
  it("builds before/after options for anchor Apr 1 with 9-day primary span", () => {
    const n = getInclusiveUtcCalendarDayCount("2026-03-01", "2026-03-09");
    expect(n).toBe(9);

    const { before, after } = buildFixedSpanComparisonOptions("2026-04-01", n);

    expect(before).toEqual({ startDate: "2026-03-23", endDate: "2026-03-31" });
    expect(after).toEqual({ startDate: "2026-04-01", endDate: "2026-04-09" });
  });

  it("buildFixedSpanRangeEndingBeforeAnchor matches contiguous-prior shape", () => {
    expect(buildFixedSpanRangeEndingBeforeAnchor("2026-04-01", 9)).toEqual({
      startDate: "2026-03-23",
      endDate: "2026-03-31",
    });
  });

  it("buildFixedSpanRangeStartingAtAnchor spans forward from anchor", () => {
    expect(buildFixedSpanRangeStartingAtAnchor("2026-04-01", 9)).toEqual({
      startDate: "2026-04-01",
      endDate: "2026-04-09",
    });
  });

  it("isUtcYyyyMmDdWithinInclusiveRange uses inclusive UTC bounds", () => {
    expect(
      isUtcYyyyMmDdWithinInclusiveRange(
        "2026-04-05",
        "2026-04-01",
        "2026-04-09",
      ),
    ).toBe(true);
    expect(
      isUtcYyyyMmDdWithinInclusiveRange(
        "2026-03-31",
        "2026-04-01",
        "2026-04-09",
      ),
    ).toBe(false);
  });
});

describe("explorerDimensionDateToUtcYyyyMmDd", () => {
  it("normalizes date-only and ISO-with-time to the same UTC calendar day", () => {
    expect(explorerDimensionDateToUtcYyyyMmDd("2024-06-01")).toBe(
      explorerDimensionDateToUtcYyyyMmDd("2024-06-01T18:30:00.000Z"),
    );
  });
});

describe("buildAlignedComparisonRowLookup", () => {
  const row = (
    dims: (string | null)[],
    n: number,
  ): ProductAnalyticsResultRow => ({
    dimensions: dims,
    values: [
      {
        metricId: "m1",
        numerator: n,
        denominator: null,
      },
    ],
  });

  it("pairs sparse primary rows to YoY comparison buckets when present", () => {
    const primary: ProductAnalyticsResultRow[] = [
      row(["2024-01-05"], 10),
      row(["2024-01-07"], 20),
    ];
    const comparison: ProductAnalyticsResultRow[] = [
      row(["2023-01-01T00:00:00.000Z"], 1),
      row(["2023-01-05T00:00:00.000Z"], 99),
      row(["2023-01-07T00:00:00.000Z"], 88),
    ];
    const lookup = buildAlignedComparisonRowLookup(primary, comparison, true);
    expect(lookup(["2024-01-05"])?.values[0]?.numerator).toBe(99);
    expect(lookup(["2024-01-07"])?.values[0]?.numerator).toBe(88);
  });

  it("falls back to chronological rank when YoY calendar bucket is missing", () => {
    const primary: ProductAnalyticsResultRow[] = [
      row(["2024-01-05"], 10),
      row(["2024-01-06"], 20),
    ];
    const comparison: ProductAnalyticsResultRow[] = [
      row(["2024-01-01"], 100),
      row(["2024-01-02"], 200),
    ];
    const lookup = buildAlignedComparisonRowLookup(primary, comparison, true);
    expect(lookup(["2024-01-05"])?.values[0]?.numerator).toBe(100);
    expect(lookup(["2024-01-06"])?.values[0]?.numerator).toBe(200);
  });

  it("pairs breakdown rows by the full dimension tuple, not just the date", () => {
    const primary: ProductAnalyticsResultRow[] = [
      row(["2024-01-01", "Chrome"], 10),
      row(["2024-01-01", "Safari"], 20),
    ];
    const comparison: ProductAnalyticsResultRow[] = [
      row(["2023-01-01T00:00:00.000Z", "Chrome"], 100),
      row(["2023-01-01T00:00:00.000Z", "Safari"], 200),
    ];
    const lookup = buildAlignedComparisonRowLookup(primary, comparison, true);
    expect(lookup(["2024-01-01", "Chrome"])?.values[0]?.numerator).toBe(100);
    expect(lookup(["2024-01-01", "Safari"])?.values[0]?.numerator).toBe(200);
  });

  it("keys non-date breakdowns by the full dimension tuple", () => {
    const primary: ProductAnalyticsResultRow[] = [
      row(["US", "Chrome"], 1),
      row(["US", "Safari"], 2),
    ];
    const comparison: ProductAnalyticsResultRow[] = [
      row(["US", "Chrome"], 10),
      row(["US", "Safari"], 20),
    ];
    const lookup = buildAlignedComparisonRowLookup(primary, comparison, false);
    expect(lookup(["US", "Chrome"])?.values[0]?.numerator).toBe(10);
    expect(lookup(["US", "Safari"])?.values[0]?.numerator).toBe(20);
  });
});

describe("createComparisonAlignmentResolver", () => {
  it("returns undefined when current key is unknown to the rank map", () => {
    const resolver = createComparisonAlignmentResolver(
      ["2024-01-01"],
      ["2023-01-01"],
      true,
    );
    expect(resolver("2099-12-31")).toBeUndefined();
  });
});

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

  describe("grouped (date + 1 breakdown)", () => {
    const groupedConfig: ExplorationConfig = {
      ...baseConfig,
      dimensions: [
        { dimensionType: "date", column: "d", dateGranularity: "day" },
        { dimensionType: "dynamic", column: "browser", maxValues: 10 },
      ],
    };
    const shortPrev: ExplorationDateRange = {
      predefined: "customDateRange",
      startDate: "2023-01-01",
      endDate: "2023-01-03",
    };

    it("zero-fills every bucket × breakdown value when the previous period is empty", () => {
      const out = densifyComparisonExplorationTimeseries({
        comparison: shellExploration([]),
        submittedConfig: groupedConfig,
        previousTimeFrame: shortPrev,
        getFactMetricById,
        primaryRows: [
          {
            dimensions: ["2024-01-01", "Chrome"],
            values: [{ metricId: "m1", numerator: 5, denominator: null }],
          },
          {
            dimensions: ["2024-01-01", "Safari"],
            values: [{ metricId: "m1", numerator: 9, denominator: null }],
          },
        ],
      });
      // 3 days × 2 breakdown values
      expect(out?.result.rows).toHaveLength(6);
      expect(out?.result.rows.every((r) => r.values[0]?.numerator === 0)).toBe(
        true,
      );
      // Both breakdown series are present.
      const browsers = new Set(out?.result.rows.map((r) => r.dimensions[1]));
      expect(browsers).toEqual(new Set(["Chrome", "Safari"]));
    });

    it("keeps existing breakdown rows and zero-fills the rest", () => {
      const out = densifyComparisonExplorationTimeseries({
        comparison: shellExploration([
          {
            dimensions: ["2023-01-02", "Chrome"],
            values: [{ metricId: "m1", numerator: 42, denominator: null }],
          },
        ]),
        submittedConfig: groupedConfig,
        previousTimeFrame: shortPrev,
        getFactMetricById,
        primaryRows: [
          {
            dimensions: ["2024-01-01", "Chrome"],
            values: [{ metricId: "m1", numerator: 5, denominator: null }],
          },
          {
            dimensions: ["2024-01-01", "Safari"],
            values: [{ metricId: "m1", numerator: 9, denominator: null }],
          },
        ],
      });
      expect(out?.result.rows).toHaveLength(6);
      const chromeJan2 = out?.result.rows.find(
        (r) =>
          r.dimensions[1] === "Chrome" &&
          productAnalyticsDateDimensionBucketMergeKey(
            r.dimensions[0] ?? "",
            "day",
          ) ===
            productAnalyticsDateDimensionBucketMergeKey(
              "2023-01-02T00:00:00.000Z",
              "day",
            ),
      );
      expect(chromeJan2?.values[0]?.numerator).toBe(42);
      const zeros = out?.result.rows.filter(
        (r) => r.values[0]?.numerator === 0,
      );
      expect(zeros).toHaveLength(5);
    });

    it("includes comparison-only breakdown values not present in the primary", () => {
      const out = densifyComparisonExplorationTimeseries({
        comparison: shellExploration([
          {
            dimensions: ["2023-01-01", "Firefox"],
            values: [{ metricId: "m1", numerator: 3, denominator: null }],
          },
        ]),
        submittedConfig: groupedConfig,
        previousTimeFrame: shortPrev,
        getFactMetricById,
        primaryRows: [
          {
            dimensions: ["2024-01-01", "Chrome"],
            values: [{ metricId: "m1", numerator: 5, denominator: null }],
          },
        ],
      });
      // 3 days × 2 breakdown values (Chrome from primary, Firefox from comparison)
      expect(out?.result.rows).toHaveLength(6);
      const browsers = new Set(out?.result.rows.map((r) => r.dimensions[1]));
      expect(browsers).toEqual(new Set(["Chrome", "Firefox"]));
    });

    it("returns no rows when there are no breakdown values in either period", () => {
      const out = densifyComparisonExplorationTimeseries({
        comparison: shellExploration([]),
        submittedConfig: groupedConfig,
        previousTimeFrame: shortPrev,
        getFactMetricById,
      });
      expect(out?.result.rows).toHaveLength(0);
    });
  });
});

describe("computeExplorationComparisonPayload", () => {
  function metricConfig(
    metricId: string,
    opts?: {
      dateGranularity?: "day" | "week" | "month";
      showAs?: "total" | "per_unit";
    },
  ): ExplorationConfig {
    return {
      type: "metric",
      datasource: "ds",
      dimensions: [
        {
          dimensionType: "date",
          column: "d",
          dateGranularity: opts?.dateGranularity ?? "day",
        },
      ],
      chartType: "line",
      dateRange: {
        predefined: "customDateRange",
        lookbackValue: null,
        lookbackUnit: null,
        startDate: "2024-01-01",
        endDate: "2024-01-07",
      },
      dataset: {
        type: "metric",
        values: [
          {
            type: "metric",
            name: "A",
            metricId,
            unit: null,
            denominatorUnit: null,
            rowFilters: [],
          },
        ],
      },
      showAs: opts?.showAs ?? "per_unit",
    };
  }

  function explorationOneRow(
    numerator: number,
    denominator: number | null,
    dimension0 = "2024-01-01",
    config: ExplorationConfig = metricConfig("m1"),
  ): ProductAnalyticsExploration {
    return {
      id: "e1",
      organization: "o",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      datasource: "ds",
      configHash: "h",
      valueHashes: [],
      config,
      result: {
        rows: [
          {
            dimensions: [dimension0],
            values: [
              {
                metricId: "m1",
                numerator,
                denominator,
              },
            ],
          },
        ],
      },
      dateStart: "2024-01-01",
      dateEnd: "2024-01-07",
      runStarted: null,
      status: "success",
      queries: [],
    };
  }

  const prevFrame: ExplorationDateRange = {
    predefined: "customDateRange",
    lookbackValue: null,
    lookbackUnit: null,
    startDate: "2023-01-01",
    endDate: "2023-01-07",
  };

  it("computes big-number percent and table trend rounded to 2 decimals", () => {
    const primary = explorationOneRow(110, 10, "2024-01-01");
    const comparison = explorationOneRow(100, 10, "2023-01-01");
    const config = metricConfig("m1");

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getFactMetricById,
    );

    expect(out.previousPeriod.startDate).toBe("2023-01-01");
    expect(out.bigNumberTrends[0]).not.toBeNull();
    const t = out.bigNumberTrends[0]!;
    expect(t.currentValue).toBeCloseTo(11, 5);
    expect(t.previousValue).toBeCloseTo(10, 5);
    expect(t.pctChangeFraction).toBeCloseTo(0.1, 5);
    expect(t.pctChangePercent).toBe(10);

    expect(out.tableTrendsByRow).toHaveLength(1);
    expect(out.tableTrendsByRow[0]["__metric_0____trend"]).toBe(10);
  });

  it("pairs sparse primary rows to YoY comparison cells for tableTrendsByRow", () => {
    const config = metricConfig("m1", { showAs: "total" });
    const primary: ProductAnalyticsExploration = {
      ...explorationOneRow(0, null, "2024-01-01", config),
      result: {
        rows: [
          {
            dimensions: ["2024-01-05"],
            values: [{ metricId: "m1", numerator: 10, denominator: null }],
          },
          {
            dimensions: ["2024-01-07"],
            values: [{ metricId: "m1", numerator: 20, denominator: null }],
          },
        ],
      },
    };
    const comparison = explorationOneRow(5, null, "2023-01-05", config);

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getFactMetricById,
    );

    expect(out.tableTrendsByRow).toHaveLength(2);
    expect(out.tableTrendsByRow[0]["__metric_0____trend"]).toBe(100);
    expect(out.tableTrendsByRow[1]["__metric_0____trend"]).toBeNull();
  });

  it("returns empty table trends when ratio metric", () => {
    const getRatioMetricById = (id: string) =>
      id === "m1" ? ratioMetric : null;

    const primary = explorationOneRow(1, 2, "2024-01-01");
    const comparison = explorationOneRow(1, 4, "2023-01-01");
    const config = metricConfig("m1");

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getRatioMetricById,
    );

    expect(out.bigNumberTrends[0]).not.toBeNull();
    expect(out.tableTrendsByRow).toEqual([]);
  });

  it("densifies empty comparison to full daily zero series for the previous window", () => {
    const config = metricConfig("m1", { showAs: "total" });
    const primary = explorationOneRow(5, null, "2024-01-01", config);
    const comparison: ProductAnalyticsExploration = {
      ...explorationOneRow(0, null, "2023-01-01", config),
      result: { rows: [] },
    };

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getFactMetricById,
    );

    expect(out.exploration?.result.rows).toHaveLength(7);
    expect(
      out.exploration?.result.rows.every((r) => r.values[0]?.numerator === 0),
    ).toBe(true);
    // Previous period is all zeros, so the percent change is undefined
    // (division by zero) and the trend must be null rather than "0% / no change".
    expect(out.bigNumberTrends[0]).toBeNull();
  });

  it("returns a null big-number trend when the previous value is zero", () => {
    const primary = explorationOneRow(50, 10, "2024-01-01");
    const comparison = explorationOneRow(0, 10, "2023-01-01");
    const config = metricConfig("m1");

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getFactMetricById,
    );

    expect(out.bigNumberTrends[0]).toBeNull();
  });

  it("pairs categorical rows by dimension key, not sort position, for tableTrendsByRow", () => {
    const config: ExplorationConfig = {
      ...metricConfig("m1", { showAs: "total" }),
      dimensions: [
        { dimensionType: "dynamic", column: "country", maxValues: 10 },
      ],
    };

    const categoricalExploration = (
      rows: { dim: string; numerator: number }[],
    ): ProductAnalyticsExploration => ({
      ...explorationOneRow(0, null, "x", config),
      config,
      result: {
        rows: rows.map((r) => ({
          dimensions: [r.dim],
          values: [
            { metricId: "m1", numerator: r.numerator, denominator: null },
          ],
        })),
      },
    });

    // Current period totals: USA (100) outranks Canada (50).
    const primary = categoricalExploration([
      { dim: "USA", numerator: 100 },
      { dim: "Canada", numerator: 50 },
    ]);
    // Previous period totals are in the opposite order: Canada (200), USA (80).
    // Positional pairing would mis-match USA->Canada; key pairing is correct.
    const comparison = categoricalExploration([
      { dim: "Canada", numerator: 200 },
      { dim: "USA", numerator: 80 },
    ]);

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getFactMetricById,
    );

    // sortedRows is ordered by current totals desc: [USA, Canada].
    expect(out.tableTrendsByRow).toHaveLength(2);
    // USA: (100 - 80) / 80 = +25%
    expect(out.tableTrendsByRow[0]["__metric_0____trend"]).toBe(25);
    // Canada: (50 - 200) / 200 = -75%
    expect(out.tableTrendsByRow[1]["__metric_0____trend"]).toBe(-75);
  });
});
