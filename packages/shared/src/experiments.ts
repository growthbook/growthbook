import { MetricInterface } from "back-end/types/metric";
import {
  ColumnRef,
  FactMetricInterface,
  FactTableColumnType,
  FactTableInterface,
  FactTableMap,
  MetricQuantileSettings,
  MetricWindowSettings,
} from "back-end/types/fact-table";
import { TemplateVariables } from "back-end/types/sql";
import {
  MetricDefaults,
  OrganizationSettings,
} from "back-end/types/organization";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  MetricOverride,
} from "back-end/types/experiment";
import { MetricSnapshotSettings } from "back-end/types/report";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  DataSourceSettings,
} from "back-end/types/datasource";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { StatsEngine } from "back-end/types/stats";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import uniqid from "uniqid";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
} from "./constants";

export type ExperimentMetricInterface = MetricInterface | FactMetricInterface;

export function isFactMetricId(id: string): boolean {
  return !!id.match(/^fact__/);
}

export function isMetricGroupId(id: string): boolean {
  return !!id.match(/^mg_/);
}

export function isFactMetric(
  m: ExperimentMetricInterface
): m is FactMetricInterface {
  return "metricType" in m;
}

export function canInlineFilterColumn(
  factTable: Pick<FactTableInterface, "userIdTypes" | "columns">,
  column: string
): boolean {
  // If the column is one of the identifier columns, it is not eligible for prompting
  if (factTable.userIdTypes.includes(column)) return false;

  if (
    getSelectedColumnDatatype({ factTable, column, excludeDeleted: true }) !==
    "string"
  ) {
    return false;
  }

  return true;
}

export function getColumnExpression(
  column: string,
  factTable: Pick<FactTableInterface, "columns">,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string,
  alias: string = ""
): string {
  const parts = column.split(".");
  if (parts.length > 1) {
    const col = factTable.columns.find((c) => c.column === parts[0]);
    if (col?.datatype === "json") {
      const path = parts.slice(1).join(".");

      const field = col.jsonFields?.[path];
      const isNumeric = field?.datatype === "number";

      return jsonExtract(
        alias ? `${alias}.${parts[0]}` : parts[0],
        path,
        isNumeric
      );
    }
  }

  return alias ? `${alias}.${column}` : column;
}

export function getColumnRefWhereClause(
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">,
  columnRef: ColumnRef,
  escapeStringLiteral: (s: string) => string,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string,
  showSourceComment = false
): string[] {
  const inlineFilters = columnRef.inlineFilters || {};
  const filterIds = columnRef.filters || [];

  const where = new Set<string>();

  // First add inline filters
  Object.entries(inlineFilters).forEach(([column, values]) => {
    const escapedValues = new Set(
      values
        .filter((v) => v.length > 0)
        .map((v) => "'" + escapeStringLiteral(v) + "'")
    );

    const columnExpr = getColumnExpression(column, factTable, jsonExtract);

    if (!escapedValues.size) {
      return;
    } else if (escapedValues.size === 1) {
      where.add(`${columnExpr} = ${[...escapedValues][0]}`);
    } else {
      where.add(`${columnExpr} IN (\n  ${[...escapedValues].join(",\n  ")}\n)`);
    }
  });

  // Then add additional filters
  filterIds.forEach((filterId) => {
    const filter = factTable.filters.find((f) => f.id === filterId);
    if (filter) {
      const comment = showSourceComment ? `-- Filter: ${filter.name}\n` : "";
      where.add(comment + filter.value);
    }
  });

  return [...where];
}

