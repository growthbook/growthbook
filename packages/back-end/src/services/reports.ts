import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import {
  isFactMetric,
  isBinomialMetric,
  ExperimentMetricInterface,
} from "shared/experiments";
import { MetricPriorSettings } from "@back-end/types/fact-table";
import {
  ExperimentReportArgs,
  ExperimentReportVariation,
  MetricRegressionAdjustmentStatus,
} from "../../types/report";
import {
  ExperimentInterface,
  ExperimentPhase,
  MetricOverride,
} from "../../types/experiment";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
} from "../../types/experiment-snapshot";

export function getReportVariations(
  experiment: ExperimentInterface,
  phase: ExperimentPhase
): ExperimentReportVariation[] {
  return experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phase?.variationWeights?.[i] || 0,
    };
  });
}

function getMetricRegressionAdjustmentStatusesFromSnapshot(
  snapshotSettings: ExperimentSnapshotSettings,
  analysisSettings: ExperimentSnapshotAnalysisSettings
): MetricRegressionAdjustmentStatus[] {
  return snapshotSettings.metricSettings.map((m) => {
    return {
      metric: m.id,
      reason: m.computedSettings?.regressionAdjustmentReason || "",
      regressionAdjustmentDays:
        m.computedSettings?.regressionAdjustmentDays ||
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled:
        (analysisSettings.regressionAdjusted &&
          m.computedSettings?.regressionAdjustmentEnabled) ||
        false,
      regressionAdjustmentAvailable:
        m.computedSettings?.regressionAdjustmentAvailable ?? true,
    };
  });
}

export function reportArgsFromSnapshot(
  experiment: ExperimentInterface,
  snapshot: ExperimentSnapshotInterface,
  analysisSettings: ExperimentSnapshotAnalysisSettings
): ExperimentReportArgs {
  const phase = experiment.phases[snapshot.phase];
  if (!phase) {
    throw new Error("Unknown experiment phase");
  }
  return {
    trackingKey: snapshot.settings.experimentId || experiment.trackingKey,
    datasource: snapshot.settings.datasourceId || experiment.datasource,
    exposureQueryId: experiment.exposureQueryId,
    startDate: snapshot.settings.startDate,
    endDate: snapshot.settings.endDate,
    dimension: snapshot.dimension || undefined,
    variations: getReportVariations(experiment, phase),
    coverage: snapshot.settings.coverage,
    segment: snapshot.settings.segment,
    metrics: experiment.metrics,
    metricOverrides: experiment.metricOverrides,
    guardrails: experiment.guardrails,
    activationMetric: snapshot.settings.activationMetric || undefined,
    queryFilter: snapshot.settings.queryFilter,
    skipPartialData: snapshot.settings.skipPartialData,
    attributionModel: snapshot.settings.attributionModel,
    statsEngine: analysisSettings.statsEngine,
    regressionAdjustmentEnabled: analysisSettings.regressionAdjusted,
    metricRegressionAdjustmentStatuses: getMetricRegressionAdjustmentStatusesFromSnapshot(
      snapshot.settings,
      analysisSettings
    ),
    defaultMetricPriorSettings: snapshot.settings.defaultMetricPriorSettings,
    sequentialTestingEnabled: analysisSettings.sequentialTesting,
    sequentialTestingTuningParameter:
      analysisSettings.sequentialTestingTuningParameter,
    pValueThreshold: analysisSettings.pValueThreshold,
  };
}

