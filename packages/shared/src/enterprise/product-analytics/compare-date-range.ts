import subYears from "date-fns/subYears";
import { getValidDate } from "shared/dates";
import type { ExplorationConfig } from "shared/validators";
import { calculateProductAnalyticsDateRange } from "./sql";

/** UTC calendar date as `yyyy-MM-dd` for `customDateRange` payloads. */
function dateToYyyyMmDdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Builds a `dateRange` for the comparison (previous) period submitted as
 * `customDateRange` with fixed bounds, except year-shifted custom ranges
 * which stay `customDateRange` per product rules.
 */
export function buildComparisonDateRange(
  dateRange: ExplorationConfig["dateRange"],
): ExplorationConfig["dateRange"] {
  if (
    dateRange.predefined === "customDateRange" &&
    dateRange.startDate &&
    dateRange.endDate
  ) {
    const start = getValidDate(dateRange.startDate);
    const end = getValidDate(dateRange.endDate);
    const prevStart = subYears(start, 1);
    const prevEnd = subYears(end, 1);
    return {
      predefined: "customDateRange",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: dateToYyyyMmDdUtc(prevStart),
      endDate: dateToYyyyMmDdUtc(prevEnd),
    };
  }

  if (dateRange.predefined === "today") {
    const now = new Date();
    const yesterdayStart = new Date(now);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    yesterdayStart.setUTCHours(0, 0, 0, 0);
    const y = dateToYyyyMmDdUtc(yesterdayStart);
    return {
      predefined: "customDateRange",
      lookbackValue: null,
      lookbackUnit: null,
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
    lookbackValue: null,
    lookbackUnit: null,
    startDate: dateToYyyyMmDdUtc(prevStart),
    endDate: dateToYyyyMmDdUtc(prevEnd),
  };
}