export function getAggregateFilters({
  columnRef,
  column,
  ignoreInvalid = false,
}: {
  columnRef: Pick<
    ColumnRef,
    "aggregateFilter" | "aggregateFilterColumn" | "column"
  > | null;
  column: string;
  ignoreInvalid?: boolean;
}) {
  if (!columnRef?.aggregateFilter) return [];
  if (!columnRef.aggregateFilterColumn) return [];

  // Only support distinctUsers for now
  if (columnRef.column !== "$$distinctUsers") return [];

  const parts = columnRef.aggregateFilter.replace(/\s*/g, "").split(",");

  const filters: string[] = [];
  parts.forEach((part) => {
    if (!part) return;

    // i.e. ">10" or "!=5.1"
    const match = part.match(/^(=|!=|<>|<|<=|>|>=)(\d+(\.\d+)?)$/);
    if (match) {
      const [, operator, value] = match;
      filters.push(`${column} ${operator} ${value}`);
    } else if (!ignoreInvalid) {
      throw new Error(`Invalid user filter: ${part}`);
    }
  });

  return filters;
}

export function getMetricTemplateVariables(
  m: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  useDenominator?: boolean
): TemplateVariables {
  if (isFactMetric(m)) {
    const columnRef = useDenominator ? m.denominator : m.numerator;
    if (!columnRef) return {};

    const factTable = factTableMap.get(columnRef.factTableId);
    if (!factTable) return {};

    return {
      eventName: factTable.eventName,
    };
  }

  return m.templateVariables || {};
}

export function isBinomialMetric(m: ExperimentMetricInterface) {
  if (isFactMetric(m))
    return ["proportion", "retention"].includes(m.metricType);
  return m.type === "binomial";
}

export function isRetentionMetric(m: ExperimentMetricInterface) {
  return isFactMetric(m) && m.metricType === "retention";
}

export function isRatioMetric(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface
): boolean {
  if (isFactMetric(m)) return m.metricType === "ratio";
  return !!denominatorMetric && !isBinomialMetric(denominatorMetric);
}

export function quantileMetricType(
  m: ExperimentMetricInterface
): "" | MetricQuantileSettings["type"] {
  if (isFactMetric(m) && m.metricType === "quantile") {
    return m.quantileSettings?.type || "";
  }
  return "";
}

export function isFunnelMetric(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface
): boolean {
  if (isFactMetric(m)) return false;
  return !!denominatorMetric && isBinomialMetric(denominatorMetric);
}

export function isRegressionAdjusted(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface
) {
  const isLegacyRatioMetric: boolean =
    isRatioMetric(m, denominatorMetric) && !isFactMetric(m);
  return (
    (m.regressionAdjustmentDays ?? 0) > 0 &&
    !!m.regressionAdjustmentEnabled &&
    !isLegacyRatioMetric &&
    !quantileMetricType(m)
  );
}

export function getConversionWindowHours(
  windowSettings: MetricWindowSettings
): number {
  const value = windowSettings.windowValue;
  if (windowSettings.windowUnit === "minutes") return value / 60;
  if (windowSettings.windowUnit === "hours") return value;
  if (windowSettings.windowUnit === "days") return value * 24;
  if (windowSettings.windowUnit === "weeks") return value * 24 * 7;

  return 72;
}

export function getDelayWindowHours(
  windowSettings: MetricWindowSettings
): number {
  const value = windowSettings.delayValue;
  if (windowSettings.delayUnit === "minutes") return value / 60;
  if (windowSettings.delayUnit === "hours") return value;
  if (windowSettings.delayUnit === "days") return value * 24;
  if (windowSettings.delayUnit === "weeks") return value * 24 * 7;

  return 0;
}

export function getSelectedColumnDatatype({
  factTable,
  column,
  excludeDeleted = false,
}: {
  factTable: Pick<FactTableInterface, "columns"> | null;
  column: string;
  excludeDeleted?: boolean;
}): FactTableColumnType | undefined {
  if (!factTable) return undefined;

  // Might be a JSON column, look at nested field
  const parts = column.split(".");
  if (parts.length > 1) {
    const col = factTable.columns.find((c) => c.column === parts[0]);
    if (col?.datatype === "json" && (!excludeDeleted || !col?.deleted)) {
      const field = col.jsonFields?.[parts.slice(1).join(".")];
      if (field) {
        return field.datatype;
      }
    }
  }

  const col = factTable.columns.find((c) => c.column === column);
  if (excludeDeleted && (!col || col.deleted)) return undefined;

  return col?.datatype;
}

