import type {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import { comparisonMode, dateRangePredefined } from "shared/validators";
import {
  buildAlignedComparisonRowLookup,
  buildComparisonDateRange,
  buildComparisonDateRangeForMode,
  buildComparisonExplorationConfig,
  buildFixedSpanComparisonOptions,
  buildFixedSpanRangeEndingBeforeAnchor,
  buildFixedSpanRangeStartingAtAnchor,
  calculateProductAnalyticsDateRange,
  comparisonModeOverlapsPrimary,
  computeExplorationComparisonPayload,
  createComparisonAlignmentResolver,
  densifyComparisonExplorationTimeseries,
  enumerateProductAnalyticsDateBuckets,
  explorerDimensionDateToUtcYyyyMmDd,
  extendDateBucketsForward,
  getComparisonAlignmentStrategy,
  getComparisonShiftDays,
  getDateGranularity,
  getInclusiveUtcCalendarDayCount,
  getOverlappingComparisonModes,
  isPositiveLookbackValue,
  isUtcYyyyMmDdWithinInclusiveRange,
  productAnalyticsDateDimensionBucketMergeKey,
  resolveBlockComparison,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
  resolveLegacyExplorerComparisonMode,
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

const customRange = (
  startDate: string,
  endDate: string,
): ExplorationDateRange => ({
  predefined: "customDateRange",
  lookbackValue: null,
  lookbackUnit: null,
  startDate,
  endDate,
});

const utcWeekday = (yyyyMmDd: string) =>
  new Date(`${yyyyMmDd}T00:00:00.000Z`).getUTCDay();

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

  it("re-derives for a named mode even when a stale window is persisted", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
    const out = resolveComparisonPreviousTimeFrame(predefined, {
      mode: "previousPeriod",
      previousTimeFrame: customRange("2020-01-01", "2020-01-31"),
    });
    expect(out.startDate).toBe("2024-05-31");
    expect(out.endDate).toBe("2024-06-07");
  });

  it("derives (and rolls) a previousYear window", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
    const out = resolveComparisonPreviousTimeFrame(predefined, {
      mode: "previousYear",
    });
    expect(out.startDate).toBe("2023-06-08");
    expect(out.endDate).toBe("2023-06-15");
  });
});

