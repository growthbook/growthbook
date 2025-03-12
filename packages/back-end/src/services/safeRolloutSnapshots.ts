import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { SafeRolloutSnapshotSettings } from "back-end/src/validators/safe-rollout";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";
import { isDefined } from "shared/util";

export function getSnapshotSettingsFromReportArgs(
  args: SafeRolloutSnapshotSettings,
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
    metricSettings: getAllMetricIdsFromExperiment(args)
      .map((m) =>
        getMetricForSnapshot(
          m,
          metricMap,
          args.settingsForSnapshotMetrics,
          args.metricOverrides
        )
      )
      .filter(isDefined),
    activationMetric: null,
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
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: args.guardrailMetrics,
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