export function getUserIdTypes(
  metric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  useDenominator?: boolean
): string[] {
  if (isFactMetric(metric)) {
    const factTable = factTableMap.get(
      useDenominator
        ? metric.denominator?.factTableId || ""
        : metric.numerator.factTableId
    );
    return factTable?.userIdTypes || [];
  }

  return metric.userIdTypes || [];
}

export function getMetricLink(id: string): string {
  if (isFactMetricId(id)) return `/fact-metrics/${id}`;
  return `/metric/${id}`;
}

export function getMetricSnapshotSettings<T extends ExperimentMetricInterface>({
  metric,
  denominatorMetrics,
  experimentRegressionAdjustmentEnabled,
  organizationSettings,
  metricOverrides,
}: {
  metric: T;
  denominatorMetrics: MetricInterface[];
  experimentRegressionAdjustmentEnabled: boolean;
  organizationSettings?: Partial<OrganizationSettings>; // can be RA and prior settings from a snapshot of org settings
  metricOverrides?: MetricOverride[];
}): {
  newMetric: T;
  denominatorMetrics: MetricInterface[];
  metricSnapshotSettings: MetricSnapshotSettings;
} {
  const newMetric = cloneDeep<T>(metric);

  // start with default RA settings
  let regressionAdjustmentAvailable = true;
  let regressionAdjustmentEnabled = false;
  let regressionAdjustmentDays = DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
  let regressionAdjustmentReason = "";

  // get RA settings from organization
  if (organizationSettings?.regressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
    regressionAdjustmentDays =
      organizationSettings?.regressionAdjustmentDays ??
      regressionAdjustmentDays;
  }
  if (experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
  }

  // get RA settings from metric
  if (metric?.regressionAdjustmentOverride) {
    regressionAdjustmentEnabled = !!metric?.regressionAdjustmentEnabled;
    regressionAdjustmentDays =
      metric?.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
    if (!regressionAdjustmentEnabled) {
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "disabled in metric settings";
    }
  }

  // experiment kill switch
  if (!experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = false;
    regressionAdjustmentAvailable = true;
    regressionAdjustmentReason = "disabled in experiment";
  }

  // start with default prior settings
  const metricPriorSettings = {
    properPrior: false,
    properPriorMean: 0,
    properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
  };

  // get prior settings from organization
  if (organizationSettings?.metricDefaults?.priorSettings) {
    metricPriorSettings.properPrior =
      organizationSettings.metricDefaults.priorSettings.proper;
    metricPriorSettings.properPriorMean =
      organizationSettings.metricDefaults.priorSettings.mean;
    metricPriorSettings.properPriorStdDev =
      organizationSettings.metricDefaults.priorSettings.stddev;
  }

  // get prior settings from metric
  if (metric.priorSettings.override) {
    metricPriorSettings.properPrior = metric.priorSettings.proper;
    metricPriorSettings.properPriorMean = metric.priorSettings.mean;
    metricPriorSettings.properPriorStdDev = metric.priorSettings.stddev;
  }

  // get RA and prior settings from metric override
  if (metricOverrides) {
    const metricOverride = metricOverrides.find((mo) => mo.id === metric.id);

    // RA override
    if (metricOverride?.regressionAdjustmentOverride) {
      regressionAdjustmentEnabled = !!metricOverride?.regressionAdjustmentEnabled;
      regressionAdjustmentDays =
        metricOverride?.regressionAdjustmentDays ?? regressionAdjustmentDays;
      if (!regressionAdjustmentEnabled) {
        regressionAdjustmentAvailable = false;
        if (!metric.regressionAdjustmentEnabled) {
          regressionAdjustmentReason =
            "disabled in metric settings and metric override";
        } else {
          regressionAdjustmentReason = "disabled by metric override";
        }
      } else {
        regressionAdjustmentAvailable = true;
        regressionAdjustmentReason = "";
      }
    }

    // prior override
    if (metricOverride?.properPriorOverride) {
      metricPriorSettings.properPrior =
        metricOverride?.properPriorEnabled ?? metricPriorSettings.properPrior;
      metricPriorSettings.properPriorMean =
        metricOverride?.properPriorMean ?? metricPriorSettings.properPriorMean;
      metricPriorSettings.properPriorStdDev =
        metricOverride?.properPriorStdDev ??
        metricPriorSettings.properPriorStdDev;
    }
  }

  // final gatekeeping for RA
  if (regressionAdjustmentEnabled) {
    if (metric && isFactMetric(metric) && quantileMetricType(metric)) {
      // is this a fact quantile metric?
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "quantile metrics not supported";
    }
    if (metric?.denominator) {
      // is this a classic "ratio" metric (denominator unsupported type)?
      const denominator = denominatorMetrics.find(
        (m) => m.id === metric?.denominator
      );
      if (denominator && !isBinomialMetric(denominator)) {
        regressionAdjustmentEnabled = false;
        regressionAdjustmentAvailable = false;
        regressionAdjustmentReason = `denominator is ${denominator.type}. CUPED available for ratio metrics only if based on fact tables.`;
      }
    }
    if (metric && !isFactMetric(metric) && metric?.aggregation) {
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "custom aggregation";
    }
  }

  regressionAdjustmentDays = regressionAdjustmentEnabled
    ? regressionAdjustmentDays
    : 0;

  newMetric.regressionAdjustmentEnabled = regressionAdjustmentEnabled;
  newMetric.regressionAdjustmentDays = regressionAdjustmentDays;

  return {
    newMetric,
    denominatorMetrics,
    metricSnapshotSettings: {
      metric: newMetric.id,
      ...metricPriorSettings,
      regressionAdjustmentEnabled,
      regressionAdjustmentAvailable,
      regressionAdjustmentDays,
      regressionAdjustmentReason,
    },
  };
}

