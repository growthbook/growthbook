import {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import {
  ExplorationConfig,
  ProductAnalyticsResultRow,
  draftExplorationMetricValidator,
} from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
import { isFactFunnelMetric } from "shared/experiments";
import { funnelSettingsToFunnelDataset } from "shared/funnels";

export function getMetricPreviewDateRange(
  now = new Date(),
): ExplorationConfig["dateRange"] {
  const start = new Date(now);
  const end = new Date(now);
  start.setUTCDate(start.getUTCDate() - 7);
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    predefined: "customDateRange",
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function getMetricPreviewUnits(
  metric: FactMetricInterface | null,
  getFactTable: (id: string) => Pick<FactTableDefinition, "userIdTypes"> | null,
): { numerator: string[]; denominator: string[] } {
  if (!metric) return { numerator: [], denominator: [] };
  if (isFactFunnelMetric(metric)) {
    const tables = metric.funnelSettings.steps.map((step) =>
      getFactTable(step.factTableId),
    );
    const units = tables[0]?.userIdTypes ?? [];
    return {
      numerator: units.filter((unit) =>
        tables.every((table) => table?.userIdTypes.includes(unit)),
      ),
      denominator: [],
    };
  }
  if (
    metric.metricType === "quantile" &&
    metric.quantileSettings?.type === "event"
  ) {
    return { numerator: [], denominator: [] };
  }
  return {
    numerator: getFactTable(metric.numerator.factTableId)?.userIdTypes ?? [],
    denominator:
      metric.metricType === "ratio" && metric.denominator
        ? (getFactTable(metric.denominator.factTableId)?.userIdTypes ?? [])
        : [],
  };
}

export function getMetricPreviewConfig(
  metric: FactMetricInterface,
  {
    draft,
    unit,
    denominatorUnit,
    dateRange,
  }: {
    draft: boolean;
    unit: string | null;
    denominatorUnit: string | null;
    dateRange: ExplorationConfig["dateRange"];
  },
): ExplorationConfig {
  if (isFactFunnelMetric(metric)) {
    return {
      ...DEFAULT_EXPLORE_STATE,
      datasource: metric.datasource,
      dateRange,
      type: "funnel",
      dimensions: [],
      chartType: "bar",
      dataset: funnelSettingsToFunnelDataset(metric.funnelSettings, unit),
    };
  }
  const dailyAverage =
    metric.metricType === "quantile" ||
    metric.numerator.aggregation === "max" ||
    metric.numerator.aggregation === "count distinct";
  return {
    ...DEFAULT_EXPLORE_STATE,
    datasource: metric.datasource,
    dateRange,
    type: "metric",
    chartType: "bar",
    ...(metric.metricType === "mean"
      ? { showAs: dailyAverage ? ("per_unit" as const) : ("total" as const) }
      : {}),
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          metricId: metric.id,
          ...(draft
            ? {
                draftMetric: draftExplorationMetricValidator
                  .strip()
                  .parse(metric),
              }
            : {}),
          name: metric.name,
          rowFilters: [],
          unit,
          denominatorUnit,
        },
      ],
    },
  };
}

export function getMetricPreviewSummary(
  rows: ProductAnalyticsResultRow[],
  metric: Pick<FactMetricInterface, "metricType" | "numerator">,
) {
  const cells = rows
    .flatMap((row) => (row.values?.[0] ? [row.values[0]] : []))
    .filter((cell) => cell.numerator !== null);
  if (!cells.length) return null;
  const numerator = cells.reduce(
    (total, cell) => total + (cell.numerator ?? 0),
    0,
  );
  const denominator = cells.some((cell) => cell.denominator !== null)
    ? cells.reduce((total, cell) => total + (cell.denominator ?? 0), 0)
    : null;
  const quotient =
    denominator !== null && denominator !== 0 ? numerator / denominator : null;
  const dailyAverage =
    metric.metricType === "quantile" ||
    (metric.metricType === "mean" &&
      (metric.numerator?.aggregation === "max" ||
        metric.numerator?.aggregation === "count distinct"));
  const dailyValues = cells.flatMap((cell) => {
    if (cell.denominator === 0) return [];
    return [(cell.numerator ?? 0) / (cell.denominator ?? 1)];
  });
  return {
    value:
      metric.metricType === "ratio"
        ? quotient
        : dailyAverage
          ? dailyValues.length
            ? dailyValues.reduce((total, value) => total + value, 0) /
              dailyValues.length
            : null
          : numerator,
    numerator,
    denominator,
    quotient,
    label:
      metric.metricType === "ratio"
        ? "Ratio of 7-day totals"
        : dailyAverage
          ? "Average of daily values"
          : metric.metricType === "proportion"
            ? "Sum of daily unit counts"
            : "7-day total",
  };
}
