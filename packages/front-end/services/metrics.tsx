import { MetricType } from "shared/types/metric";
import {
  ColumnInterface,
  ColumnRef,
  FactTableDefinition,
  FactMetricInterface,
  FunnelSettings,
  RowFilter,
  StandardFactMetricInterface,
} from "shared/types/fact-table";
import { CreateProps } from "shared/types/base-model";
import {
  getCappingTailState,
  isCappableFactMetric,
  validateCappingSettingsIgnoreZerosConsistency,
  validateCappingSettingsOrdering,
} from "shared/validators";
import {
  getInlineFilterPromptColumns,
  ExperimentMetricDefinition,
  isEmptyInlineFilterPlaceholder,
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
} from "shared/types/organization";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { formatByteSizeString, getNumberFormatDigits } from "shared/util";
import { decimalToPercent } from "@/services/utils";
import { getNewExperimentDatasourceDefaults } from "@/components/Experiment/NewExperimentForm";

export function getInitialInlineFilters(
  factTable: Pick<
    FactTableDefinition,
    "columns" | "userIdTypes" | "userIdColumns"
  >,
  existingRowFilters?: RowFilter[],
): RowFilter[] {
  const rowFilters = [...(existingRowFilters || [])];
  getInlineFilterPromptColumns(factTable, rowFilters).forEach((column) => {
    if (!rowFilters.some((rf) => rf.column === column)) {
      rowFilters.push({
        column,
        operator: "=",
        values: [""],
      });
    }
  });
  return rowFilters;
}

/**
 * Metric forms in the app only build metrics that describe their events with a
 * ColumnRef. Funnel metrics are created and edited elsewhere.
 */
export type CreateStandardFactMetricProps =
  CreateProps<StandardFactMetricInterface>;

// "funnel" so one form can author every metric type, and widens funnelSettings
// to its real type (StandardFactMetricInterface's own funnelSettings is the
// literal `null` - a discriminated-union member, not this form's concern) so
// a funnel metric's steps can live on the form like every other field instead
// of in separate state. numerator stays ColumnRef (never null): widening it
// too would ripple into FactMetricModal.tsx, which shares this type and reads
// numerator.* at ~60 call sites assuming it's never null - so a funnel
// metric's numerator is still a stale, ignored placeholder on the form,
// explicitly nulled out at the create/update payload boundary instead
// (MetricWorkspace's handleSave), the same way FactMetricModal already does.
export type CreateFactMetricFormProps = Omit<
  CreateStandardFactMetricProps,
  "metricType" | "funnelSettings"
> & {
  metricType: FactMetricInterface["metricType"];
  funnelSettings: FunnelSettings | null;
};