export function getAllMetricSettingsForSnapshot({
  allExperimentMetrics,
  denominatorMetrics,
  orgSettings,
  experimentRegressionAdjustmentEnabled,
  experimentMetricOverrides = [],
  datasourceType,
  hasRegressionAdjustmentFeature,
}: {
  allExperimentMetrics: (ExperimentMetricInterface | null)[];
  denominatorMetrics: MetricInterface[];
  orgSettings: OrganizationSettings;
  experimentRegressionAdjustmentEnabled?: boolean;
  experimentMetricOverrides?: MetricOverride[];
  datasourceType?: DataSourceInterfaceWithParams["type"];
  hasRegressionAdjustmentFeature: boolean;
}) {
  const settingsForSnapshotMetrics: MetricSnapshotSettings[] = [];
  let regressionAdjustmentAvailable = true;
  let regressionAdjustmentEnabled = true;
  let regressionAdjustmentHasValidMetrics = false;
  if (allExperimentMetrics.length === 0) {
    regressionAdjustmentHasValidMetrics = true; // avoid awkward UI warning
  }
  for (const metric of allExperimentMetrics) {
    if (!metric) continue;
    const { metricSnapshotSettings } = getMetricSnapshotSettings({
      metric: metric,
      denominatorMetrics: denominatorMetrics,
      experimentRegressionAdjustmentEnabled:
        experimentRegressionAdjustmentEnabled ??
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      organizationSettings: orgSettings,
      metricOverrides: experimentMetricOverrides,
    });
    if (metricSnapshotSettings.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = true;
    }
    if (metricSnapshotSettings.regressionAdjustmentAvailable) {
      regressionAdjustmentHasValidMetrics = true;
    }
    settingsForSnapshotMetrics.push(metricSnapshotSettings);
  }
  if (!experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = false;
  }
  if (
    !datasourceType ||
    datasourceType === "google_analytics" ||
    datasourceType === "mixpanel"
  ) {
    // these do not implement getExperimentMetricQuery
    regressionAdjustmentAvailable = false;
    regressionAdjustmentEnabled = false;
  }
  if (!hasRegressionAdjustmentFeature) {
    regressionAdjustmentEnabled = false;
  }
  return {
    regressionAdjustmentAvailable,
    regressionAdjustmentEnabled,
    regressionAdjustmentHasValidMetrics,
    settingsForSnapshotMetrics,
  };
}

