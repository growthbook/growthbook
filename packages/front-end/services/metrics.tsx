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

export function formatCurrency(
  value: number,
  options: Intl.NumberFormatOptions
) {
  const cleanedOptions = {
    ...options,
    currency: options?.currency || "USD",
  };
  // Don't show fractional currency if the value is large
  if (value > 1000) {
    const bigCurrencyFormatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      ...cleanedOptions,
    });
    return bigCurrencyFormatter.format(value);
  }
  const currencyFormatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    ...cleanedOptions,
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
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions
) {
  const absValue = Math.abs(value);
  const digits =
    absValue > 1000 ? 0 : absValue > 100 ? 1 : absValue > 10 ? 2 : 3;
  // Show fewer fractional digits for bigger numbers
  const formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
    ...options,
  });
  return formatter.format(value);
}
export function formatPercent(
  value: number,
  options?: Intl.NumberFormatOptions
) {
  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumSignificantDigits: 3,
    ...options,
  });
  return percentFormatter.format(value);
}

export function getColumnFormatter(
  column: ColumnInterface
): (value: number, options?: Intl.NumberFormatOptions) => string {
  switch (column.numberFormat) {
    case "":
      return formatNumber;
    case "currency":
      return formatCurrency;
    case "time:seconds":
      return formatDurationSeconds;
  }
}

export function getColumnRefFormatter(
  columnRef: ColumnRef,
  getFactTableById: (id: string) => FactTableInterface | null
): (value: number, options?: Intl.NumberFormatOptions) => string {
  if (
    columnRef.column === "$$count" ||
    columnRef.column === "$$distinctUsers"
  ) {
    return formatNumber;
  }

  const fact = getFactTableById(columnRef.factTableId)?.columns?.find(
    (c) => c.column === columnRef.column
  );
  if (!fact) return formatNumber;

  return getColumnFormatter(fact);
}

export function getExperimentMetricFormatter(
  metric: ExperimentMetricInterface,
  getFactTableById: (id: string) => FactTableInterface | null,
  formatProportionAsNumber: boolean = false
): (value: number, options?: Intl.NumberFormatOptions) => string {
  // Old metric
  if ("type" in metric) {
    return getMetricFormatter(
      metric.type === "binomial" && formatProportionAsNumber
        ? "count"
        : metric.type
    );
  }

  // Fact metric
  switch (metric.metricType) {
    case "proportion":
      if (formatProportionAsNumber) {
        return formatNumber;
      }
      return formatPercent;
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
          return formatNumber;
        }

        // Otherwise, just use the numerator to figure out the value type
        return getColumnRefFormatter(metric.numerator, getFactTableById);
      })();

    case "quantile":
    case "mean":
    default:
      return getColumnRefFormatter(metric.numerator, getFactTableById);
  }
}

export function getMetricFormatter(
  type: MetricType
): (value: number, options?: Intl.NumberFormatOptions) => string {
  if (type === "count") {
    return formatNumber;
  }
  if (type === "duration") {
    return formatDurationSeconds;
  }
  if (type === "revenue") {
    return formatCurrency;
  }

  return formatPercent;
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
