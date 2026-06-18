import subYears from "date-fns/subYears";
import type {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
  ProductAnalyticsRunComparisonPayload,
} from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";
import { calculateProductAnalyticsDateRange, getDateGranularity } from "./sql";
import {
  buildExplorationColumns,
  getEffectiveMetricValue,
  getEffectiveShowAs,
  getExplorationCellValue,
  getIsRatioByIndex,
  sortExplorationRows,
} from "./utils";

type ResolvedGranularity = "hour" | "day" | "week" | "month" | "year";

// --- Comparison date ranges -------------------------------------------------

/** UTC calendar date as `yyyy-MM-dd` for `customDateRange` payloads. */
function dateToYyyyMmDdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC midnight for a `yyyy-MM-dd` string (calendar day in UTC). */
function utcMidnightFromYyyyMmDd(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) {
    return new Date(NaN);
  }
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/**
 * Inclusive count of UTC calendar days from `startStr` through `endStr`
 * (`yyyy-MM-dd`). Both bounds are counted.
 */
export function getInclusiveUtcCalendarDayCount(
  startStr: string,
  endStr: string,
): number {
  const a = utcMidnightFromYyyyMmDd(startStr).getTime();
  const b = utcMidnightFromYyyyMmDd(endStr).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
    return 0;
  }
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Add signed whole UTC calendar days to a `yyyy-MM-dd` string. */
function addUtcCalendarDays(yyyyMmDd: string, deltaDays: number): string {
  const d = utcMidnightFromYyyyMmDd(yyyyMmDd);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return dateToYyyyMmDdUtc(d);
}

export type FixedSpanDateBounds = {
  startDate: string;
  endDate: string;
};

/** Whether `dayStr` falls within an inclusive UTC `yyyy-MM-dd` range. */
export function isUtcYyyyMmDdWithinInclusiveRange(
  dayStr: string,
  startStr: string,
  endStr: string,
): boolean {
  return dayStr >= startStr && dayStr <= endStr;
}

/**
 * Fixed-span range of `spanInclusiveDays` UTC calendar days ending the day
 * before `anchorYyyyMmDd`.
 */
export function buildFixedSpanRangeEndingBeforeAnchor(
  anchorYyyyMmDd: string,
  spanInclusiveDays: number,
): FixedSpanDateBounds {
  const end = addUtcCalendarDays(anchorYyyyMmDd, -1);
  const start =
    spanInclusiveDays > 0
      ? addUtcCalendarDays(end, -(spanInclusiveDays - 1))
      : end;
  return { startDate: start, endDate: end };
}

/**
 * Fixed-span range of `spanInclusiveDays` UTC calendar days starting at
 * `anchorYyyyMmDd`.
 */
export function buildFixedSpanRangeStartingAtAnchor(
  anchorYyyyMmDd: string,
  spanInclusiveDays: number,
): FixedSpanDateBounds {
  const start = anchorYyyyMmDd;
  const end =
    spanInclusiveDays > 0
      ? addUtcCalendarDays(anchorYyyyMmDd, spanInclusiveDays - 1)
      : start;
  return { startDate: start, endDate: end };
}

/** Two equal-length comparison windows anchored on a calendar day. */
export function buildFixedSpanComparisonOptions(
  anchorYyyyMmDd: string,
  spanInclusiveDays: number,
): { before: FixedSpanDateBounds; after: FixedSpanDateBounds } {
  return {
    before: buildFixedSpanRangeEndingBeforeAnchor(
      anchorYyyyMmDd,
      spanInclusiveDays,
    ),
    after: buildFixedSpanRangeStartingAtAnchor(
      anchorYyyyMmDd,
      spanInclusiveDays,
    ),
  };
}

/**
 * Default comparison window for a primary `customDateRange`: the same number
 * of inclusive UTC calendar days, ending the UTC day before primary start.
 */
export function buildContiguousPreviousCustomDateRange(
  primaryStartYyyyMmDd: string,
  primaryEndYyyyMmDd: string,
  lookbackValue: number | null,
  lookbackUnit: ExplorationConfig["dateRange"]["lookbackUnit"],
): ExplorationConfig["dateRange"] {
  const n = getInclusiveUtcCalendarDayCount(
    primaryStartYyyyMmDd,
    primaryEndYyyyMmDd,
  );
  const { startDate, endDate } = buildFixedSpanRangeEndingBeforeAnchor(
    primaryStartYyyyMmDd,
    n,
  );
  return {
    predefined: "customDateRange",
    lookbackValue,
    lookbackUnit: lookbackUnit ?? null,
    startDate,
    endDate,
  };
}

