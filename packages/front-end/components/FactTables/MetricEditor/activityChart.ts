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

// Warehouses return day buckets in several shapes ("2026-09-21",
// "2026-09-21 00:00:00", ISO). Adds each missing day, keyed as YYYY-MM-DD,
// so a day without rows still gets a slot on the axis.
export function fillDailyBuckets(
  xValues: string[],
  exploration: ExplorationRange,
): string[] {
  const seen = new Set(xValues.map((x) => x.slice(0, 10)));
  const missing = getDailyBuckets(exploration).filter((day) => !seen.has(day));
  return [...xValues, ...missing].sort();
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

export function getActivityChart(
  exploration: Pick<
    ProductAnalyticsExploration,
    "dateStart" | "dateEnd" | "result"
  >,
) {
  const days = getDailyBuckets(exploration);
  const byDay = new Map(
    (exploration.result?.rows ?? []).map((row) => [
      row.dimensions[0]?.slice(0, 10),
      row.values?.[0]?.numerator ?? 0,
    ]),
  );
  const counts = days.map((day) => byDay.get(day) ?? 0);
  return { days, counts, total: counts.reduce((sum, count) => sum + count, 0) };
}
