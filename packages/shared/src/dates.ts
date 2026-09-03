import format from "date-fns/format";
import formatDistance from "date-fns/formatDistance";
import differenceInDays from "date-fns/differenceInDays";
import differenceInHours from "date-fns/differenceInHours";
import addMonths from "date-fns/addMonths";
import addDays from "date-fns/addDays";
import addHours from "date-fns/addHours";
import formatRelative from "date-fns/formatRelative";
import previousMonday from "date-fns/previousMonday";
import { formatInTimeZone } from "date-fns-tz";

export function dateNoYear(date: string | Date): string {
  if (!date) return "";
  const d = getValidDate(date);
  const isCurrentYear = d.getFullYear() === new Date().getFullYear();
  return format(d, isCurrentYear ? "MMM d" : "MMM d, yyyy");
}
export function date(date: string | Date, inTimezone?: string): string {
  if (!date) return "";
  const d = getValidDate(date);
  const formatStr = "PP";
  return inTimezone
    ? formatInTimeZone(d, inTimezone, formatStr)
    : format(d, formatStr);
}
export function datetime(date: string | Date, inTimezone?: string): string {
  if (!date) return "";
  const d = getValidDate(date);
  const formatStr = "PPp";
  return inTimezone
    ? formatInTimeZone(d, inTimezone, formatStr)
    : format(d, formatStr);
}
export function datetimeAt(date: string | Date, inTimezone?: string): string {
  if (!date) return "";
  const d = getValidDate(date);
  const formatStr = "MMM d, yyyy 'at' h:mm a";
  return inTimezone
    ? formatInTimeZone(d, inTimezone, formatStr)
    : format(d, formatStr);
}
export function dateOnly(date: string | Date, inTimezone?: string): string {
  if (!date) return "";
  const d = getValidDate(date);
  const formatStr = "yyyy-MM-dd";
  return inTimezone
    ? formatInTimeZone(d, inTimezone, formatStr)
    : format(d, formatStr);
}
export function timestamp(date: string | Date, inTimezone?: string): string {
  if (!date) return "";
  const d = getValidDate(date);
  const formatStr = "yyyy-MM-dd HH:mm:ss";
  return inTimezone
    ? formatInTimeZone(d, inTimezone, formatStr)
    : format(d, formatStr);
}
export function relativeDate(date: string | Date): string {
  if (!date) return "";
  return formatRelative(getValidDate(date), new Date());
}
export function ago(date: string | Date): string {
  if (!date) return "";
  return formatDistance(getValidDate(date), new Date(), { addSuffix: true });
}
export function daysLeft(date: string | Date): number {
  return differenceInDays(getValidDate(date), new Date());
}
export function subtractMonths(date: string | Date, num: number): Date {
  return addMonths(getValidDate(date), -1 * num);
}
export function monthYear(date: string | Date): string {
  return format(getValidDate(date), "MMM yyy");
}
export function daysBetween(start: string | Date, end: string | Date): number {
  return differenceInDays(getValidDate(end), getValidDate(start));
}
export function hoursBetween(start: string | Date, end: string | Date): number {
  return differenceInHours(getValidDate(end), getValidDate(start));
}

// gets the previous monday as a string date (for "weeks").
// if date is a monday, returns itself
export function lastMondayString(dateString: string): string {
  const lastMonday = previousMonday(getValidDate(dateString));
  return lastMonday.toISOString().substring(0, 10);
}

// returns of the format ["'2022-01-05'", "'2022-01-06'"] for
// ease of use with SQL
export function dateStringArrayBetweenDates(
  start: Date,
  end: Date,
  truncate: boolean = true,
  dayInterval: number = 1,
): string[] {
  const dateArray: string[] = [];
  let startTruncate = new Date(start);
  if (truncate) {
    startTruncate = new Date(start.toISOString().substring(0, 10));
  }
  for (let d = startTruncate; d <= end; d.setDate(d.getDate() + dayInterval)) {
    dateArray.push(`'${d.toISOString().substring(0, 10)}'`);
  }
  return dateArray;
}

