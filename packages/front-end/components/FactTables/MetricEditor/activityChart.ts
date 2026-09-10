import { ProductAnalyticsExploration } from "shared/validators";
import { enumerateProductAnalyticsDateBuckets } from "shared/enterprise";

export function getActivityChart(
  exploration: Pick<
    ProductAnalyticsExploration,
    "dateStart" | "dateEnd" | "result"
  >,
) {
  const days = enumerateProductAnalyticsDateBuckets({
    resolvedGranularity: "day",
    rangeStart: new Date(exploration.dateStart),
    rangeEnd: new Date(exploration.dateEnd),
  }).map((day) => day.slice(0, 10));
  const byDay = new Map(
    (exploration.result?.rows ?? []).map((row) => [
      row.dimensions[0]?.slice(0, 10),
      row.values?.[0]?.numerator ?? 0,
    ]),
  );
  const counts = days.map((day) => byDay.get(day) ?? 0);
  return { days, counts, total: counts.reduce((sum, count) => sum + count, 0) };
}
