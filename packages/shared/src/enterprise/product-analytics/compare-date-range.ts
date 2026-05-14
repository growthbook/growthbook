import type { ExplorationConfig } from "shared/validators";
import { calculateProductAnalyticsDateRange } from "./sql";

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
export function addUtcCalendarDays(
  yyyyMmDd: string,
  deltaDays: number,
): string {
  const d = utcMidnightFromYyyyMmDd(yyyyMmDd);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return dateToYyyyMmDdUtc(d);
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
  const prevEnd = addUtcCalendarDays(primaryStartYyyyMmDd, -1);
  const prevStart = n > 0 ? addUtcCalendarDays(prevEnd, -(n - 1)) : prevEnd;
  return {
    predefined: "customDateRange",
    lookbackValue,
    lookbackUnit: lookbackUnit ?? null,
    startDate: prevStart,
    endDate: prevEnd,
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

  return {
    predefined: "customDateRange",
    lookbackValue,
    lookbackUnit,
    startDate: dateToYyyyMmDdUtc(prevStart),
    endDate: dateToYyyyMmDdUtc(prevEnd),
  };
}
