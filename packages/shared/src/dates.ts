import format from "date-fns/format";
import formatDistance from "date-fns/formatDistance";
import differenceInDays from "date-fns/differenceInDays";
import differenceInHours from "date-fns/differenceInHours";
import addMonths from "date-fns/addMonths";
import formatRelative from "date-fns/formatRelative";

export function date(date: string | Date): string {
  if (!date) return "";
  return format(getValidDate(date), "PP");
}
export function datetime(date: string | Date): string {
  if (!date) return "";
  return format(getValidDate(date), "PPp");
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

// returns of the format ["'2022-01-05'", "'2022-01-06'"] for
// ease of use with SQL
export function dateStringArrayBetweenDates(
  start: Date,
  end: Date,
  truncate: boolean = true,
  dayInterval: number = 1
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
  fallback?: Date
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
