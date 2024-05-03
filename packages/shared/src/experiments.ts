import { MetricInterface } from "back-end/types/metric";
import {
  FactMetricInterface,
  FactTableMap,
  MetricQuantileSettings,
  MetricWindowSettings,
} from "back-end/types/fact-table";
import { TemplateVariables } from "back-end/types/sql";
import {
  MetricDefaults,
  OrganizationSettings,
} from "back-end/types/organization";
import { MetricOverride } from "back-end/types/experiment";
import { MetricSnapshotSettings } from "back-end/types/report";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import { StatsEngine } from "back-end/types/stats";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
} from "./constants";

export type ExperimentMetricInterface = MetricInterface | FactMetricInterface;

export function isFactMetricId(id: string): boolean {
  return !!id.match(/^fact__/);
}

export function isFactMetric(
  m: ExperimentMetricInterface
): m is FactMetricInterface {
  return "metricType" in m;
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
  if (isFactMetric(m)) return m.metricType === "proportion";
  return m.type === "binomial";
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
  return (
    (m.regressionAdjustmentDays ?? 0) > 0 &&
    !!m.regressionAdjustmentEnabled &&
    !isRatioMetric(m, denominatorMetric) &&
    !quantileMetricType(m)
  );
}

export function getConversionWindowHours(
  windowSettings: MetricWindowSettings
): number {
  const value = windowSettings.windowValue;
  if (windowSettings.windowUnit === "hours") return value;
  if (windowSettings.windowUnit === "days") return value * 24;
  if (windowSettings.windowUnit === "weeks") return value * 24 * 7;

  // TODO
  return 72;
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
    if (metric && isFactMetric(metric) && isRatioMetric(metric)) {
      // is this a fact ratio metric?
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "ratio metrics not supported";
    }
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
        regressionAdjustmentReason = `denominator is ${denominator.type}`;
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
  statsEngine,
  experimentRegressionAdjustmentEnabled,
  experimentMetricOverrides = [],
  datasourceType,
  hasRegressionAdjustmentFeature,
}: {
  allExperimentMetrics: (ExperimentMetricInterface | null)[];
  denominatorMetrics: MetricInterface[];
  orgSettings: OrganizationSettings;
  statsEngine: string;
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
  if (statsEngine === "bayesian") {
    regressionAdjustmentAvailable = false;
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
    metric.minSampleSize || metricDefaults.minimumSampleSize || 0;

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
    if (_shouldHighlight && (stats.chanceToWin ?? 0) > ciUpper) {
      resultsStatus = "won";
    } else if (_shouldHighlight && (stats.chanceToWin ?? 0) < ciLower) {
      resultsStatus = "lost";
    }
    if (
      enoughData &&
      belowMinChange &&
      ((stats.chanceToWin ?? 0) > ciUpper || (stats.chanceToWin ?? 0) < ciLower)
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
  return {
    shouldHighlight: _shouldHighlight,
    belowMinChange,
    significant,
    significantUnadjusted,
    directionalStatus,
    resultsStatus,
  };
}
