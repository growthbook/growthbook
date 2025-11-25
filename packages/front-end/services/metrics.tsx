import { MetricType } from "back-end/types/metric";
import {
  ColumnInterface,
  ColumnRef,
  FactTableInterface,
  CreateFactMetricProps,
  FactMetricInterface,
} from "back-end/types/fact-table";
import {
  canInlineFilterColumn,
  ExperimentMetricInterface,
} from "shared/experiments";
import {
  DEFAULT_FACT_METRIC_WINDOW,
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_WIN_RISK_THRESHOLD,
  DEFAULT_MIN_PERCENT_CHANGE,
  DEFAULT_MAX_PERCENT_CHANGE,
  DEFAULT_MIN_SAMPLE_SIZE,
  DEFAULT_TARGET_MDE,
} from "shared/constants";
import {
  MetricDefaults,
  OrganizationSettings,
} from "back-end/types/organization";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { formatByteSizeString, getNumberFormatDigits } from "shared/util";
import { decimalToPercent } from "@/services/utils";
import { getNewExperimentDatasourceDefaults } from "@/components/Experiment/NewExperimentForm";

export function getInitialInlineFilters(
  factTable: FactTableInterface,
  existingInlineFilters?: Record<string, string[]>,
) {
  const inlineFilters = { ...existingInlineFilters };
  factTable.columns
    .filter(
      (c) => c.alwaysInlineFilter && canInlineFilterColumn(factTable, c.column),
    )
    .forEach((c) => {
      if (!inlineFilters[c.column] || !inlineFilters[c.column].length) {
        inlineFilters[c.column] = [""];
      }
    });
  return inlineFilters;
}

export function getDefaultFactMetricProps({
  metricDefaults,
  existing,
  settings,
  project,
  datasources,
  initialFactTable,
  managedBy,
}: {
  metricDefaults: MetricDefaults;
  settings: OrganizationSettings;
  project?: string;
  datasources: DataSourceInterfaceWithParams[];
  existing?: Partial<FactMetricInterface>;
  initialFactTable?: FactTableInterface;
  managedBy?: "" | "api" | "admin";
}): CreateFactMetricProps {
  return {
    name: existing?.name || "",
    owner: existing?.owner || "",
    description: existing?.description || "",
    tags: existing?.tags || [],
    metricType: existing?.metricType || "proportion",
    numerator: existing?.numerator || {
      factTableId: initialFactTable?.id || "",
      column: "$$count",
      filters: [],
      inlineFilters: initialFactTable
        ? getInitialInlineFilters(initialFactTable)
        : {},
    },
    projects: existing?.projects || [],
    denominator: existing?.denominator || null,
    datasource:
      existing?.datasource ||
      getNewExperimentDatasourceDefaults(
        datasources,
        settings,
        project,
        initialFactTable ? { datasource: initialFactTable?.datasource } : {},
      ).datasource,
    inverse: existing?.inverse || false,
    cappingSettings: existing?.cappingSettings || {
      type: "",
      value: 0,
    },
    managedBy: managedBy || "",
    quantileSettings: existing?.quantileSettings || null,
    windowSettings: existing?.windowSettings || {
      type: DEFAULT_FACT_METRIC_WINDOW,
      windowUnit: "days",
      windowValue: 3,
      delayUnit: "hours",
      delayValue: DEFAULT_METRIC_WINDOW_DELAY_HOURS,
    },
    winRisk: existing?.winRisk ?? DEFAULT_WIN_RISK_THRESHOLD,
    loseRisk: existing?.loseRisk ?? DEFAULT_LOSE_RISK_THRESHOLD,
    minPercentChange:
      existing?.minPercentChange ??
      metricDefaults.minPercentageChange ??
      DEFAULT_MIN_PERCENT_CHANGE,
    targetMDE:
      existing?.targetMDE ?? metricDefaults.targetMDE ?? DEFAULT_TARGET_MDE,
    displayAsPercentage: existing?.displayAsPercentage,
    maxPercentChange:
      existing?.maxPercentChange ??
      metricDefaults.maxPercentageChange ??
      DEFAULT_MAX_PERCENT_CHANGE,
    minSampleSize:
      existing?.minSampleSize ??
      metricDefaults.minimumSampleSize ??
      DEFAULT_MIN_SAMPLE_SIZE,
    regressionAdjustmentOverride:
      existing?.regressionAdjustmentOverride || false,
    regressionAdjustmentEnabled:
      existing?.regressionAdjustmentEnabled ||
      DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
    regressionAdjustmentDays:
      existing?.regressionAdjustmentDays ??
      settings.regressionAdjustmentDays ??
      DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
    priorSettings:
      existing?.priorSettings ||
      (metricDefaults.priorSettings ?? {
        override: false,
        proper: false,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
      }),
    metricAutoSlices: existing?.metricAutoSlices || [],
  };
}

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