export function isExpectedDirection(
  stats: SnapshotMetric,
  metric: { inverse?: boolean }
): boolean {
  const expected: number = stats?.expected ?? 0;
  if (metric.inverse) {
    return expected < 0;
  }
  return expected > 0;
}

export function isStatSig(pValue: number, pValueThreshold: number): boolean {
  return pValue < pValueThreshold;
}

export function shouldHighlight({
  metric,
  baseline,
  stats,
  hasEnoughData,
  belowMinChange,
}: {
  metric: { id: string };
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  hasEnoughData: boolean;
  belowMinChange: boolean;
}): boolean {
  return !!(
    metric &&
    baseline?.value &&
    stats?.value &&
    hasEnoughData &&
    !belowMinChange
  );
}

export function getMetricSampleSize(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: ExperimentMetricInterface
): { baselineValue?: number; variationValue?: number } {
  return quantileMetricType(metric)
    ? {
        baselineValue: baseline?.stats?.count,
        variationValue: stats?.stats?.count,
      }
    : { baselineValue: baseline.value, variationValue: stats.value };
}

export function hasEnoughData(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: ExperimentMetricInterface,
  metricDefaults: MetricDefaults
): boolean {
  const { baselineValue, variationValue } = getMetricSampleSize(
    baseline,
    stats,
    metric
  );
  if (!baselineValue || !variationValue) return false;

  const minSampleSize =
    metric.minSampleSize ?? metricDefaults.minimumSampleSize ?? 0;

  return Math.max(baselineValue, variationValue) >= minSampleSize;
}

export function isSuspiciousUplift(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: { maxPercentChange?: number },
  metricDefaults: MetricDefaults
): boolean {
  if (!baseline?.cr || !stats?.cr) return false;

  const maxPercentChange =
    metric.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0;

  return Math.abs(baseline.cr - stats.cr) / baseline.cr >= maxPercentChange;
}

export function isBelowMinChange(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: { minPercentChange?: number },
  metricDefaults: MetricDefaults
): boolean {
  if (!baseline?.cr || !stats?.cr) return false;

  const minPercentChange =
    metric.minPercentChange ?? metricDefaults.minPercentageChange ?? 0;

  return Math.abs(baseline.cr - stats.cr) / baseline.cr < minPercentChange;
}

