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
    winRisk: 0,
    loseRisk: 0,
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
          ...(draft ? { draftMetric: getPreviewDraftMetric(metric) } : {}),
          name: draft ? PREVIEW_NAME : metric.name,
          rowFilters: [],
          unit,
          denominatorUnit,
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

// The preview headline is 3rem in a ~330px panel. Compact notation keeps any
// realistic value to about 8 characters ("-999.99T"), so it never runs past
// the panel; tiny values keep their significant digits instead of rounding
// to 0.
export function formatPreviewHeadline(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000) {
    return value.toLocaleString(undefined, {
      notation: "compact",
      maximumFractionDigits: 2,
    });
  }
  if (abs > 0 && abs < 0.001) return value.toExponential(2);
  if (abs > 0 && abs < 1) {
    return value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
