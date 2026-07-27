import type {
  ComparisonMode,
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
 * Inclusive UTC calendar-day bounds of a primary range. Rolling presets resolve
 * to instants and are truncated to the days they touch, so `last7Days` spans 8
 * inclusive days (7 whole days plus the partial current one).
 */
export function getPrimaryUtcDayBounds(
  dateRange: ExplorationConfig["dateRange"],
): FixedSpanDateBounds {
  if (
    dateRange.predefined === "customDateRange" &&
    dateRange.startDate &&
    dateRange.endDate
  ) {
    return { startDate: dateRange.startDate, endDate: dateRange.endDate };
  }
  const { startDate, endDate } = calculateProductAnalyticsDateRange(dateRange);
  return {
    startDate: dateToYyyyMmDdUtc(startDate),
    endDate: dateToYyyyMmDdUtc(endDate),
  };
}

/** Same-length window starting `shiftDays` UTC days before the primary start. */
function shiftFixedSpanRangeBack(
  primaryStartYyyyMmDd: string,
  spanInclusiveDays: number,
  shiftDays: number,
): FixedSpanDateBounds {
  return buildFixedSpanRangeStartingAtAnchor(
    addUtcCalendarDays(primaryStartYyyyMmDd, -shiftDays),
    spanInclusiveDays,
  );
}

/**
 * Whole-day shift for the day-delta modes.
 *
 * The weekday-matching variant rounds the span *up* to whole weeks rather than
 * to the nearest week: rounding down would place the previous end on the
 * primary's own start day, double-counting it across both series. A gap is
 * safe; an overlap corrupts the numbers.
 */
export function getComparisonShiftDays(
  mode: Exclude<ComparisonMode, "custom" | "previousYear">,
  spanInclusiveDays: number,
): number {
  switch (mode) {
    case "previousPeriod":
      return spanInclusiveDays;
    case "previousPeriodMatchDayOfWeek":
      return Math.max(7, Math.ceil(spanInclusiveDays / 7) * 7);
    case "previousYearMatchDayOfWeek":
      return 364;
    default: {
      const exhaustiveCheck: never = mode;
      return exhaustiveCheck;
    }
  }
}

/**
 * Subtract whole calendar years in UTC, clamping to the target month's last day
 * (only Feb 29 needs it). Done by hand because date-fns `subYears` operates in
 * local time and would clamp to the wrong UTC day in negative-offset zones.
 */
function subUtcCalendarYears(yyyyMmDd: string, years: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  const targetYear = y - years;
  const lastDayOfMonth = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
  return dateToYyyyMmDdUtc(
    new Date(Date.UTC(targetYear, m - 1, Math.min(d, lastDayOfMonth))),
  );
}

/** Same calendar dates one year back, clamping Feb 29 to Feb 28. */
export function buildPreviousYearUtcDayBounds(
  primaryStartYyyyMmDd: string,
  primaryEndYyyyMmDd: string,
): FixedSpanDateBounds {
  return {
    startDate: subUtcCalendarYears(primaryStartYyyyMmDd, 1),
    endDate: subUtcCalendarYears(primaryEndYyyyMmDd, 1),
  };
}

/**
 * Builds the comparison (previous) period for `mode`, submitted as a
 * `customDateRange` with fixed bounds.
 *
 * Every mode reduces to a shift applied to the primary's inclusive UTC day
 * bounds. The day-delta modes anchor at `primaryStart - shift`, so they can
 * never overlap the primary. `previousYear` deliberately can: preserving "the
 * same calendar dates" matters more than avoiding overlap, and clamping would
 * silently misreport a primary spanning more than a year. Callers guard that
 * case in the UI instead.
 */
export function buildComparisonDateRangeForMode(
  dateRange: ExplorationConfig["dateRange"],
  mode: ComparisonMode,
  explicitPreviousTimeFrame?: ExplorationDateRange | null,
): ExplorationConfig["dateRange"] {
  const lookbackValue = dateRange.lookbackValue ?? null;
  const lookbackUnit = dateRange.lookbackUnit ?? null;

  if (mode === "custom") {
    // A `custom` mode with no window yet (e.g. just switched to it) must still
    // produce a valid range rather than null bounds.
    return (
      explicitPreviousTimeFrame ??
      buildComparisonDateRangeForMode(dateRange, "previousPeriod")
    );
  }

  const primary = getPrimaryUtcDayBounds(dateRange);
  const spanInclusiveDays = getInclusiveUtcCalendarDayCount(
    primary.startDate,
    primary.endDate,
  );

  const { startDate, endDate } =
    mode === "previousYear"
      ? buildPreviousYearUtcDayBounds(primary.startDate, primary.endDate)
      : shiftFixedSpanRangeBack(
          primary.startDate,
          spanInclusiveDays,
          getComparisonShiftDays(mode, spanInclusiveDays),
        );

  return {
    predefined: "customDateRange",
    lookbackValue,
    lookbackUnit,
    startDate,
    endDate,
  };
}

/**
 * The contiguous prior window — equivalent to the `previousPeriod` mode.
 */
export function buildComparisonDateRange(
  dateRange: ExplorationConfig["dateRange"],
): ExplorationConfig["dateRange"] {
  return buildComparisonDateRangeForMode(dateRange, "previousPeriod");
}

/**
 * A comparison saved before named modes existed carries no `mode`: a persisted
 * `previousTimeFrame` meant "frozen window", its absence meant "re-derive".
 */
export function resolveComparisonMode(comparison: {
  mode?: ComparisonMode | null;
  previousTimeFrame?: ExplorationDateRange | null;
}): ComparisonMode {
  if ((comparison.mode ?? null) !== null) {
    return comparison.mode as ComparisonMode;
  }
  return (comparison.previousTimeFrame ?? null) !== null
    ? "custom"
    : "previousPeriod";
}

/**
 * Legacy explorer state (and shared URLs) carry no mode. Unlike persisted
 * blocks, the explorer materializes the derived window into `previousTimeFrame`
 * even for rolling presets, so its presence does not imply a hand-picked
 * window — only a custom primary's prior window was ever editable.
 */
export function resolveLegacyExplorerComparisonMode(
  dateRange: ExplorationConfig["dateRange"],
): ComparisonMode {
  return dateRange.predefined === "customDateRange"
    ? "custom"
    : "previousPeriod";
}

/**
 * Resolves the previous-period date range to run for a comparison. `custom`
 * uses the explicit `previousTimeFrame` as-is; every other mode re-derives from
 * the primary range. Since derivation resolves relative to "now", predefined
 * primaries roll forward each time this is called while custom windows stay
 * fixed — this is the single seam dashboards re-run on refresh so both periods
 * stay current.
 */
export function resolveComparisonPreviousTimeFrame(
  primaryDateRange: ExplorationConfig["dateRange"],
  comparison: {
    mode?: ComparisonMode | null;
    previousTimeFrame?: ExplorationDateRange | null;
  },
): ExplorationConfig["dateRange"] {
  return buildComparisonDateRangeForMode(
    primaryDateRange,
    resolveComparisonMode(comparison),
    comparison.previousTimeFrame ?? null,
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
 * The exploration config to run for the comparison leg.
 *
 * Pins an `"auto"` date granularity to the value the primary leg resolved to.
 * `previousYear` windows can be a day shorter than the primary (leap years), so
 * a primary sitting on a `getDateGranularity` threshold would otherwise bucket
 * the two legs differently and make the result sets unmergeable.
 */
export function buildComparisonExplorationConfig(
  primaryConfig: ExplorationConfig,
  previousTimeFrame: ExplorationDateRange,
): ExplorationConfig {
  const dims = primaryConfig.dimensions ?? [];
  const firstDim = dims[0];

  if (firstDim?.dimensionType !== "date") {
    return { ...primaryConfig, dateRange: previousTimeFrame };
  }

  const pinnedGranularity =
    firstDim.dateGranularity === "auto"
      ? getDateGranularity(
          "auto",
          calculateProductAnalyticsDateRange(primaryConfig.dateRange),
        )
      : firstDim.dateGranularity;

  return {
    ...primaryConfig,
    dateRange: previousTimeFrame,
    dimensions: [
      { ...firstDim, dateGranularity: pinnedGranularity },
      ...dims.slice(1),
    ],
  };
}

export const comparisonAlignmentStrategy = [
  "calendarYearOverYear",
  "chronological",
] as const;
export type ComparisonAlignmentStrategy =
  (typeof comparisonAlignmentStrategy)[number];

/**
 * How a mode's two windows should be paired bucket-for-bucket.
 *
 * Only `previousYear` lands on the same calendar dates. The weekday-matching
 * year mode shifts 364 days, so a calendar-year probe would resolve to a day
 * that *is* inside the comparison window but one off from the correct bucket —
 * silently shifting every point in the overlay. Those modes must pair by
 * chronological rank instead.
 *
 * `custom` keeps the calendar match that shipped before named modes existed —
 * a hand-picked window is most often a YoY range.
 */
export function getComparisonAlignmentStrategy(
  mode: ComparisonMode,
): ComparisonAlignmentStrategy {
  switch (mode) {
    case "previousYear":
    case "custom":
      return "calendarYearOverYear";
    case "previousPeriod":
    case "previousPeriodMatchDayOfWeek":
    case "previousYearMatchDayOfWeek":
      return "chronological";
    default: {
      const exhaustiveCheck: never = mode;
      return exhaustiveCheck;
    }
  }
}

/**
 * Maps each current-period primary-dimension key to the comparison-period key
 * used for overlay / table pairing: under `calendarYearOverYear`, a YoY calendar
 * match when present, else chronological rank within the two windows.
 */
export function createComparisonAlignmentResolver(
  sortedXValues: string[],
  comparisonXValues: readonly string[],
  firstDimensionIsDate: boolean,
  strategy: ComparisonAlignmentStrategy = "calendarYearOverYear",
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
    if (strategy === "calendarYearOverYear") {
      const currentNorm = explorerDimensionDateToUtcYyyyMmDd(currentKey);
      if (currentNorm) {
        const calendarMatch = comparisonNormToOriginal.get(
          subUtcCalendarYears(currentNorm, 1),
        );
        if (calendarMatch !== undefined) {
          return calendarMatch;
        }
      }
    }
    const rank = rankByCurrentX.get(currentKey);
    if (rank === undefined) return undefined;
    return chronoComp[rank];
  };
}

// Unit separator (U+001F): a non-printing control character that cannot
// appear in real dimension/breakdown values, so composite keys never
// collide (e.g. ["a","b"] vs ["ab"]). Defined as a named constant because
// the raw character is invisible in diffs/editors and trivial to delete by
// accident.
const KEY_SEPARATOR = "\u001f";

/** Join a full dimension tuple into a single lookup key. */
function dimensionsTupleKey(dimensions: (string | null)[]): string {
  return dimensions.map((d) => String(d ?? "")).join(KEY_SEPARATOR);
}

/**
 * Returns a lookup from a current row's full dimension tuple to the aligned
 * comparison row, using the same rules as the explorer chart overlay. The key
 * includes every rendered dimension so breakdown rows that share a first
 * dimension (e.g. `2024-01-01 / Chrome` vs `2024-01-01 / Safari`) each pair
 * with their own comparison row; date alignment is applied only to the first
 * dimension when it is a date.
 */
export function buildAlignedComparisonRowLookup(
  primaryRows: ProductAnalyticsResultRow[],
  comparisonRows: ProductAnalyticsResultRow[],
  firstDimensionIsDate: boolean,
  strategy: ComparisonAlignmentStrategy = "calendarYearOverYear",
): (currentDims: (string | null)[]) => ProductAnalyticsResultRow | null {
  if (!firstDimensionIsDate) {
    const byKey = new Map<string, ProductAnalyticsResultRow>();
    for (const r of comparisonRows) {
      byKey.set(dimensionsTupleKey(r.dimensions), r);
    }
    return (currentDims) => byKey.get(dimensionsTupleKey(currentDims)) ?? null;
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
    strategy,
  );
  const rowByCompTuple = new Map<string, ProductAnalyticsResultRow>();
  for (const r of comparisonRows) {
    const k = dimensionsTupleKey(r.dimensions);
    if (!rowByCompTuple.has(k)) {
      rowByCompTuple.set(k, r);
    }
  }
  return (currentDims) => {
    const aligned = resolver(String(currentDims[0] ?? ""));
    if (aligned === undefined) return null;
    // Align the date dimension, keep the remaining dimensions as-is.
    const compKey = dimensionsTupleKey([aligned, ...currentDims.slice(1)]);
    return rowByCompTuple.get(compKey) ?? null;
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
 * The next `count` bucket starts after `afterIso`, continuing its cadence.
 *
 * Used to stretch a chart's category axis when the comparison window has more
 * buckets than the primary — the axis has to reach the longer of the two, and
 * the primary has no dates of its own out there.
 */
export function extendDateBucketsForward(params: {
  resolvedGranularity: ResolvedGranularity;
  afterIso: string;
  count: number;
}): string[] {
  const { resolvedGranularity, afterIso, count } = params;
  if (count <= 0) return [];
  const cur = truncateUtc(new Date(afterIso), resolvedGranularity);
  if (Number.isNaN(cur.getTime())) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    stepBucketUtc(cur, resolvedGranularity);
    out.push(cur.toISOString());
  }
  return out;
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

/** Composite merge key for a date bucket + optional breakdown value. */
function bucketBreakdownMergeKey(
  dim0: string | null,
  dim1: string | null | undefined,
  granularity: ResolvedGranularity,
): string {
  const bucket = productAnalyticsDateDimensionBucketMergeKey(dim0, granularity);
  return `${bucket}${KEY_SEPARATOR}${dim1 ?? ""}`;
}

/**
 * Returns a clone of `comparison` whose `result.rows` include every date bucket in the
 * comparison window (zeros for gaps). Supports a single date dimension and the
 * `date + 1 breakdown` case. For the grouped case the breakdown values come from
 * the union of the primary and comparison periods, so every primary series has a
 * continuous prior line even when the previous period returned no/partial rows.
 */
export function densifyComparisonExplorationTimeseries(params: {
  comparison: ProductAnalyticsExploration | null;
  submittedConfig: ExplorationConfig;
  previousTimeFrame: ExplorationDateRange;
  getFactMetricById: (id: string) => FactMetricInterface | null;
  /** Primary-period rows; used to seed breakdown series in the grouped case. */
  primaryRows?: ProductAnalyticsResultRow[];
}): ProductAnalyticsExploration | null {
  const {
    comparison,
    submittedConfig,
    previousTimeFrame,
    getFactMetricById,
    primaryRows,
  } = params;

  if (!comparison) return null;

  const dims = submittedConfig.dimensions ?? [];
  const firstIsDate = dims[0]?.dimensionType === "date";
  const isGrouped = dims.length === 2 && firstIsDate;
  if (!((dims.length === 1 && firstIsDate) || isGrouped)) {
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
  const dateGranularity =
    dateDim.dimensionType === "date" ? dateDim.dateGranularity : "auto";
  const dr = calculateProductAnalyticsDateRange(previousTimeFrame);
  // Buckets span the previous window but are sized from the primary's, so an
  // unequal-length comparison (leap-year `previousYear`) can't resolve "auto" to
  // a different granularity than the leg it's being merged with.
  const resolved = getDateGranularity(
    dateGranularity,
    calculateProductAnalyticsDateRange(submittedConfig.dateRange),
  );
  const bucketStrings = enumerateProductAnalyticsDateBuckets({
    resolvedGranularity: resolved,
    rangeStart: dr.startDate,
    rangeEnd: dr.endDate,
  });
  if (bucketStrings.length === 0) {
    return null;
  }

  const isRatioByIndex = getIsRatioByIndex(submittedConfig, getFactMetricById);
  // buildZeroValueRow always returns an array; the `| undefined` comes from
  // the union type on ProductAnalyticsResultRow["values"] (funnel rows omit it).
  const zeroValues = buildZeroValueRow(metricIds, isRatioByIndex)!;
  const comparisonRows = comparison.result?.rows ?? [];

  if (!isGrouped) {
    const byMergeKey = new Map<string, ProductAnalyticsResultRow>();
    for (const row of comparisonRows) {
      const k = bucketBreakdownMergeKey(
        row.dimensions[0] ?? null,
        null,
        resolved,
      );
      if (!byMergeKey.has(k)) {
        byMergeKey.set(k, row);
      }
    }

    const merged: ProductAnalyticsResultRow[] = bucketStrings.map(
      (bucketIso) => {
        const existing = byMergeKey.get(
          bucketBreakdownMergeKey(bucketIso, null, resolved),
        );
        if (existing) {
          return existing;
        }
        return {
          dimensions: [bucketIso],
          values: zeroValues.map((v) => ({ ...v })),
        };
      },
    );

    return { ...comparison, result: { rows: merged } };
  }

  // Grouped (date + 1 breakdown): zero-fill the cross-product of every bucket
  // and every breakdown value seen in either period, preserving insertion order
  // (primary series first, then comparison-only series) for deterministic output.
  const breakdownValues: string[] = [];
  const seenBreakdown = new Set<string>();
  const addBreakdown = (rows: ProductAnalyticsResultRow[] | undefined) => {
    for (const row of rows ?? []) {
      const v = String(row.dimensions[1] ?? "");
      if (!seenBreakdown.has(v)) {
        seenBreakdown.add(v);
        breakdownValues.push(v);
      }
    }
  };
  addBreakdown(primaryRows);
  addBreakdown(comparisonRows);

  if (breakdownValues.length === 0) {
    return { ...comparison, result: { rows: [] } };
  }

  const byMergeKey = new Map<string, ProductAnalyticsResultRow>();
  for (const row of comparisonRows) {
    const k = bucketBreakdownMergeKey(
      row.dimensions[0] ?? null,
      String(row.dimensions[1] ?? ""),
      resolved,
    );
    if (!byMergeKey.has(k)) {
      byMergeKey.set(k, row);
    }
  }

  const merged: ProductAnalyticsResultRow[] = [];
  for (const bucketIso of bucketStrings) {
    for (const breakdown of breakdownValues) {
      const existing = byMergeKey.get(
        bucketBreakdownMergeKey(bucketIso, breakdown, resolved),
      );
      if (existing) {
        merged.push(existing);
        continue;
      }
      merged.push({
        dimensions: [bucketIso, breakdown],
        values: zeroValues.map((v) => ({ ...v })),
      });
    }
  }

  return { ...comparison, result: { rows: merged } };
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
  alignment: ComparisonAlignmentStrategy = "calendarYearOverYear",
): ProductAnalyticsRunComparisonPayload {
  const previousPeriod = dateRangeToPeriodStrings(previousTimeFrame);

  // Funnels have no metric values but still need comparison.exploration
  // passed through so the funnel table can render previous-period data.
  if (submittedConfig.dataset?.type === "funnel") {
    return {
      exploration: comparison,
      previousPeriod,
      bigNumberTrends: [],
      tableTrendsByRow: [],
    };
  }

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
          primaryRows: primary?.result?.rows,
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
    const currCell = primary.result.rows[0]?.values?.[metricIndex];
    const prevCell = exploration.result.rows[0]?.values?.[metricIndex];
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
    alignment,
  );

  const tableTrendsByRow = sortedRows.map((row) => {
    const cmpRow = getAlignedCmpRow(row.dimensions);
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