export function getMetricResultStatus({
  metric,
  metricDefaults,
  baseline,
  stats,
  ciLower,
  ciUpper,
  pValueThreshold,
  statsEngine,
}: {
  metric: ExperimentMetricInterface;
  metricDefaults: MetricDefaults;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  ciLower: number;
  ciUpper: number;
  pValueThreshold: number;
  statsEngine: StatsEngine;
}) {
  const directionalStatus: "winning" | "losing" =
    (stats.expected ?? 0) * (metric.inverse ? -1 : 1) > 0
      ? "winning"
      : "losing";

  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const belowMinChange = isBelowMinChange(
    baseline,
    stats,
    metric,
    metricDefaults
  );
  const _shouldHighlight = shouldHighlight({
    metric,
    baseline,
    stats,
    hasEnoughData: enoughData,
    belowMinChange,
  });

  let significant: boolean;
  let significantUnadjusted: boolean;
  if (statsEngine === "bayesian") {
    if (
      (stats.chanceToWin ?? 0) > ciUpper ||
      (stats.chanceToWin ?? 0) < ciLower
    ) {
      significant = true;
      significantUnadjusted = true;
    } else {
      significant = false;
      significantUnadjusted = false;
    }
  } else {
    significant = isStatSig(
      stats.pValueAdjusted ?? stats.pValue ?? 1,
      pValueThreshold
    );
    significantUnadjusted = isStatSig(stats.pValue ?? 1, pValueThreshold);
  }

  let resultsStatus: "won" | "lost" | "draw" | "" = "";
  if (statsEngine === "bayesian") {
    if (_shouldHighlight && (stats.chanceToWin ?? 0.5) > ciUpper) {
      resultsStatus = "won";
    } else if (_shouldHighlight && (stats.chanceToWin ?? 0.5) < ciLower) {
      resultsStatus = "lost";
    }
    if (
      enoughData &&
      belowMinChange &&
      ((stats.chanceToWin ?? 0.5) > ciUpper ||
        (stats.chanceToWin ?? 0.5) < ciLower)
    ) {
      resultsStatus = "draw";
    }
  } else {
    if (_shouldHighlight && significant && directionalStatus === "winning") {
      resultsStatus = "won";
    } else if (
      _shouldHighlight &&
      significant &&
      directionalStatus === "losing"
    ) {
      resultsStatus = "lost";
    } else if (enoughData && significant && belowMinChange) {
      resultsStatus = "draw";
    }
  }

  let clearSignalResultsStatus: "won" | "lost" | "" = "";
  // TODO make function of existing thresholds
  if (statsEngine === "bayesian") {
    if (
      _shouldHighlight &&
      (stats.chanceToWin ?? 0.5) > Math.max(0.999, ciUpper)
    ) {
      clearSignalResultsStatus = "won";
    } else if (
      _shouldHighlight &&
      (stats.chanceToWin ?? 0.5) < Math.min(0.001, ciLower)
    ) {
      clearSignalResultsStatus = "lost";
    }
  } else {
    const clearStatSig = isStatSig(
      stats.pValueAdjusted ?? stats.pValue ?? 1,
      Math.min(pValueThreshold, 0.001)
    );
    if (_shouldHighlight && clearStatSig && directionalStatus === "winning") {
      clearSignalResultsStatus = "won";
    } else if (
      _shouldHighlight &&
      clearStatSig &&
      directionalStatus === "losing"
    ) {
      clearSignalResultsStatus = "lost";
    }
  }
  return {
    shouldHighlight: _shouldHighlight,
    belowMinChange,
    significant,
    significantUnadjusted,
    directionalStatus,
    resultsStatus,
    clearSignalResultsStatus,
  };
}

export function getAllMetricIdsFromExperiment(
  exp: {
    goalMetrics?: string[];
    secondaryMetrics?: string[];
    guardrailMetrics?: string[];
    activationMetric?: string | null;
  },
  includeActivationMetric: boolean = true,
  metricGroups: MetricGroupInterface[] = []
) {
  return Array.from(
    new Set(
      expandMetricGroups(
        [
          ...(exp.goalMetrics || []),
          ...(exp.secondaryMetrics || []),
          ...(exp.guardrailMetrics || []),
          ...(includeActivationMetric && exp.activationMetric
            ? [exp.activationMetric]
            : []),
        ],
        metricGroups
      )
    )
  );
}