/**
 * Builds a `dateRange` for the comparison (previous) period submitted as
 * `customDateRange` with fixed bounds. For a primary `customDateRange`, the
 * default is the contiguous UTC calendar window of equal inclusive length
 * immediately before the primary range.
 */
export function buildComparisonDateRange(
  dateRange: ExplorationConfig["dateRange"],
): ExplorationConfig["dateRange"] {
  const lookbackValue = dateRange.lookbackValue ?? null;
  const lookbackUnit = dateRange.lookbackUnit ?? null;

  if (
    dateRange.predefined === "customDateRange" &&
    dateRange.startDate &&
    dateRange.endDate
  ) {
    return buildContiguousPreviousCustomDateRange(
      dateRange.startDate,
      dateRange.endDate,
      lookbackValue,
      lookbackUnit,
    );
  }

  if (dateRange.predefined === "today") {
    const now = new Date();
    const yesterdayStart = new Date(now);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    yesterdayStart.setUTCHours(0, 0, 0, 0);
    const y = dateToYyyyMmDdUtc(yesterdayStart);
    return {
      predefined: "customDateRange",
      lookbackValue,
      lookbackUnit,
      startDate: y,
      endDate: y,
    };
  }

  const { startDate, endDate } = calculateProductAnalyticsDateRange(dateRange);
  const spanMs = endDate.getTime() - startDate.getTime();
  const prevStart = new Date(startDate.getTime() - spanMs);
  const prevEnd = new Date(endDate.getTime() - spanMs);

  const primaryStartDay = dateToYyyyMmDdUtc(startDate);
  let prevStartStr = dateToYyyyMmDdUtc(prevStart);
  let prevEndStr = dateToYyyyMmDdUtc(prevEnd);
  // Rolling presets use sub-day instants, but comparison is submitted as
  // `customDateRange` and expanded to full UTC calendar days. When the shifted
  // previous end truncates to the same UTC day as the primary start, the
  // expanded window would overlap the primary; end one UTC day earlier and
  // shift the start back by the same amount to preserve inclusive day count.
  if (prevEndStr === primaryStartDay) {
    prevEndStr = addUtcCalendarDays(primaryStartDay, -1);
    prevStartStr = addUtcCalendarDays(prevStartStr, -1);
  }

  return {
    predefined: "customDateRange",
    lookbackValue,
    lookbackUnit,
    startDate: prevStartStr,
    endDate: prevEndStr,
  };
}

/**
 * Resolves the previous-period date range to run for a comparison. An explicit
 * `previousTimeFrame` (a fixed/custom window) is used as-is; otherwise the
 * window is derived from the primary range via {@link buildComparisonDateRange}.
 * Since derivation resolves relative to "now", predefined primaries roll
 * forward each time this is called while custom windows stay fixed — this is
 * the single seam dashboards re-run on refresh so both periods stay current.
 */
export function resolveComparisonPreviousTimeFrame(
  primaryDateRange: ExplorationConfig["dateRange"],
  comparison: { previousTimeFrame?: ExplorationDateRange | null },
): ExplorationConfig["dateRange"] {
  return (
    comparison.previousTimeFrame ?? buildComparisonDateRange(primaryDateRange)
  );
}

// --- Current/previous row alignment -----------------------------------------