describe("calculateProductAnalyticsDateRange presets", () => {
  const preset = (
    predefined: (typeof dateRangePredefined)[number],
  ): ExplorationDateRange => ({
    predefined,
    lookbackValue: null,
    lookbackUnit: null,
    startDate: null,
    endDate: null,
  });

  const utc = (d: Date) => d.toISOString();

  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
  });

  it("bounds yesterday to a complete UTC day", () => {
    const out = calculateProductAnalyticsDateRange(preset("yesterday"));
    expect(utc(out.startDate)).toBe("2024-06-14T00:00:00.000Z");
    expect(utc(out.endDate)).toBe("2024-06-14T23:59:59.999Z");
  });

  it("leaves today open-ended at now, unlike yesterday", () => {
    const out = calculateProductAnalyticsDateRange(preset("today"));
    expect(utc(out.startDate)).toBe("2024-06-15T00:00:00.000Z");
    expect(utc(out.endDate)).toBe("2024-06-15T12:00:00.000Z");
  });

  it("shifts last12Months back twelve calendar months", () => {
    const out = calculateProductAnalyticsDateRange(preset("last12Months"));
    expect(utc(out.startDate)).toBe("2023-06-15T12:00:00.000Z");
    expect(utc(out.endDate)).toBe("2024-06-15T12:00:00.000Z");
  });

  it("pins lastCalendarYear to the whole prior year", () => {
    const out = calculateProductAnalyticsDateRange(preset("lastCalendarYear"));
    expect(utc(out.startDate)).toBe("2023-01-01T00:00:00.000Z");
    expect(utc(out.endDate)).toBe("2023-12-31T23:59:59.999Z");
  });

  it("keeps lastCalendarYear fixed as the clock advances within the year", () => {
    const before = calculateProductAnalyticsDateRange(
      preset("lastCalendarYear"),
    );
    jest.setSystemTime(new Date("2024-11-30T09:00:00.000Z"));
    const after = calculateProductAnalyticsDateRange(
      preset("lastCalendarYear"),
    );
    expect(after).toEqual(before);
  });

  it("rolls lastCalendarYear when the year turns over", () => {
    jest.setSystemTime(new Date("2025-01-02T00:00:00.000Z"));
    const out = calculateProductAnalyticsDateRange(preset("lastCalendarYear"));
    expect(utc(out.startDate)).toBe("2024-01-01T00:00:00.000Z");
    expect(utc(out.endDate)).toBe("2024-12-31T23:59:59.999Z");
  });

  it("derives a comparison window for every new preset and mode", () => {
    for (const predefined of [
      "yesterday",
      "last12Months",
      "lastCalendarYear",
    ] as const) {
      for (const mode of comparisonMode) {
        if (mode === "custom") continue;
        const out = buildComparisonDateRangeForMode(preset(predefined), mode);
        expect(out.predefined).toBe("customDateRange");
        expect(out.startDate).toBeTruthy();
        expect(out.endDate).toBeTruthy();
        expect(
          getInclusiveUtcCalendarDayCount(
            out.startDate as string,
            out.endDate as string,
          ),
        ).toBeGreaterThan(0);
      }
    }
  });

  it("maps yesterday's previousPeriod to the day before", () => {
    const out = buildComparisonDateRangeForMode(
      preset("yesterday"),
      "previousPeriod",
    );
    expect(out.startDate).toBe("2024-06-13");
    expect(out.endDate).toBe("2024-06-13");
  });

  it("maps lastCalendarYear's previousPeriod to the year before it", () => {
    const out = buildComparisonDateRangeForMode(
      preset("lastCalendarYear"),
      "previousPeriod",
    );
    // 2023 spans 365 days, so the contiguous prior window ends 2022-12-31.
    expect(out.startDate).toBe("2022-01-01");
    expect(out.endDate).toBe("2022-12-31");
  });

  it("maps lastCalendarYear's previousYear to the same calendar year back", () => {
    const out = buildComparisonDateRangeForMode(
      preset("lastCalendarYear"),
      "previousYear",
    );
    expect(out.startDate).toBe("2022-01-01");
    expect(out.endDate).toBe("2022-12-31");
  });

  describe("customLookback with a non-positive value", () => {
    const lookback = (lookbackValue: number | null): ExplorationDateRange => ({
      predefined: "customLookback",
      lookbackValue,
      lookbackUnit: "day",
      startDate: null,
      endDate: null,
    });

    // The 30-day default, which absent values already resolved to.
    const defaultStart = "2024-05-16T12:00:00.000Z";

    it("treats zero as absent rather than a zero-length window", () => {
      expect(
        utc(calculateProductAnalyticsDateRange(lookback(0)).startDate),
      ).toBe(defaultStart);
    });

    it("never resolves a start date after the end date", () => {
      // A negative value used to be subtracted verbatim, putting the start of
      // the window in the future.
      const out = calculateProductAnalyticsDateRange(lookback(-5));
      expect(out.startDate.getTime()).toBeLessThan(out.endDate.getTime());
      expect(utc(out.startDate)).toBe(defaultStart);
    });

    it("still honours a positive value", () => {
      expect(
        utc(calculateProductAnalyticsDateRange(lookback(5)).startDate),
      ).toBe("2024-06-10T12:00:00.000Z");
    });
  });
});

describe("isPositiveLookbackValue", () => {
  it("accepts only positive finite numbers", () => {
    expect(isPositiveLookbackValue(1)).toBe(true);
    expect(isPositiveLookbackValue(0.5)).toBe(true);
    expect(isPositiveLookbackValue(0)).toBe(false);
    expect(isPositiveLookbackValue(-1)).toBe(false);
    expect(isPositiveLookbackValue(NaN)).toBe(false);
    expect(isPositiveLookbackValue(Infinity)).toBe(false);
    expect(isPositiveLookbackValue(null)).toBe(false);
    expect(isPositiveLookbackValue(undefined)).toBe(false);
  });
});