export function getAnalysisSettingsFromReportArgs(
  args: ExperimentReportArgs
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: args.dimension ? [args.dimension] : [],
    statsEngine: args.statsEngine || DEFAULT_STATS_ENGINE,
    regressionAdjusted: args.regressionAdjustmentEnabled,
    pValueCorrection: null,
    sequentialTesting: args.sequentialTestingEnabled,
    sequentialTestingTuningParameter: args.sequentialTestingTuningParameter,
    pValueThreshold: args.pValueThreshold,
    differenceType: args.differenceType ?? "relative",
    baselineVariationIndex: 0,
  };
}
export function getSnapshotSettingsFromReportArgs(
  args: ExperimentReportArgs,
  metricMap: Map<string, ExperimentMetricInterface>
): {
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
} {
  const defaultMetricPriorSettings = args.defaultMetricPriorSettings || {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };
  const snapshotSettings: ExperimentSnapshotSettings = {
    metricSettings: args.metrics
      .concat(args.guardrails || [])
      .concat(args.activationMetric ? [args.activationMetric] : [])
      .map((m) =>
        getMetricForSnapshot(
          m,
          metricMap,
          defaultMetricPriorSettings,
          args.metricRegressionAdjustmentStatuses,
          args.metricOverrides
        )
      )
      .filter(Boolean) as MetricForSnapshot[],
    activationMetric: args.activationMetric || null,
    attributionModel: args.attributionModel || "firstExposure",
    datasourceId: args.datasource,
    startDate: args.startDate,
    endDate: args.endDate || new Date(),
    experimentId: args.trackingKey,
    exposureQueryId: args.exposureQueryId,
    manual: false,
    segment: args.segment || "",
    queryFilter: args.queryFilter || "",
    skipPartialData: !!args.skipPartialData,
    defaultMetricPriorSettings: defaultMetricPriorSettings,
    regressionAdjustmentEnabled: !!args.regressionAdjustmentEnabled,
    goalMetrics: args.metrics,
    guardrailMetrics: args.guardrails || [],
    dimensions: args.dimension ? [{ id: args.dimension }] : [],
    variations: args.variations.map((v) => ({
      id: v.id,
      weight: v.weight,
    })),
    coverage: args.coverage,
  };
  const analysisSettings = getAnalysisSettingsFromReportArgs(args);

  return { snapshotSettings, analysisSettings };
}

export function getMetricForSnapshot(
  id: string | null | undefined,
  metricMap: Map<string, ExperimentMetricInterface>,
  orgPriorSettings: MetricPriorSettings,
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[],
  metricOverrides?: MetricOverride[]
): MetricForSnapshot | null {
  if (!id) return null;
  const metric = metricMap.get(id);
  if (!metric) return null;
  const overrides = metricOverrides?.find((o) => o.id === id);
  const regressionAdjustmentStatus = metricRegressionAdjustmentStatuses?.find(
    (s) => s.metric === id
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
        delayHours:
          overrides?.delayHours ??
          metric.windowSettings.delayHours ??
          DEFAULT_METRIC_WINDOW_DELAY_HOURS,
        type:
          overrides?.windowType ??
          metric.windowSettings.type ??
          DEFAULT_METRIC_WINDOW,
        windowUnit:
          overrides?.windowHours || overrides?.windowType
            ? "hours"
            : metric.windowSettings.windowUnit ?? "hours",
        windowValue:
          overrides?.windowHours ??
          metric.windowSettings.windowValue ??
          DEFAULT_METRIC_WINDOW_HOURS,
      },
      // TODO allow for metric prior overrides by experiment
      ...(metric.priorSettings.override
        ? {
            properPrior: metric.priorSettings.proper,
            properPriorMean: metric.priorSettings.mean,
            properPriorStdDev: metric.priorSettings.stddev,
          }
        : {
            properPrior: orgPriorSettings.proper,
            properPriorMean: orgPriorSettings.mean,
            properPriorStdDev: orgPriorSettings.stddev,
          }),
      regressionAdjustmentDays:
        regressionAdjustmentStatus?.regressionAdjustmentDays ??
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled:
        regressionAdjustmentStatus?.regressionAdjustmentEnabled ?? false,
      regressionAdjustmentAvailable:
        regressionAdjustmentStatus?.regressionAdjustmentAvailable ?? true,
      regressionAdjustmentReason: regressionAdjustmentStatus?.reason ?? "",
    },
  };
}