function compareDateStringsAsc(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

/** UTC calendar day `yyyy-MM-dd` for explorer dimension strings (ISO, etc.). */
export function explorerDimensionDateToUtcYyyyMmDd(key: string): string | null {
  const d = new Date(key);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Maps each current-period primary-dimension key to the comparison-period key
 * used for overlay / table pairing: YoY calendar match when present, else
 * chronological rank within the two windows.
 */
export function createComparisonAlignmentResolver(
  sortedXValues: string[],
  comparisonXValues: readonly string[],
  firstDimensionIsDate: boolean,
): (currentKey: string) => string | undefined {
  if (!firstDimensionIsDate) {
    return (currentKey) => currentKey;
  }
  const comparisonNormToOriginal = new Map<string, string>();
  for (const k of comparisonXValues) {
    const norm = explorerDimensionDateToUtcYyyyMmDd(k);
    if (norm && !comparisonNormToOriginal.has(norm)) {
      comparisonNormToOriginal.set(norm, k);
    }
  }

  const chronoCurrent = [...new Set(sortedXValues)].sort(compareDateStringsAsc);
  const chronoComp = [...new Set(comparisonXValues)].sort(
    compareDateStringsAsc,
  );
  const rankByCurrentX = new Map<string, number>();
  chronoCurrent.forEach((x, i) => {
    rankByCurrentX.set(x, i);
  });
  return (currentKey: string) => {
    const currentNorm = explorerDimensionDateToUtcYyyyMmDd(currentKey);
    if (currentNorm) {
      const shiftedNorm = subYears(new Date(`${currentNorm}T00:00:00.000Z`), 1)
        .toISOString()
        .slice(0, 10);
      const calendarMatch = comparisonNormToOriginal.get(shiftedNorm);
      if (calendarMatch !== undefined) {
        return calendarMatch;
      }
    }
    const rank = rankByCurrentX.get(currentKey);
    if (rank === undefined) return undefined;
    return chronoComp[rank];
  };
}

/**
 * Returns a lookup from current `dimensions[0]` to the aligned comparison row,
 * using the same rules as the explorer chart overlay.
 */
export function buildAlignedComparisonRowLookup(
  primaryRows: ProductAnalyticsResultRow[],
  comparisonRows: ProductAnalyticsResultRow[],
  firstDimensionIsDate: boolean,
): (currentDim0: string) => ProductAnalyticsResultRow | null {
  if (!firstDimensionIsDate) {
    const byKey = new Map<string, ProductAnalyticsResultRow>();
    for (const r of comparisonRows) {
      byKey.set(String(r.dimensions[0] ?? ""), r);
    }
    return (currentDim0) => byKey.get(currentDim0) ?? null;
  }

  const primaryKeys = primaryRows.map((r) => String(r.dimensions[0] ?? ""));
  const sortedXValues = [...new Set(primaryKeys)].sort(compareDateStringsAsc);
  const comparisonXValues = comparisonRows.map((r) =>
    String(r.dimensions[0] ?? ""),
  );
  const resolver = createComparisonAlignmentResolver(
    sortedXValues,
    comparisonXValues,
    true,
  );
  const rowByExactCompDim = new Map<string, ProductAnalyticsResultRow>();
  for (const r of comparisonRows) {
    const k = String(r.dimensions[0] ?? "");
    if (!rowByExactCompDim.has(k)) {
      rowByExactCompDim.set(k, r);
    }
  }
  return (currentDim0) => {
    const aligned = resolver(currentDim0);
    if (aligned === undefined) return null;
    return rowByExactCompDim.get(aligned) ?? null;
  };
}

// --- Densify comparison timeseries ------------------------------------------

/** UTC instant at the start of the `date_trunc` bucket for `dim0` (matches SQL in UTC). */
export function productAnalyticsDateDimensionBucketMergeKey(
  dim0: string | null,
  resolvedGranularity: ResolvedGranularity,
): number {
  if (dim0 == null) return NaN;
  const d = new Date(dim0);
  if (!Number.isFinite(d.getTime())) return NaN;
  return truncateUtc(d, resolvedGranularity).getTime();
}

function truncateUtc(d: Date, granularity: ResolvedGranularity): Date {
  const x = new Date(d.getTime());
  if (granularity === "hour") {
    x.setUTCMinutes(0, 0, 0);
    return x;
  }
  x.setUTCHours(0, 0, 0, 0);
  if (granularity === "day") {
    return x;
  }
  if (granularity === "week") {
    const dow = x.getUTCDay();
    const daysSinceMonday = (dow + 6) % 7;
    x.setUTCDate(x.getUTCDate() - daysSinceMonday);
    return x;
  }
  if (granularity === "month") {
    x.setUTCDate(1);
    return x;
  }
  x.setUTCMonth(0, 1);
  return x;
}

function stepBucketUtc(d: Date, granularity: ResolvedGranularity): void {
  switch (granularity) {
    case "hour":
      d.setUTCHours(d.getUTCHours() + 1);
      break;
    case "day":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "week":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "month":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "year":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
    default: {
      const _exhaustive: never = granularity;
      throw new Error(`Unexpected granularity: ${_exhaustive}`);
    }
  }
}

/**
 * Every bucket start in `[rangeStart, rangeEnd]` inclusive, aligned to Postgres-style
 * `date_trunc` in UTC (week = Monday 00:00 UTC).
 */
export function enumerateProductAnalyticsDateBuckets(params: {
  resolvedGranularity: ResolvedGranularity;
  rangeStart: Date;
  rangeEnd: Date;
}): string[] {
  const { resolvedGranularity, rangeStart, rangeEnd } = params;
  const first = truncateUtc(rangeStart, resolvedGranularity);
  const last = truncateUtc(rangeEnd, resolvedGranularity);
  const out: string[] = [];
  for (
    let cur = new Date(first.getTime());
    cur.getTime() <= last.getTime();
    stepBucketUtc(cur, resolvedGranularity)
  ) {
    out.push(cur.toISOString());
  }
  return out;
}

function orderedMetricIdsForDensify(
  submittedConfig: ExplorationConfig,
  comparison: ProductAnalyticsExploration,
): string[] | null {
  const fromRow = comparison.result?.rows?.find(
    (r) => r.values?.length,
  )?.values;
  if (fromRow?.length) {
    return fromRow.map((v) => v.metricId);
  }
  if (submittedConfig.type === "metric") {
    const ids = submittedConfig.dataset.values
      .map((v) => v.metricId)
      .filter((id): id is string => Boolean(id));
    return ids.length ? ids : null;
  }
  return null;
}

function buildZeroValueRow(
  metricIds: string[],
  isRatioByIndex: boolean[],
): ProductAnalyticsResultRow["values"] {
  return metricIds.map((metricId, i) => {
    const isRatio = isRatioByIndex[i] ?? false;
    return {
      metricId,
      numerator: 0,
      denominator: isRatio ? 0 : null,
    };
  });
}

/**
 * Returns a clone of `comparison` whose `result.rows` include every date bucket in the
 * comparison window (zeros for gaps). Only supports a single date dimension (v1).
 */
export function densifyComparisonExplorationTimeseries(params: {
  comparison: ProductAnalyticsExploration | null;
  submittedConfig: ExplorationConfig;
  previousTimeFrame: ExplorationDateRange;
  getFactMetricById: (id: string) => FactMetricInterface | null;
}): ProductAnalyticsExploration | null {
  const { comparison, submittedConfig, previousTimeFrame, getFactMetricById } =
    params;

  if (!comparison) return null;

  const dims = submittedConfig.dimensions ?? [];
  if (dims.length !== 1 || dims[0].dimensionType !== "date") {
    return null;
  }

  const columns = buildExplorationColumns(submittedConfig, getFactMetricById);
  const hasAnyRatio = columns.some(
    (c) => c.kind === "metric" && c.sub !== "single",
  );
  if (hasAnyRatio) {
    return null;
  }

  const metricIds = orderedMetricIdsForDensify(submittedConfig, comparison);
  if (!metricIds?.length) {
    return null;
  }

  const dateDim = dims[0];
  const dr = calculateProductAnalyticsDateRange(previousTimeFrame);
  const resolved = getDateGranularity(dateDim.dateGranularity, dr);
  const bucketStrings = enumerateProductAnalyticsDateBuckets({
    resolvedGranularity: resolved,
    rangeStart: dr.startDate,
    rangeEnd: dr.endDate,
  });
  if (bucketStrings.length === 0) {
    return null;
  }

  const isRatioByIndex = getIsRatioByIndex(submittedConfig, getFactMetricById);
  const zeroValues = buildZeroValueRow(metricIds, isRatioByIndex);

  const byMergeKey = new Map<number, ProductAnalyticsResultRow>();
  for (const row of comparison.result?.rows ?? []) {
    const k = productAnalyticsDateDimensionBucketMergeKey(
      row.dimensions[0] ?? null,
      resolved,
    );
    if (!Number.isFinite(k)) continue;
    if (!byMergeKey.has(k)) {
      byMergeKey.set(k, row);
    }
  }

  const merged: ProductAnalyticsResultRow[] = bucketStrings.map((bucketIso) => {
    const k = productAnalyticsDateDimensionBucketMergeKey(bucketIso, resolved);
    const existing = byMergeKey.get(k);
    if (existing) {
      return existing;
    }
    return {
      dimensions: [bucketIso],
      values: zeroValues.map((v) => ({ ...v })),
    };
  });

  merged.sort(
    (a, b) =>
      productAnalyticsDateDimensionBucketMergeKey(
        a.dimensions[0] ?? null,
        resolved,
      ) -
      productAnalyticsDateDimensionBucketMergeKey(
        b.dimensions[0] ?? null,
        resolved,
      ),
  );

  return {
    ...comparison,
    result: {
      rows: merged,
    },
  };
}

// --- Comparison payload for POST /product-analytics/run ---------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dateRangeToPeriodStrings(dateRange: ExplorationDateRange): {
  startDate: string;
  endDate: string;
} {
  const dr = calculateProductAnalyticsDateRange(dateRange);
  return {
    startDate: dr.startDate.toISOString().slice(0, 10),
    endDate: dr.endDate.toISOString().slice(0, 10),
  };
}

/**
 * Builds the `comparison` payload for POST /product-analytics/run when two
 * explorations (current + previous window) have been executed.
 */
export function computeExplorationComparisonPayload(
  primary: ProductAnalyticsExploration | null,
  comparison: ProductAnalyticsExploration | null,
  submittedConfig: ExplorationConfig,
  previousTimeFrame: ExplorationDateRange,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ProductAnalyticsRunComparisonPayload {
  const previousPeriod = dateRangeToPeriodStrings(previousTimeFrame);

  const n = submittedConfig.dataset?.values?.length ?? 0;
  const emptyTrends = Array.from({ length: n }, () => null);

  if (!primary?.result?.rows?.length || n === 0) {
    return {
      exploration: comparison,
      previousPeriod,
      bigNumberTrends: emptyTrends,
      tableTrendsByRow: [],
    };
  }

  const renderOpts = {
    showAs: getEffectiveShowAs(submittedConfig, getFactMetricById),
    isRatioByIndex: getIsRatioByIndex(submittedConfig, getFactMetricById),
  };

  const columns = buildExplorationColumns(submittedConfig, getFactMetricById);
  const hasAnyRatio = columns.some(
    (c) => c.kind === "metric" && c.sub !== "single",
  );

  const densifiedComparison =
    !hasAnyRatio && comparison
      ? densifyComparisonExplorationTimeseries({
          comparison,
          submittedConfig,
          previousTimeFrame,
          getFactMetricById,
        })
      : null;

  const exploration = densifiedComparison ?? comparison;

  if (!exploration?.result?.rows?.length) {
    return {
      exploration,
      previousPeriod,
      bigNumberTrends: emptyTrends,
      tableTrendsByRow: [],
    };
  }

  const bigNumberTrends = Array.from({ length: n }, (_, metricIndex) => {
    const currCell = primary.result.rows[0]?.values[metricIndex];
    const prevCell = exploration.result.rows[0]?.values[metricIndex];
    if (!currCell || !prevCell) return null;

    const isRatio = renderOpts.isRatioByIndex[metricIndex] ?? false;
    const currentValue = getEffectiveMetricValue(currCell, {
      showAs: renderOpts.showAs,
      isRatio,
    });
    const previousValue = getEffectiveMetricValue(prevCell, {
      showAs: renderOpts.showAs,
      isRatio,
    });

    if (previousValue === 0) {
      return null;
    }

    const pctChangeFraction =
      (currentValue - previousValue) / Math.abs(previousValue);
    return {
      currentValue,
      previousValue,
      pctChangeFraction,
      pctChangePercent: round2(pctChangeFraction * 100),
    };
  });

  if (hasAnyRatio) {
    return {
      exploration,
      previousPeriod,
      bigNumberTrends,
      tableTrendsByRow: [],
    };
  }

  const isTimeseries =
    submittedConfig.dimensions?.[0]?.dimensionType === "date";
  const sortedRows = sortExplorationRows(
    primary.result.rows,
    isTimeseries,
    renderOpts,
  );
  const cmpSorted = sortExplorationRows(
    exploration.result.rows,
    isTimeseries,
    renderOpts,
  );

  const getAlignedCmpRow = buildAlignedComparisonRowLookup(
    sortedRows,
    cmpSorted,
    isTimeseries,
  );

  const tableTrendsByRow = sortedRows.map((row) => {
    const cmpRow = getAlignedCmpRow(String(row.dimensions[0] ?? ""));
    const trendRecord: Record<string, number | null> = {};
    for (const col of columns) {
      if (col.kind !== "metric" || col.sub !== "single") continue;
      const rawCurr = getExplorationCellValue(row, col, renderOpts);
      const rawPrev = cmpRow
        ? getExplorationCellValue(cmpRow, col, renderOpts)
        : null;
      const trendKey = `${col.key}__trend`;
      let trend: number | null = null;
      if (
        typeof rawPrev === "number" &&
        typeof rawCurr === "number" &&
        rawPrev !== 0
      ) {
        trend = round2(((rawCurr - rawPrev) / rawPrev) * 100);
      }
      trendRecord[trendKey] = trend;
    }
    return trendRecord;
  });

  return {
    exploration,
    previousPeriod,
    bigNumberTrends,
    tableTrendsByRow,
  };
}