describe("resolveComparisonMode", () => {
  it("defaults to previousPeriod when nothing is persisted", () => {
    expect(resolveComparisonMode({})).toBe("previousPeriod");
  });

  it("reads a legacy persisted window as a custom mode", () => {
    expect(
      resolveComparisonMode({
        previousTimeFrame: customRange("2024-01-01", "2024-01-31"),
      }),
    ).toBe("custom");
  });

  it("prefers an explicit mode over a persisted window", () => {
    expect(
      resolveComparisonMode({
        mode: "previousYear",
        previousTimeFrame: customRange("2024-01-01", "2024-01-31"),
      }),
    ).toBe("previousYear");
  });
});

describe("resolveLegacyExplorerComparisonMode", () => {
  it("treats a custom primary as a hand-picked window", () => {
    expect(
      resolveLegacyExplorerComparisonMode(
        customRange("2024-01-01", "2024-01-31"),
      ),
    ).toBe("custom");
  });

  it("treats rolling presets as previousPeriod", () => {
    for (const preset of ["today", "last7Days", "last30Days"] as const) {
      expect(
        resolveLegacyExplorerComparisonMode({
          predefined: preset,
          lookbackValue: null,
          lookbackUnit: null,
          startDate: null,
          endDate: null,
        }),
      ).toBe("previousPeriod");
    }
  });
});

describe("getComparisonShiftDays", () => {
  it("shifts previousPeriod by the primary's own span", () => {
    expect(getComparisonShiftDays("previousPeriod", 1)).toBe(1);
    expect(getComparisonShiftDays("previousPeriod", 7)).toBe(7);
    expect(getComparisonShiftDays("previousPeriod", 30)).toBe(30);
  });

  it("rounds the weekday-matching shift up to whole weeks", () => {
    expect(getComparisonShiftDays("previousPeriodMatchDayOfWeek", 7)).toBe(7);
    // Rounding down to 7 would land the previous end on the primary's start day.
    expect(getComparisonShiftDays("previousPeriodMatchDayOfWeek", 8)).toBe(14);
    expect(getComparisonShiftDays("previousPeriodMatchDayOfWeek", 30)).toBe(35);
    expect(getComparisonShiftDays("previousPeriodMatchDayOfWeek", 1)).toBe(7);
  });

  it("uses a fixed 52 weeks for the weekday-matching year mode", () => {
    for (const span of [1, 7, 8, 30]) {
      expect(getComparisonShiftDays("previousYearMatchDayOfWeek", span)).toBe(
        364,
      );
    }
  });
});

