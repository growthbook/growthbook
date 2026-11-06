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

// Identifiers every table in the metric shares. Experiments join a ratio's
// numerator and denominator (and a funnel's steps) on one unit, so the preview
// does too.
export function getMetricPreviewUnits(
  metric: FactMetricInterface | null,
  getFactTable: (id: string) => Pick<FactTableDefinition, "userIdTypes"> | null,
): string[] {
  if (!metric) return [];
  if (
    metric.metricType === "quantile" &&
    metric.quantileSettings?.type === "event"
  ) {
    return [];
  }
  const tableIds = isFactFunnelMetric(metric)
    ? metric.funnelSettings.steps.map((step) => step.factTableId)
    : metric.metricType === "ratio" && metric.denominator
      ? [metric.numerator.factTableId, metric.denominator.factTableId]
      : [metric.numerator.factTableId];
  const tables = tableIds.map((id) => getFactTable(id));
  return (tables[0]?.userIdTypes ?? []).filter((unit) =>
    tables.every((table) => table?.userIdTypes.includes(unit)),
  );
}

const PREVIEW_NAME = "Metric preview";

// The draft as sent to the server, with every field the preview SQL never
// reads pinned to a constant. Editing a name, owner, prior, or window then
// reuses the cached result instead of re-running the warehouse query.
// `projects` stays: the server checks it for permissions.
export function getPreviewDraftMetric(metric: FactMetricInterface) {
  const draft = draftExplorationMetricValidator.strip().parse(metric);
  return {
    datasource: draft.datasource,
    projects: draft.projects,
    metricType: draft.metricType,
    numerator: draft.numerator,
    denominator: draft.denominator,
    cappingSettings: draft.cappingSettings,
    quantileSettings: draft.quantileSettings,
    funnelSettings: draft.funnelSettings,
    name: PREVIEW_NAME,
    description: "",
    owner: "",
    tags: [],
    inverse: false,
    windowSettings: {
      type: "" as const,
      delayValue: 0,
      delayUnit: "days" as const,
      windowValue: 0,
      windowUnit: "days" as const,
    },
    priorSettings: { override: false, proper: false, mean: 0, stddev: 1 },
    maxPercentChange: 1,
    minPercentChange: 0,
    minSampleSize: 0,
    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 0,
  };
}

export function getMetricPreviewConfig(
  metric: FactMetricInterface,
  {
    draft,
    unit,
    dateRange,
  }: {
    draft: boolean;
    unit: string | null;
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
  return {
    ...DEFAULT_EXPLORE_STATE,
    datasource: metric.datasource,
    dateRange,
    type: "metric",
    chartType: "bar",
    ...(metric.metricType === "mean" ? { showAs: "per_unit" as const } : {}),
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          metricId: metric.id,
          ...(draft ? { draftMetric: getPreviewDraftMetric(metric) } : {}),
          name: draft ? PREVIEW_NAME : metric.name,
          rowFilters: [],
          unit,
          denominatorUnit: metric.metricType === "ratio" ? unit : null,
        },
      ],
    },
  };
}

// What the numerator and denominator of a previewed value mean, per day and
// summed over the range. Null for types the preview shows as a single count.
export function getMetricPreviewPartLabels(
  metricType: FactMetricInterface["metricType"],
): { numerator: string; denominator: string; denominatorTotal: string } | null {
  if (metricType === "ratio") {
    return {
      numerator: "Numerator",
      denominator: "Denominator",
      denominatorTotal: "Denominator",
    };
  }
  if (metricType === "mean") {
    return {
      numerator: "Total",
      denominator: "Units",
      denominatorTotal: "Unit-days",
    };
  }
  return null;
}

export function getMetricPreviewSummary(
  rows: ProductAnalyticsResultRow[],
  metric: Pick<FactMetricInterface, "metricType" | "numerator">,
) {
  const validRows = rows.filter(
    (row) => (row.values?.[0]?.numerator ?? null) !== null,
  );
  if (!validRows.length) return null;
  // Quantiles can't be summed across days, so they show the latest day.
  // Everything else totals the week: the latest day is usually partial.
  const latestDaily = metric.metricType === "quantile";
  // Conversion rate previews show matching units, not a rate.
  const total = metric.metricType === "proportion";
  const latestRow = validRows.reduce((latest, row) =>
    String(row.dimensions[0] ?? "") > String(latest.dimensions[0] ?? "")
      ? row
      : latest,
  );
  const cells = (latestDaily ? [latestRow] : validRows).flatMap((row) =>
    row.values?.[0] ? [row.values[0]] : [],
  );
  const numerator = cells.reduce(
    (total, cell) => total + (cell.numerator ?? 0),
    0,
  );
  const denominator = cells.every((cell) => cell.denominator !== null)
    ? cells.reduce((total, cell) => total + (cell.denominator ?? 0), 0)
    : null;
  const quotient =
    denominator !== null && denominator !== 0 ? numerator / denominator : null;
  return {
    value: latestDaily || total ? numerator : quotient,
    numerator,
    denominator,
    quotient,
    date: latestDaily ? String(latestRow.dimensions[0] ?? "") : null,
    label:
      metric.metricType === "ratio"
        ? "Ratio of 7-day totals"
        : metric.metricType === "quantile"
          ? "Latest daily quantile"
          : metric.metricType === "proportion"
            ? "Matching units, 7-day total"
            : "Average per unit-day",
  };
}
