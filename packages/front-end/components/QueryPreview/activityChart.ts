import { ProductAnalyticsExploration } from "shared/validators";
import { enumerateProductAnalyticsDateBuckets } from "shared/enterprise";

type ExplorationRange = Pick<
  ProductAnalyticsExploration,
  "dateStart" | "dateEnd"
>;

// Every UTC day in the exploration's range, as YYYY-MM-DD.
export function getDailyBuckets(exploration: ExplorationRange): string[] {
  return enumerateProductAnalyticsDateBuckets({
    resolvedGranularity: "day",
    rangeStart: new Date(exploration.dateStart),
    rangeEnd: new Date(exploration.dateEnd),
  }).map((day) => day.slice(0, 10));
}

// Parses the day as UTC. `new Date("2026-09-21 00:00:00")` is local time in
// most browsers and Invalid Date in Safari.
export function formatUtcWeekday(
  day: string,
  weekday: "narrow" | "short",
): string {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-US", { weekday, timeZone: "UTC" });
}
