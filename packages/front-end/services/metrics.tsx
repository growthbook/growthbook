import { MetricType } from "back-end/types/metric";
import {
  GlobalPermission,
  ProjectScopedPermission,
} from "back-end/types/organization";
import {
  ColumnInterface,
  ColumnRef,
  FactTableInterface,
} from "back-end/types/fact-table";
import { ExperimentMetricInterface } from "shared/experiments";
import { PermissionFunctions } from "@/services/UserContext";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export const defaultWinRiskThreshold = 0.0025;
export const defaultLoseRiskThreshold = 0.0125;

export function getMetricConversionTitle(type: MetricType): string {
  // TODO: support more metric types
  if (type === "count") {
    return "Count per User";
  }
  if (type === "duration") {
    return "Duration";
  }
  if (type === "revenue") {
    return "Revenue";
  }
  return "Conversion Rate";
}

export function formatCurrency(value: number, currency?: string) {
  // Don't show fractional currency if the value is large
  if (value > 1000) {
    const bigCurrencyFormatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return bigCurrencyFormatter.format(value);
  }
  const currencyFormatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
  });
  return currencyFormatter.format(value);
}
export function formatDurationSeconds(value: number) {
  // < 1 second
  if (value < 1) {
    return Math.round(value * 1000) + "ms";
  }
  // < 1 minute
  if (value < 60) {
    return Math.round(value * 1000) / 1000 + "s";
  }
  // > 1 day
  if (value >= 3600 * 24) {
    const d = value / (3600 * 24);
    const digits = d > 1000 ? 0 : d > 100 ? 1 : d > 10 ? 2 : 3;
    const formatter = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return formatter.format(d) + " days";
  }

  // otherwise, format as time string (00:00:00.0)
  const trimmed = Math.round(value * 10) / 10;
  const dec = (Math.round((trimmed % 1) * 10) + "").replace(/0$/, "");
  const s = "" + (Math.floor(trimmed) % 60);
  const m = "" + (Math.floor(trimmed / 60) % 60);
  const h = "" + (Math.floor(trimmed / 3600) % 24);

  let f = "";

  // Only include hours if the duration is longer than 1 hour
  if (trimmed >= 3600) {
    f += h.padStart(2, "0") + ":";
  }

  // Always include the minutes and seconds
  f += m.padStart(2, "0") + ":" + s.padStart(2, "0");

  // Only include a decimal portion if duration is less than 5 minutes
  if (trimmed < 300 && dec) {
    f += "." + dec;
  }

  return f;
}
export function formatNumber(value: number) {
  const digits = value > 1000 ? 0 : value > 100 ? 1 : value > 10 ? 2 : 3;
  // Show fewer fractional digits for bigger numbers
  const formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  return formatter.format(value);
}
export function formatPercent(value: number) {
  return percentFormatter.format(value);
}

export function formatColumnValue(
  column: ColumnInterface,
  value: number,
  currency?: string
): string {
  switch (column.numberFormat) {
    case "":
      return formatNumber(value);
    case "currency":
      return formatCurrency(value, currency);
    case "time:seconds":
      return formatDurationSeconds(value);
  }
}

export function formatColumnRefValue(
  columnRef: ColumnRef,
  getFactTableById: (id: string) => FactTableInterface | null,
  value: number,
  currency?: string,
  ratio?: boolean
) {
  if (columnRef.column === "$$count") {
    return formatNumber(value);
  }
  if (columnRef.column === "$$distinctUsers" && !ratio) {
    return formatPercent(value);
  }

  const fact = getFactTableById(columnRef.factTableId)?.columns?.find(
    (c) => c.column === columnRef.column
  );
  if (!fact) return formatNumber(value);

  return formatColumnValue(fact, value, currency);
}

export function formatMetricValue(
  metric: ExperimentMetricInterface,
  value: number,
  getFactTableById: (id: string) => FactTableInterface | null,
  currency?: string
): string {
  value = value || 0;

  // Old metric
  if ("type" in metric) {
    return formatConversionRate(metric.type, value, currency);
  }

  // Fact metric
  switch (metric.metricType) {
    case "proportion":
      return formatPercent(value);
    case "ratio":
      return (() => {
        // If the metric is ratio of the same unit, they cancel out
        // For example: profit/revenue = $/$ = plain number
        const numerator = getFactTableById(
          metric.numerator.factTableId
        )?.columns?.find((c) => c.column === metric.numerator.column);
        const denominator =
          metric.denominator &&
          getFactTableById(metric.denominator.factTableId)?.columns?.find(
            (c) => c.column === metric.denominator?.column
          );
        if (
          numerator &&
          denominator &&
          numerator.numberFormat === denominator.numberFormat
        ) {
          return formatNumber(value);
        }

        // Otherwise, just use the numerator to figure out the value type
        return formatColumnRefValue(
          metric.numerator,
          getFactTableById,
          value,
          currency
        );
      })();

    case "mean":
      return formatColumnRefValue(
        metric.numerator,
        getFactTableById,
        value,
        currency
      );
  }
}

export function formatConversionRate(
  type: MetricType,
  value: number,
  currency?: string
): string {
  value = value || 0;
  if (type === "count") {
    return formatNumber(value);
  }
  if (type === "duration") {
    return formatDurationSeconds(value);
  }
  if (type === "revenue") {
    return formatCurrency(value, currency);
  }

  return formatPercent(value);
}

export function checkMetricProjectPermissions(
  metric: { projects?: string[] },
  permissions: Record<GlobalPermission, boolean> & PermissionFunctions,
  permission: ProjectScopedPermission = "createMetrics"
): boolean {
  let hasPermission = true;
  if (metric?.projects?.length) {
    for (const project of metric.projects) {
      hasPermission = permissions.check(permission, project);
      if (!hasPermission) break;
    }
  } else {
    hasPermission = permissions.check(permission, "");
  }
  return hasPermission;
}