// Returns n "equal" decimals rounded to 3 places that add up to 1
// The sum always adds to 1. In some cases the values are not equal.
// For example, getEqualWeights(3) returns [0.3334, 0.3333, 0.3333]
export function getEqualWeights(n: number, precision: number = 4): number[] {
  // The power of 10 we need to manipulate weights to the correct precision
  const multiplier = Math.pow(10, precision);

  // Naive even weighting with rounding
  // For n=3, this will result in `0.3333`
  const w = Math.round(multiplier / n) / multiplier;

  // Determine how far off we are from a sum of 1
  // For n=3, this will be 0.9999-1 = -0.0001
  const diff = w * n - 1;

  // How many of the weights do we need to add a correction to?
  // For n=3, we only have to adjust 1 of the weights to make it sum to 1
  const numCorrections = Math.round(Math.abs(diff) * multiplier);
  const delta = (diff < 0 ? 1 : -1) / multiplier;

  return (
    Array(n)
      .fill(0)
      .map((v, i) => +(w + (i < numCorrections ? delta : 0)).toFixed(precision))
      // Put the larger weights first
      .sort((a, b) => b - a)
  );
}

export async function generateTrackingKey(
  exp: Partial<ExperimentInterface>,
  getExperimentByKey?: (
    key: string
  ) => Promise<ExperimentInterface | ExperimentInterfaceStringDates | null>
): Promise<string> {
  // Try to generate a unique tracking key based on the experiment name
  let n = 1;
  let found: null | string = null;
  while (n < 10 && !found) {
    const key = generate(exp.name || exp.id || "", n);
    if (!getExperimentByKey || !(await getExperimentByKey(key))) {
      found = key;
    }
    n++;
  }

  // Fall back to uniqid if couldn't generate
  return found || uniqid();

  function generate(name: string, n: number): string {
    let key = ("-" + name)
      .toLowerCase()
      // Replace whitespace with hyphen
      .replace(/\s+/g, "-")
      // Get rid of all non alpha-numeric characters
      .replace(/[^a-z0-9\-_]*/g, "")
      // Remove stopwords
      .replace(
        /-((a|about|above|after|again|all|am|an|and|any|are|arent|as|at|be|because|been|before|below|between|both|but|by|cant|could|did|do|does|dont|down|during|each|few|for|from|had|has|have|having|here|how|if|in|into|is|isnt|it|its|itself|more|most|no|nor|not|of|on|once|only|or|other|our|out|over|own|same|should|shouldnt|so|some|such|that|than|then|the|there|theres|these|this|those|through|to|too|under|until|up|very|was|wasnt|we|weve|were|what|whats|when|where|which|while|who|whos|whom|why|with|wont|would)-)+/g,
        "-"
      )
      // Collapse duplicate hyphens
      .replace(/-{2,}/g, "-")
      // Remove leading and trailing hyphens
      .replace(/(^-|-$)/g, "");

    // Add number if this is not the first attempt
    if (n > 1) {
      key += "-" + n;
    }

    return key;
  }
}

export function expandMetricGroups(
  metricIds: string[],
  metricGroups: MetricGroupInterface[]
): string[] {
  const metricGroupMap = new Map(metricGroups.map((mg) => [mg.id, mg]));
  const expandedMetricIds: string[] = [];
  metricIds.forEach((id) => {
    if (metricGroupMap.has(id)) {
      expandedMetricIds.push(...(metricGroupMap.get(id)?.metrics || []));
    } else {
      expandedMetricIds.push(id);
    }
  });
  return expandedMetricIds;
}

export function isMetricJoinable(
  metricIdTypes: string[],
  userIdType: string,
  settings?: DataSourceSettings
): boolean {
  if (metricIdTypes.includes(userIdType)) return true;

  if (settings?.queries?.identityJoins) {
    if (
      settings.queries.identityJoins.some(
        (j) =>
          j.ids.includes(userIdType) &&
          j.ids.some((jid) => metricIdTypes.includes(jid))
      )
    ) {
      return true;
    }
  }

  // legacy support for pageviewsQuery
  if (settings?.queries?.pageviewsQuery) {
    if (
      ["user_id", "anonymous_id"].includes(userIdType) &&
      metricIdTypes.some((m) => ["user_id", "anonymous_id"].includes(m))
    ) {
      return true;
    }
  }

  return false;
}