export function getDefaultFactMetricProps({
  metricDefaults,
  existing,
  settings,
  project,
  datasources,
  initialFactTable,
  initialDatasource,
  managedBy,
}: {
  metricDefaults: MetricDefaults;
  settings: OrganizationSettings;
  project?: string;
  datasources: DataSourceInterfaceWithParams[];
  existing?: Partial<FactMetricInterface>;
  initialFactTable?: FactTableDefinition;
  // Starting data source when no fact table is chosen yet (e.g. "Add" from a
  // data source's page) - otherwise the org default wins.
  initialDatasource?: string;
  managedBy?: "" | "api" | "admin";
}): CreateFactMetricFormProps & { targetMDE: number } {
  const existingMetricType = existing?.metricType;
  return {
    name: existing?.name || "",
    owner: existing?.owner || "",
    description: existing?.description || "",
    tags: existing?.tags || [],
    metricType: existingMetricType || "proportion",
    numerator: existing?.numerator || {
      factTableId: initialFactTable?.id || "",
      column: "$$count",
      rowFilters: initialFactTable
        ? getInitialInlineFilters(initialFactTable)
        : [],
    },
    projects: existing?.projects || [],
    denominator: existing?.denominator || null,
    datasource:
      existing?.datasource ||
      getNewExperimentDatasourceDefaults({
        datasources,
        settings,
        project,
        initialValue: {
          datasource: initialFactTable?.datasource ?? initialDatasource,
        },
      }).datasource,
    inverse: existing?.inverse || false,
    cappingSettings: existing?.cappingSettings || {
      type: "",
      value: 0,
    },
    lowerCappingSettings: existing?.lowerCappingSettings ?? null,
    managedBy: managedBy || "",
    quantileSettings: existing?.quantileSettings || null,
    // Always null here regardless of `existing` - FactMetricModal (the only
    // caller that doesn't overlay a real value afterward) tracks funnel
    // steps in its own separate state and never reads this field.
    // MetricWorkspace overlays the real value from `existing` itself.
    funnelSettings: null,
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

// getDefaultFactMetricProps returns targetMDE/minPercentChange/maxPercentChange
// as raw fractions (0.05) - the API's own unit. Every UI that edits a fact
// metric shows these as whole percents (5) instead, so this is the one
// adapter between the two: call it right after getDefaultFactMetricProps to
// seed a form, and fromFactMetricFormValues (below) to undo it before
// sending a payload back to the API. winRisk/loseRisk are excluded: neither
// is displayed by MetricEditor's form, so they pass through unscaled.
export function toFactMetricFormValues(
  defaults: CreateFactMetricFormProps & { targetMDE: number },
): CreateFactMetricFormProps {
  return {
    ...defaults,
    targetMDE: defaults.targetMDE * 100,
    minPercentChange: defaults.minPercentChange * 100,
    maxPercentChange: defaults.maxPercentChange * 100,
  };
}

// Inverse of toFactMetricFormValues, plus the submit-time normalization
// FactMetricModal applies that applyFormType's type-switch resets don't
// cover: resetting displayAsPercentage for types that don't use it, and
// rejecting a capping type with no value.
export function fromFactMetricFormValues(
  values: CreateFactMetricFormProps,
): CreateFactMetricFormProps {
  const result = { ...values };
  if (result.targetMDE) result.targetMDE = result.targetMDE / 100;
  result.minPercentChange = result.minPercentChange / 100;
  result.maxPercentChange = result.maxPercentChange / 100;

  if (
    result.metricType !== "ratio" &&
    result.metricType !== "dailyParticipation"
  ) {
    result.displayAsPercentage = undefined;
  } else if (
    result.metricType === "dailyParticipation" &&
    result.displayAsPercentage === undefined
  ) {
    result.displayAsPercentage = true;
  }

  // Type-dependent resets the old modal applied on submit. applyFormType only
  // runs when the user switches type, so a template or duplicate seed would
  // otherwise save whatever it came with.
  const type = result.metricType;
  if (type !== "funnel") {
    const numerator = { ...result.numerator };
    if (type === "proportion" || type === "retention") {
      numerator.column = "$$distinctUsers";
      numerator.aggregation = undefined;
    } else if (type === "dailyParticipation") {
      numerator.column = "$$distinctDates";
      numerator.aggregation = undefined;
    }
    // A user filter (aggregateFilter) only applies to proportion, retention,
    // and a ratio numerator on unique users.
    if (
      !(type === "proportion" || type === "retention" || type === "ratio") ||
      (type === "ratio" && numerator.column !== "$$distinctUsers")
    ) {
      numerator.aggregateFilterColumn = undefined;
    }
    if (!numerator.aggregateFilterColumn) numerator.aggregateFilter = undefined;
    result.numerator = numerator;
  }
  if (type !== "quantile") result.quantileSettings = null;
  if (type !== "ratio") result.denominator = null;

  if (!isCappableFactMetric(type)) {
    if (result.cappingSettings?.type) {
      result.cappingSettings = {
        ...result.cappingSettings,
        type: "",
        value: 0,
      };
    }
    result.lowerCappingSettings = null;
  } else if (
    type === "ratio" &&
    result.lowerCappingSettings?.type === "absolute"
  ) {
    // Ratio metrics only support percentile capping.
    result.lowerCappingSettings = null;
  }

  if (result.cappingSettings?.type && !result.cappingSettings.value) {
    throw new Error("Capped Value cannot be 0");
  }

  if (!result.datasource) {
    throw new Error("Must select a Data Source");
  }

  // Unfilled inline-filter prompts are UI placeholders, not filters. Saved as
  // `col = ''` they would match almost no rows.
  const dropPlaceholders = (rowFilters: RowFilter[] | undefined) =>
    rowFilters?.filter((rf) => !isEmptyInlineFilterPlaceholder(rf));
  if (type === "funnel") {
    if (result.funnelSettings) {
      result.funnelSettings = {
        ...result.funnelSettings,
        steps: result.funnelSettings.steps.map((step) => ({
          ...step,
          rowFilters: dropPlaceholders(step.rowFilters) ?? [],
        })),
      };
    }
  } else {
    result.numerator = {
      ...result.numerator,
      rowFilters: dropPlaceholders(result.numerator.rowFilters),
    };
    if (result.denominator) {
      result.denominator = {
        ...result.denominator,
        rowFilters: dropPlaceholders(result.denominator.rowFilters),
      };
    }
  }

  return result;
}

// Anonymized telemetry props for creating or editing a fact metric - which
// settings people use. Shared by the old modal and the full-page editor so
// the new-metric-creation-flow experiment compares like with like.
export function getFactMetricTrackProps(
  values: {
    metricType: FactMetricInterface["metricType"];
    numerator: ColumnRef | null;
    denominator: ColumnRef | null;
    cappingSettings: FactMetricInterface["cappingSettings"];
    windowSettings: FactMetricInterface["windowSettings"];
  },
  source: string,
  flow: "modal" | "page",
) {
  if (values.metricType === "funnel" || !values.numerator) {
    return { type: values.metricType, source, flow };
  }
  const agg = (ref: ColumnRef | null) =>
    !ref?.column
      ? "none"
      : ref.column === "$$count"
        ? "count"
        : ref.column === "$$distinctUsers"
          ? "distinct_users"
          : ref.column === "$$distinctDates"
            ? "distinct_dates"
            : ref.aggregation || "sum";
  return {
    type: values.metricType,
    source,
    flow,
    capping: values.cappingSettings.type,
    conversion_window: values.windowSettings.type
      ? `${values.windowSettings.windowValue} ${values.windowSettings.windowUnit}`
      : "none",
    numerator_agg: agg(values.numerator),
    numerator_filters: values.numerator.rowFilters?.length || 0,
    denominator_agg: agg(values.denominator),
    denominator_filters: values.denominator?.rowFilters?.length || 0,
    ratio_same_fact_table:
      values.metricType === "ratio" &&
      values.numerator.factTableId === values.denominator?.factTableId,
  };
}

// Save-time checks for values the editor's inputs can't stop on their own
// (Save doesn't go through a native form submit). Runs on the output of
// fromFactMetricFormValues, so percents are already fractions. Kept separate
// so the live preview can still run on a half-filled draft.
export function validateFactMetricFormValues(
  values: CreateFactMetricFormProps,
): void {
  const isNumber = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n);
  const type = values.metricType;

  if (type !== "funnel") {
    const numerator = values.numerator;
    if (numerator.aggregateFilterColumn && !numerator.aggregateFilter?.trim()) {
      throw new Error("Enter a threshold comparison, such as >= 3.");
    }
    if (
      numerator.aggregateFilterColumn &&
      getCappingTailState(values.cappingSettings, values.lowerCappingSettings)
        .anyCap
    ) {
      throw new Error(
        "Cannot use both capping and a user filter. Remove one of them.",
      );
    }
  }

  const capping = values.cappingSettings;
  if (capping?.type) {
    if (!isNumber(capping.value) || capping.value <= 0) {
      throw new Error("Enter a capped value greater than 0.");
    }
    if (capping.type === "percentile" && capping.value >= 1) {
      throw new Error(
        "Enter the percentile cap as a decimal between 0 and 1, such as 0.95.",
      );
    }
  }
  const lower = values.lowerCappingSettings;
  if (lower?.type) {
    if (!isNumber(lower.value)) {
      throw new Error("Enter a lower capped value.");
    }
    if (lower.type === "percentile" && (lower.value <= 0 || lower.value >= 1)) {
      throw new Error(
        "Enter the lower percentile cap as a decimal between 0 and 1, such as 0.05.",
      );
    }
  }
  // Tail ordering and matching ignore-zeros, same checks as the server.
  validateCappingSettingsOrdering(capping, lower);
  validateCappingSettingsIgnoreZerosConsistency(capping, lower);

  const ws = values.windowSettings;
  if (ws) {
    if (!isNumber(ws.delayValue)) throw new Error("Enter a metric delay.");
    if (type === "retention" && ws.delayValue <= 0) {
      throw new Error("Enter a retention delay greater than 0.");
    }
    if (
      (ws.type === "conversion" || ws.type === "lookback") &&
      (!isNumber(ws.windowValue) || ws.windowValue <= 0)
    ) {
      throw new Error("Enter a metric window greater than 0.");
    }
  }

  if (
    values.regressionAdjustmentOverride &&
    values.regressionAdjustmentEnabled &&
    (!isNumber(values.regressionAdjustmentDays) ||
      values.regressionAdjustmentDays <= 0)
  ) {
    throw new Error("Enter a CUPED lookback greater than 0 days.");
  }

  const numericSettings: [string, unknown][] = [
    ["Minimum sample size", values.minSampleSize],
    ["Minimum percent change", values.minPercentChange],
    ["Maximum percent change", values.maxPercentChange],
    ...(values.targetMDE === undefined
      ? []
      : [["Target MDE", values.targetMDE] as [string, unknown]]),
  ];
  for (const [label, value] of numericSettings) {
    if (!isNumber(value) || value < 0) {
      throw new Error(`${label} must be a number of 0 or more.`);
    }
  }
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
  if (value < 0) {
    return "-" + formatDurationSeconds(-value);
  }
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

export function formatDurationMilliseconds(value: number) {
  // Convert milliseconds to seconds and delegate to formatDurationSeconds
  return formatDurationSeconds(value / 1000);
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  const digits = getNumberFormatDigits(value, true);

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
    case "time:milliseconds":
      return formatDurationMilliseconds;
    case "memory:bytes":
      return formatBytes;
    case "memory:kilobytes":
      return formatKilobytes;
    default:
      return formatNumber;
  }
}

export function getColumnRefFormatter(
  columnRef: ColumnRef | null,
  getFactTableById: (id: string) => FactTableDefinition | null,
): (value: number, options?: Intl.NumberFormatOptions) => string {
  if (
    !columnRef ||
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
  metric: ExperimentMetricDefinition,
  getFactTableById: (id: string) => FactTableDefinition | null,
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
    case "dailyParticipation":
      if (metric.displayAsPercentage) {
        return proportionFormat === "percentagePoints"
          ? formatPercentagePoints
          : formatPercent;
      }
      return formatNumber;
    case "proportion":
    case "retention":
    case "funnel":
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
