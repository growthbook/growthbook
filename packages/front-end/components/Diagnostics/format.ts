import { timestamp } from "shared/dates";

export function formatTimestamp(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : timestamp(parsed, "UTC");
}
