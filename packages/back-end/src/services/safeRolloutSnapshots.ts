import {
  DEFAULT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
} from "shared/constants";
import { isDefined } from "shared/util";
import {
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  isBinomialMetric,
  isFactMetric,
} from "shared/experiments";
import {
  MetricForSnapshot,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotInterface,
} from "back-end/src/validators/safe-rollout";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";

export function getMetricForSnapshot(
  id: string | null | undefined,
  metricMap: Map<string, ExperimentMetricInterface>,
  settingsForSnapshotMetrics: MetricForSnapshot[]
): MetricForSnapshot | null {
  if (!id) return null;
  const metric = metricMap.get(id);
  if (!metric) return null;
  const metricSnapshotSettings = settingsForSnapshotMetrics?.find(
    (s) => s.id === id
  );
  return {
    id,
    settings: {
      datasource: metric.datasource,
      type: isBinomialMetric(metric) ? "binomial" : "count",
      aggregation: ("aggregation" in metric && metric.aggregation) || undefined,
      cappingSettings: metric.cappingSettings,
      denominator: (!isFactMetric(metric) && metric.denominator) || undefined,
      sql: (!isFactMetric(metric) && metric.sql) || undefined,
      userIdTypes: (!isFactMetric(metric) && metric.userIdTypes) || undefined,
    },
    computedSettings: {
      windowSettings: {
        delayValue:
          metric.windowSettings.delayValue ?? DEFAULT_METRIC_WINDOW_DELAY_HOURS,
        delayUnit: metric.windowSettings.delayUnit ?? "hours",
        type: metric.windowSettings.type ?? DEFAULT_METRIC_WINDOW,
        windowUnit: metric.windowSettings.windowUnit ?? "hours",
        windowValue:
          metric.windowSettings.windowValue ?? DEFAULT_METRIC_WINDOW_HOURS,
      },
      properPrior: false,
      properPriorMean: 0,
      properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
      regressionAdjustmentDays: DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled: false,
      regressionAdjustmentAvailable:
        metricSnapshotSettings?.computedSettings
          ?.regressionAdjustmentAvailable ?? true,
      regressionAdjustmentReason: "",
    },
  };
}

export function getAnalysisSettingsFromSafeRolloutArgs(
  args: SafeRolloutSnapshotAnalysisSettings
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: args.dimensions,
    statsEngine: "frequentist",
    regressionAdjusted: false,
    pValueCorrection: null,
    sequentialTesting: true,
    sequentialTestingTuningParameter: args.sequentialTestingTuningParameter,
    pValueThreshold: args.pValueThreshold,
    differenceType: "absolute",
    baselineVariationIndex: 0,
    numGoalMetrics: 0,
  };
}

export function getSnapshotSettingsFromSafeRolloutArgs(
  args: SafeRolloutSnapshotInterface,
  metricMap: Map<string, ExperimentMetricInterface>
): {
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
} {
  const { settings } = args;
  const { metricSettings } = settings;

  const defaultMetricPriorSettings = settings.defaultMetricPriorSettings || {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };
  const snapshotSettings: ExperimentSnapshotSettings = {
    metricSettings: getAllMetricIdsFromExperiment(settings)
      .map((m) => getMetricForSnapshot(m, metricMap, metricSettings))
      .filter(isDefined),
    activationMetric: null,
    attributionModel: "firstExposure",
    datasourceId: settings.datasourceId,
    startDate: settings.startDate,
    endDate: settings.endDate || new Date(),
    experimentId: settings.experimentId,
    exposureQueryId: settings.exposureQueryId,
    manual: false,
    segment: "",
    queryFilter: settings.queryFilter || "",
    skipPartialData: false,
    defaultMetricPriorSettings: defaultMetricPriorSettings,
    regressionAdjustmentEnabled: !!settings.regressionAdjustmentEnabled,
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: settings.guardrailMetrics,
    dimensions: settings.dimensions ?? [],
    variations: settings.variations.map((v) => ({
      id: v.id,
      weight: v.weight,
    })),
    coverage: settings.coverage,
  };
  const analysisSettings = getAnalysisSettingsFromSafeRolloutArgs(
    args.analyses[0].settings
  );

  return { snapshotSettings, analysisSettings };
}
