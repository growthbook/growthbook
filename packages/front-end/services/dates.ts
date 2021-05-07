import format from "date-fns/format";
import formatDistance from "date-fns/formatDistance";
import differenceInDays from "date-fns/differenceInDays";
import { addMonths } from "date-fns";

export function date(date: string | Date): string {
  if (!date) return "";
  return format(new Date(date), "PP");
}
export function datetime(date: string | Date): string {
  if (!date) return "";
  return format(new Date(date), "PPp");
}
export function ago(date: string | Date): string {
  if (!date) return "";
  return formatDistance(new Date(date), new Date()) + " ago";
}
export function daysLeft(date: string | Date): number {
  return differenceInDays(new Date(date), new Date());
}
export function subtractMonths(date: string | Date, num: number): Date {
  return addMonths(new Date(date), -1 * num);
}
export function monthYear(date: string | Date): string {
  return format(new Date(date), "MMM yyy");
}