describe("buildComparisonDateRangeForMode", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps a whole-week primary contiguous and weekday-aligned", () => {
    // Mon 2024-06-03 → Sun 2024-06-09.
    const out = buildComparisonDateRangeForMode(
      customRange("2024-06-03", "2024-06-09"),
      "previousPeriodMatchDayOfWeek",
    );
    expect(out.startDate).toBe("2024-05-27");
    expect(out.endDate).toBe("2024-06-02");
    expect(utcWeekday("2024-05-27")).toBe(utcWeekday("2024-06-03"));
  });

  it("prefers a gap over an overlap for a non-week-multiple primary", () => {
    const primary = customRange("2024-06-01", "2024-06-10");
    const out = buildComparisonDateRangeForMode(
      primary,
      "previousPeriodMatchDayOfWeek",
    );
    expect(out.startDate).toBe("2024-05-18");
    expect(out.endDate).toBe("2024-05-27");
    expect(utcWeekday("2024-05-18")).toBe(utcWeekday("2024-06-01"));
    // Equal length, same weekday, and strictly before the primary.
    expect(
      getInclusiveUtcCalendarDayCount(
        out.startDate as string,
        out.endDate as string,
      ),
    ).toBe(10);
    expect(out.endDate! < primary.startDate!).toBe(true);
  });

  it("weekday-aligns a rolling preset across its partial current day", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
    const out = buildComparisonDateRangeForMode(
      {
        predefined: "last7Days",
        lookbackValue: null,
        lookbackUnit: null,
        startDate: null,
        endDate: null,
      },
      "previousPeriodMatchDayOfWeek",
    );
    // last7Days touches 8 UTC days, so the shift is 14, not 7.
    expect(out.startDate).toBe("2024-05-25");
    expect(out.endDate).toBe("2024-06-01");
    expect(utcWeekday("2024-05-25")).toBe(utcWeekday("2024-06-08"));
  });

  it("maps previousYear to the same calendar dates", () => {
    const out = buildComparisonDateRangeForMode(
      customRange("2024-03-01", "2024-03-31"),
      "previousYear",
    );
    expect(out.startDate).toBe("2023-03-01");
    expect(out.endDate).toBe("2023-03-31");
  });

  it("clamps a leap day back to Feb 28, shortening the window by a day", () => {
    const out = buildComparisonDateRangeForMode(
      customRange("2024-02-01", "2024-02-29"),
      "previousYear",
    );
    expect(out.startDate).toBe("2023-02-01");
    expect(out.endDate).toBe("2023-02-28");
    expect(
      getInclusiveUtcCalendarDayCount(
        out.startDate as string,
        out.endDate as string,
      ),
    ).toBe(28);
    expect(getInclusiveUtcCalendarDayCount("2024-02-01", "2024-02-29")).toBe(
      29,
    );
  });

  it("clamps a single leap day primary", () => {
    const out = buildComparisonDateRangeForMode(
      customRange("2024-02-29", "2024-02-29"),
      "previousYear",
    );
    expect(out.startDate).toBe("2023-02-28");
    expect(out.endDate).toBe("2023-02-28");
  });

  it("overlaps the primary when previousYear spans more than a year", () => {
    // Documented trade-off: "same calendar dates" wins over avoiding overlap,
    // so callers disable this mode in the UI for long ranges.
    const primary = customRange("2023-01-01", "2024-02-04");
    const out = buildComparisonDateRangeForMode(primary, "previousYear");
    expect(out.startDate).toBe("2022-01-01");
    expect(out.endDate).toBe("2023-02-04");
    expect(out.endDate! >= primary.startDate!).toBe(true);
  });

  it("shifts previousYearMatchDayOfWeek exactly 52 weeks", () => {
    const out = buildComparisonDateRangeForMode(
      customRange("2024-06-03", "2024-06-09"),
      "previousYearMatchDayOfWeek",
    );
    expect(out.startDate).toBe("2023-06-05");
    expect(out.endDate).toBe("2023-06-11");
    expect(utcWeekday("2023-06-05")).toBe(utcWeekday("2024-06-03"));
  });

  it("keeps the 52-week shift exact across a leap boundary", () => {
    const out = buildComparisonDateRangeForMode(
      customRange("2024-03-04", "2024-03-10"),
      "previousYearMatchDayOfWeek",
    );
    expect(out.startDate).toBe("2023-03-06");
    expect(utcWeekday("2023-03-06")).toBe(utcWeekday("2024-03-04"));
    expect(
      (new Date("2024-03-04T00:00:00.000Z").getTime() -
        new Date("2023-03-06T00:00:00.000Z").getTime()) /
        86_400_000,
    ).toBe(364);
  });

  it("returns an explicit custom window verbatim", () => {
    const fixed = customRange("2020-05-01", "2020-05-31");
    expect(
      buildComparisonDateRangeForMode(
        customRange("2024-06-01", "2024-06-30"),
        "custom",
        fixed,
      ),
    ).toEqual(fixed);
  });

  it("falls back to previousPeriod for a custom mode with no window yet", () => {
    const out = buildComparisonDateRangeForMode(
      customRange("2024-06-01", "2024-06-10"),
      "custom",
      null,
    );
    expect(out.startDate).toBe("2024-05-22");
    expect(out.endDate).toBe("2024-05-31");
  });

  it("emits a fully-bounded customDateRange and preserves lookback for every derived mode", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
    const primary: ExplorationDateRange = {
      predefined: "customLookback",
      lookbackValue: 45,
      lookbackUnit: "day",
      startDate: null,
      endDate: null,
    };
    for (const mode of comparisonMode) {
      if (mode === "custom") continue;
      const out = buildComparisonDateRangeForMode(primary, mode);
      expect(out.predefined).toBe("customDateRange");
      expect(out.startDate).toBeTruthy();
      expect(out.endDate).toBeTruthy();
      expect(out.lookbackValue).toBe(45);
      expect(out.lookbackUnit).toBe("day");
    }
  });
});