export function getValidDate(
  dateStr: string | Date | null | number | undefined,
  fallback?: Date,
): Date {
  fallback = fallback || new Date();

  if (!dateStr) return fallback;

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return fallback;
  }
  return d;
}
/**
 * This function will offset the time passed in
 * to show its "true" time eg if you pass in
 * `12/04/2023` if will show `12/04/2023`
 * even if the user is in pacific time
 *
 */
export function getValidDateOffsetByUTC(
  ...params: Parameters<typeof getValidDate>
): Date {
  const date = getValidDate(...params);
  return new Date(date.getTime() + date.getTimezoneOffset() * 60000);
}

// Compact relative time using single-char units: "5s ago", "3m ago", "2h ago", "7d ago"
export function formatShortAgo(dateOrTimestamp: Date | number): string {
  const ts =
    typeof dateOrTimestamp === "number"
      ? dateOrTimestamp
      : dateOrTimestamp.getTime();
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// returns an abbreviated version of the "ago" string.
// ex: "about 5 minutes ago" -> "5 min ago"
export function abbreviateAgo(date: string | Date | null | undefined): string {
  return ago(date ?? "")
    .replace("about ", "")
    .replace("less than a", "<1")
    .replace(/second(s)?/g, "sec$1")
    .replace(/minute(s)?/g, "min$1");
}

export function snapToUtcDayStart(date: Date): Date {
  const snapped = new Date(date);
  snapped.setUTCHours(0, 0, 0, 0);
  return snapped;
}

export function precedingUtcDayStart(date: Date): Date {
  const dayStart = snapToUtcDayStart(date);
  return new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
}

// Resolve a relative end offset ("N days/hours after") to a concrete date.
// Calendar-aware (DST-safe) for days via date-fns.
export function resolveScheduleStopAfter(
  base: Date,
  offset: { value: number; unit: "hours" | "days" },
): Date {
  const d =
    offset.unit === "days"
      ? addDays(base, offset.value)
      : addHours(base, offset.value);
  d.setSeconds(0, 0);
  d.setMilliseconds(0);
  return d;
}

// Single source for "resolve a schedule's end into a concrete stopAt + the
// staged stop job". Shared by the three places that need it (experiment start,
// the generic update normalizer, and the REST schedule-stop action) so the
// timing logic can't drift between them.
//   - `active` = the experiment is running (or starting): resolve a relative
//     `stopAfter` off `base` and stage the stop. When inactive (a draft not yet
//     started) a relative end is left unresolved (returned in `stopAfter`) and
//     nothing is staged — it resolves later at start.
//   - An absolute `stopAt` is always kept as-is; it's only staged when active.
export function resolveScheduledStop(params: {
  stopAt?: Date | string | null;
  stopAfter?: { value: number; unit: "hours" | "days" } | null;
  base: Date;
  active: boolean;
  now?: Date;
}): {
  stopAt: Date | null;
  stopAfter: { value: number; unit: "hours" | "days" } | null;
  stagedStop: { type: "stop"; date: Date } | null;
} {
  const reference = params.now ?? new Date();
  let stopAt: Date | null = null;
  let stopAfter: { value: number; unit: "hours" | "days" } | null = null;

  if (params.stopAt) {
    stopAt = getValidDate(params.stopAt);
  } else if (params.stopAfter) {
    if (params.active) {
      stopAt = resolveScheduleStopAfter(params.base, params.stopAfter);
    } else {
      // Defer: keep the relative offset for resolution at start.
      stopAfter = params.stopAfter;
    }
  }

  const stagedStop =
    params.active && stopAt && stopAt > reference
      ? { type: "stop" as const, date: stopAt }
      : null;

  return { stopAt, stopAfter, stagedStop };
}