export function getPercentileLabel(quantile: number): string {
  if (quantile === 0.5) {
    return "Median";
  }
  return `P${decimalToPercent(quantile)}`;
}

export function formatCurrency(
  value: number,
  options: Intl.NumberFormatOptions,
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
  options?: Intl.NumberFormatOptions,
) {
  let digits = getNumberFormatDigits(value);

  // For very small numbers (< 1), find the first significant digit & show 2 digits after it
  const absValue = Math.abs(value);
  if (absValue > 0 && absValue < 1) {
    // Use Math.log10 to find the position of the first significant digit
    const log10 = Math.log10(absValue);
    const decimalPlacesToFirstSig = -Math.floor(log10);
    // Show 2 digits after the first significant digit
    digits = Math.min(decimalPlacesToFirstSig + 1, 15);
  }

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
  options?: Intl.NumberFormatOptions,
) {
  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumSignificantDigits: 3,
    ...options,
  });
  return percentFormatter.format(Math.round(value * 100000) / 100000);
}

export function formatPercentagePoints(value: number) {
  const ppValue = 100 * value;
  const absValue = Math.abs(ppValue);
  const digits = absValue > 100 ? 0 : absValue > 10 ? 1 : absValue > 1 ? 2 : 3;
  // Show fewer fractional digits for bigger numbers
  const formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
  const number = formatter.format(ppValue);
  return `${number} pp`;
}

export function formatBytes(value: number) {
  return formatByteSizeString(value, true);
}

export function formatKilobytes(value: number) {
  return formatByteSizeString(value * 1024, true);
}

export function getColumnFormatter(
  column: ColumnInterface,
): (value: number, options?: Intl.NumberFormatOptions) => string {
  switch (column.numberFormat) {
    case "":
      return formatNumber;
    case "currency":
      return formatCurrency;
    case "time:seconds":
      return formatDurationSeconds;
    case "memory:bytes":
      return formatBytes;
    case "memory:kilobytes":
      return formatKilobytes;
    default:
      return formatNumber;
  }
}

export function getColumnRefFormatter(
  columnRef: ColumnRef,
  getFactTableById: (id: string) => FactTableInterface | null,
): (value: number, options?: Intl.NumberFormatOptions) => string {
  if (
    columnRef.column === "$$count" ||
    columnRef.column === "$$distinctUsers" ||
    columnRef.column === "$$distinctDates"
  ) {
    return formatNumber;
  }

  const fact = getFactTableById(columnRef.factTableId)?.columns?.find(
    (c) => c.column === columnRef.column,
  );
  if (!fact) return formatNumber;

  return getColumnFormatter(fact);
}

export function getExperimentMetricFormatter(
  metric: ExperimentMetricInterface,
  getFactTableById: (id: string) => FactTableInterface | null,
  proportionFormat: "number" | "percentagePoints" | "percentage" = "percentage",
): (value: number, options?: Intl.NumberFormatOptions) => string {
  // Old metric
  if ("type" in metric) {
    if (metric.type === "binomial" && proportionFormat === "number") {
      return getMetricFormatter("count");
    }
    if (metric.type === "binomial" && proportionFormat === "percentagePoints") {
      return formatPercentagePoints;
    }
    return getMetricFormatter(metric.type);
  }

  // Fact metric
  switch (metric.metricType) {
    case "proportion":
    case "retention":
      if (proportionFormat === "number") {
        return formatNumber;
      }
      if (proportionFormat === "percentagePoints") {
        return formatPercentagePoints;
      }
      return formatPercent;
    case "ratio":
      return (() => {
        // If user has set displayAsPercentage to true, format as a percentage
        if (metric.displayAsPercentage) {
          return formatPercent;
        }

        // If the metric is ratio of the same unit, they cancel out
        // For example: profit/revenue = $/$ = plain number
        const numerator = getFactTableById(
          metric.numerator.factTableId,
        )?.columns?.find((c) => c.column === metric.numerator.column);
        const denominator =
          metric.denominator &&
          getFactTableById(metric.denominator.factTableId)?.columns?.find(
            (c) => c.column === metric.denominator?.column,
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
  type: MetricType,
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