describe("comparisonModeOverlapsPrimary", () => {
  it("reports no overlap for the day-delta modes at any span", () => {
    // They shift by at least their own span, so overlap is structural.
    for (const span of [1, 30, 365, 400, 1000]) {
      const primary = customRange(
        "2024-01-01",
        buildFixedSpanRangeStartingAtAnchor("2024-01-01", span).endDate,
      );
      expect(comparisonModeOverlapsPrimary(primary, "previousPeriod")).toBe(
        false,
      );
      expect(
        comparisonModeOverlapsPrimary(primary, "previousPeriodMatchDayOfWeek"),
      ).toBe(false);
    }
  });

  it("flags previousYearMatchDayOfWeek past its fixed 364-day shift", () => {
    // 364 days inclusive is the last span the 364-day shift clears.
    const exact = customRange(
      "2023-01-01",
      buildFixedSpanRangeStartingAtAnchor("2023-01-01", 364).endDate,
    );
    expect(
      comparisonModeOverlapsPrimary(exact, "previousYearMatchDayOfWeek"),
    ).toBe(false);

    const oneDayLonger = customRange(
      "2023-01-01",
      buildFixedSpanRangeStartingAtAnchor("2023-01-01", 365).endDate,
    );
    expect(
      comparisonModeOverlapsPrimary(oneDayLonger, "previousYearMatchDayOfWeek"),
    ).toBe(true);
  });

  it("flags previousYear only past a calendar year, leap year included", () => {
    expect(
      comparisonModeOverlapsPrimary(
        customRange("2023-06-01", "2024-05-31"),
        "previousYear",
      ),
    ).toBe(false);
    expect(
      comparisonModeOverlapsPrimary(
        customRange("2023-06-01", "2024-06-01"),
        "previousYear",
      ),
    ).toBe(true);
  });

  it("never flags custom, whose window is hand-picked", () => {
    expect(
      comparisonModeOverlapsPrimary(
        customRange("2024-01-01", "2025-12-31"),
        "custom",
      ),
    ).toBe(false);
  });
});

describe("getOverlappingComparisonModes", () => {
  it("returns nothing for a short range", () => {
    expect(
      getOverlappingComparisonModes(customRange("2024-06-01", "2024-06-30")),
    ).toEqual([]);
  });

  it("returns both year modes for a range spanning more than a year", () => {
    // Regression: only `previousYear` used to be guarded, so the weekday
    // variant stayed selectable and silently overlapped the primary.
    expect(
      getOverlappingComparisonModes(customRange("2023-01-01", "2024-06-30")),
    ).toEqual(["previousYear", "previousYearMatchDayOfWeek"]);
  });

  it("returns only the weekday year mode between 365 and a calendar year", () => {
    const primary = customRange(
      "2023-01-01",
      buildFixedSpanRangeStartingAtAnchor("2023-01-01", 365).endDate,
    );
    expect(getOverlappingComparisonModes(primary)).toEqual([
      "previousYearMatchDayOfWeek",
    ]);
  });

  it("agrees with the derived window for every mode", () => {
    const primary = customRange("2023-01-01", "2024-06-30");
    const overlapping = getOverlappingComparisonModes(primary);
    for (const mode of comparisonMode) {
      if (mode === "custom") continue;
      const out = buildComparisonDateRangeForMode(primary, mode);
      expect(overlapping.includes(mode)).toBe(
        out.endDate! >= primary.startDate!,
      );
    }
  });
});

