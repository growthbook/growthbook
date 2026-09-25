import { startCase } from "lodash";
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

export function getMetricPreviewUnitLabel(
  unit: string,
  factTable:
    | (Pick<FactTableDefinition, "userIdColumns"> & {
        columns: Pick<
          FactTableDefinition["columns"][number],
          "column" | "name"
        >[];
      })
    | null,
): { label: string; column: string } {
  const column = factTable?.userIdColumns?.[unit] || unit;
  const name = factTable?.columns
    .find((c) => c.column === column)
    ?.name?.trim();
  const commonNames: Record<string, string> = {
    userid: "Users",
    anonymousid: "Anonymous users",
    deviceid: "Devices",
    sessionid: "Sessions",
    accountid: "Accounts",
    organizationid: "Organizations",
    orgid: "Organizations",
    customerid: "Customers",
    visitorid: "Visitors",
  };
  const key = unit.replace(/[_\s-]/g, "").toLowerCase();
  return {
    label:
      name ||
      (Object.prototype.hasOwnProperty.call(commonNames, key)
        ? commonNames[key]
        : startCase(unit)),
    column,
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
  const validRows = rows.filter(
    (row) => (row.values?.[0]?.numerator ?? null) !== null,
  );
  if (!validRows.length) return null;
  const latestDaily =
    metric.metricType === "quantile" || metric.metricType === "proportion";
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
    value: latestDaily ? numerator : quotient,
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
            ? "Latest daily matching units"
            : "Average per unit-day",
  };
}
