import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { MetricInterface } from "../../types/metric";
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
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";

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
    sequentialTestingEnabled: analysisSettings.sequentialTesting,
    sequentialTestingTuningParameter:
      analysisSettings.sequentialTestingTuningParameter,
  };
}

export function getSnapshotSettingsFromReportArgs(
  args: ExperimentReportArgs,
  metricMap: Map<string, MetricInterface>
): {
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
} {
  const snapshotSettings: ExperimentSnapshotSettings = {
    metricSettings: args.metrics
      .concat(args.guardrails || [])
      .concat(args.activationMetric ? [args.activationMetric] : [])
      .map((m) =>
        getMetricForSnapshot(
          m,
          metricMap,
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
    regressionAdjustmentEnabled: !!args.regressionAdjustmentEnabled,
    goalMetrics: args.metrics,
    guardrailMetrics: args.guardrails || [],
    dimensions: args.dimension ? [{ id: args.dimension }] : [],
    variations: args.variations.map((v) => ({
      id: v.id,
      weight: v.weight,
    })),
  };
  // TODO: add baselineVariation here
  const analysisSettings: ExperimentSnapshotAnalysisSettings = {
    dimensions: args.dimension ? [args.dimension] : [],
    statsEngine: args.statsEngine || DEFAULT_STATS_ENGINE,
    regressionAdjusted: args.regressionAdjustmentEnabled,
    pValueCorrection: null,
    sequentialTesting: args.sequentialTestingEnabled,
    sequentialTestingTuningParameter: args.sequentialTestingTuningParameter,
  };

  return { snapshotSettings, analysisSettings };
}

export function getMetricForSnapshot(
  id: string | null | undefined,
  metricMap: Map<string, MetricInterface>,
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
      type: metric.type,
      aggregation: metric.aggregation || undefined,
      capping: metric.capping || null,
      capValue: metric.capValue || undefined,
      denominator: metric.denominator || undefined,
      sql: metric.sql || undefined,
      userIdTypes: metric.userIdTypes || undefined,
    },
    computedSettings: {
      conversionDelayHours:
        overrides?.conversionDelayHours ?? metric.conversionDelayHours ?? 0,
      conversionWindowHours:
        overrides?.conversionWindowHours ??
        metric.conversionWindowHours ??
        DEFAULT_CONVERSION_WINDOW_HOURS,
      regressionAdjustmentDays:
        regressionAdjustmentStatus?.regressionAdjustmentDays ??
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled:
        regressionAdjustmentStatus?.regressionAdjustmentEnabled ?? false,
      regressionAdjustmentReason: regressionAdjustmentStatus?.reason ?? "",
    },
  };
}