describe("getComparisonAlignmentStrategy", () => {
  it("pairs only exact-calendar modes by calendar date", () => {
    expect(getComparisonAlignmentStrategy("previousYear")).toBe(
      "calendarYearOverYear",
    );
    expect(getComparisonAlignmentStrategy("custom")).toBe(
      "calendarYearOverYear",
    );
  });

  it("pairs shifted modes chronologically", () => {
    expect(getComparisonAlignmentStrategy("previousPeriod")).toBe(
      "chronological",
    );
    expect(getComparisonAlignmentStrategy("previousPeriodMatchDayOfWeek")).toBe(
      "chronological",
    );
    expect(getComparisonAlignmentStrategy("previousYearMatchDayOfWeek")).toBe(
      "chronological",
    );
  });

  it("covers every mode", () => {
    for (const mode of comparisonMode) {
      expect(getComparisonAlignmentStrategy(mode)).toBeDefined();
    }
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

  // A 364-day shift lands the calendar-year probe *inside* the comparison
  // window but on the wrong bucket, which is why the strategy is mode-derived
  // rather than always calendar-first.
  const shiftedPrimary = ["2024-06-13", "2024-06-14", "2024-06-15"];
  const shiftedComparison = ["2023-06-15", "2023-06-16", "2023-06-17"];

  it("pairs a 52-week-shifted window by rank under chronological", () => {
    const resolver = createComparisonAlignmentResolver(
      shiftedPrimary,
      shiftedComparison,
      true,
      "chronological",
    );
    expect(resolver("2024-06-13")).toBe("2023-06-15");
    expect(resolver("2024-06-14")).toBe("2023-06-16");
    expect(resolver("2024-06-15")).toBe("2023-06-17");
  });

  it("mispairs a 52-week-shifted window under calendarYearOverYear", () => {
    const resolver = createComparisonAlignmentResolver(
      shiftedPrimary,
      shiftedComparison,
      true,
      "calendarYearOverYear",
    );
    // 2023-06-15 is in-window, so the calendar probe wins and silently skews
    // the last bucket by two days.
    expect(resolver("2024-06-15")).toBe("2023-06-15");
  });

  it("maps Feb 28 and Feb 29 to the same previousYear bucket", () => {
    const resolver = createComparisonAlignmentResolver(
      ["2024-02-28", "2024-02-29"],
      ["2023-02-27", "2023-02-28"],
      true,
      "calendarYearOverYear",
    );
    expect(resolver("2024-02-28")).toBe("2023-02-28");
    expect(resolver("2024-02-29")).toBe("2023-02-28");
  });

  // Only a `custom` comparison can differ in length from the primary; the
  // derived modes are equal-length by construction (bar the leap-day clamp).
  describe("unequal-length windows", () => {
    const sevenDays = [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
    ];
    const fiveDays = [
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
    ];

    it("pairs a shorter comparison from the start and leaves the tail unmatched", () => {
      const resolver = createComparisonAlignmentResolver(
        sevenDays,
        fiveDays,
        true,
        "chronological",
      );
      expect(resolver("2026-07-01")).toBe("2026-06-01");
      expect(resolver("2026-07-05")).toBe("2026-06-05");
      // Nothing left to pair with — the last two current days have no counterpart.
      expect(resolver("2026-07-06")).toBeUndefined();
      expect(resolver("2026-07-07")).toBeUndefined();
    });

    it("ignores the surplus tail of a longer comparison", () => {
      const resolver = createComparisonAlignmentResolver(
        fiveDays,
        sevenDays,
        true,
        "chronological",
      );
      expect(resolver("2026-06-01")).toBe("2026-07-01");
      expect(resolver("2026-06-05")).toBe("2026-07-05");
      // 2026-07-06 and -07 are simply never returned.
      const paired = fiveDays.map((d) => resolver(d));
      expect(paired).not.toContain("2026-07-06");
      expect(paired).not.toContain("2026-07-07");
    });

    it("aligns the same way under the calendar strategy when no YoY match exists", () => {
      const resolver = createComparisonAlignmentResolver(
        sevenDays,
        fiveDays,
        true,
        "calendarYearOverYear",
      );
      expect(resolver("2026-07-01")).toBe("2026-06-01");
      expect(resolver("2026-07-06")).toBeUndefined();
    });
  });
});

describe("buildComparisonExplorationConfig", () => {
  const dateConfig = (
    dateGranularity: "auto" | "week",
    dateRange: ExplorationDateRange,
  ): ExplorationConfig => ({
    type: "metric",
    datasource: "ds",
    dimensions: [{ dimensionType: "date", column: "d", dateGranularity }],
    chartType: "line",
    dateRange,
    dataset: { type: "metric", values: [] },
  });

  // 64 inclusive days resolves to "month"; the leap-shortened 63-day previous
  // window resolves to "day" on its own.
  const primaryRange = customRange("2024-01-01", "2024-03-04");
  const previousYearRange = customRange("2023-01-01", "2023-03-04");

  it("pins an auto granularity to the primary's resolved value", () => {
    expect(
      getDateGranularity(
        "auto",
        calculateProductAnalyticsDateRange(previousYearRange),
      ),
    ).toBe("day");

    const out = buildComparisonExplorationConfig(
      dateConfig("auto", primaryRange),
      previousYearRange,
    );
    expect(out.dimensions[0]).toMatchObject({ dateGranularity: "month" });
    expect(out.dateRange).toEqual(previousYearRange);
  });

  it("leaves an explicit granularity untouched", () => {
    const out = buildComparisonExplorationConfig(
      dateConfig("week", primaryRange),
      previousYearRange,
    );
    expect(out.dimensions[0]).toMatchObject({ dateGranularity: "week" });
  });

  it("only swaps the date range when the first dimension is not a date", () => {
    const config: ExplorationConfig = {
      type: "metric",
      datasource: "ds",
      dimensions: [
        { dimensionType: "dynamic", column: "browser", maxValues: 5 },
      ],
      chartType: "bar",
      dateRange: primaryRange,
      dataset: { type: "metric", values: [] },
    };
    const out = buildComparisonExplorationConfig(config, previousYearRange);
    expect(out.dimensions).toEqual(config.dimensions);
    expect(out.dateRange).toEqual(previousYearRange);
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

describe("extendDateBucketsForward", () => {
  it("continues a daily cadence", () => {
    expect(
      extendDateBucketsForward({
        resolvedGranularity: "day",
        afterIso: "2026-07-05T00:00:00.000Z",
        count: 2,
      }),
    ).toEqual(["2026-07-06T00:00:00.000Z", "2026-07-07T00:00:00.000Z"]);
  });

  it("continues a weekly cadence on Monday boundaries", () => {
    expect(
      extendDateBucketsForward({
        resolvedGranularity: "week",
        afterIso: "2026-07-06T00:00:00.000Z",
        count: 2,
      }),
    ).toEqual(["2026-07-13T00:00:00.000Z", "2026-07-20T00:00:00.000Z"]);
  });

  it("continues a monthly cadence across a year boundary", () => {
    expect(
      extendDateBucketsForward({
        resolvedGranularity: "month",
        afterIso: "2026-11-01T00:00:00.000Z",
        count: 3,
      }),
    ).toEqual([
      "2026-12-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
      "2027-02-01T00:00:00.000Z",
    ]);
  });

  it("returns nothing for a non-positive count", () => {
    const args = {
      resolvedGranularity: "day" as const,
      afterIso: "2026-07-05T00:00:00.000Z",
    };
    expect(extendDateBucketsForward({ ...args, count: 0 })).toEqual([]);
    expect(extendDateBucketsForward({ ...args, count: -3 })).toEqual([]);
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
