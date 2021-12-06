import format from "date-fns/format";
import formatDistance from "date-fns/formatDistance";
import differenceInDays from "date-fns/differenceInDays";
import { addMonths } from "date-fns";

export function date(date: string | Date): string {
  if (!date) return "";
  return format(getValidDate(date), "PP");
}
export function datetime(date: string | Date): string {
  if (!date) return "";
  return format(getValidDate(date), "PPp");
}
export function ago(date: string | Date): string {
  if (!date) return "";
  return formatDistance(getValidDate(date), new Date()) + " ago";
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

export function getValidDate(
  dateStr: string | Date | null | number,
  fallback?: Date
) {
  fallback = fallback || new Date();

  if (!dateStr) return fallback;

  if (typeof dateStr === "string") {
    // seems like these are often yyyy-mm-dd
    const parts = dateStr.split("-");
    if (parts.length > 2) {
      const d = new Date(
        parseInt(parts[0]),
        parseInt(parts[1]) - 1,
        parseInt(parts[2])
      );
      if (!isNaN(d.getTime())) {
        return d;
      }
    }
  }
  // using dateStr is unreliable: consider fixing.
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return fallback;
  }
  return d;
}
