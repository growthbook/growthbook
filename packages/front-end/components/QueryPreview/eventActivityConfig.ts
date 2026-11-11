import type {
  ExplorationConfig,
  FactTableExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { getDailyBuckets } from "@/components/QueryPreview/activityChart";

// Daily event counts from a managed events fact table.
export function getEventActivityConfig({
  datasourceId,
  factTableId,
  dateRange,
}: {
  datasourceId: string;
  factTableId: string;
  dateRange: ExplorationConfig["dateRange"];
}): FactTableExplorationConfig {
  return {
    type: "fact_table",
    datasource: datasourceId,
    chartType: "bar",
    showAs: "total",
    dateRange,
    dimensions: [
      { dimensionType: "date", column: "date", dateGranularity: "day" },
    ],
    dataset: {
      type: "fact_table",
      factTableId,
      values: [
        {
          type: "fact_table",
          name: "Events",
          valueType: "count",
          valueColumn: null,
          unit: null,
          rowFilters: [],
        },
      ],
    },
  };
}

// One entry per UTC day in the range; days without rows count as zero.
export function getEventActivityDailyCounts(
  exploration: Pick<
    ProductAnalyticsExploration,
    "dateStart" | "dateEnd" | "result"
  >,
) {
  const byDay = new Map(
    (exploration.result?.rows ?? []).map((row) => [
      String(row.dimensions[0] ?? "").slice(0, 10),
      row.values?.[0]?.numerator ?? 0,
    ]),
  );
  const dailyValues = getDailyBuckets(exploration).map((day) => ({
    day,
    value: byDay.get(day) ?? 0,
  }));
  return {
    dailyValues,
    total: dailyValues.reduce((sum, { value }) => sum + value, 0),
  };
}
