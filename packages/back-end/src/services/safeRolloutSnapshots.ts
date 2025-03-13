import {
  DEFAULT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
} from "shared/constants";
import { isAnalysisAllowed, isDefined } from "shared/util";
import {
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  isBinomialMetric,
  isFactMetric,
} from "shared/experiments";
import {
  MetricForSnapshot,
  SafeRolloutSnapshotAnalysis,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotInterface,
} from "back-end/src/validators/safe-rollout";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
  SnapshotTriggeredBy,
  SnapshotType,
} from "back-end/types/experiment-snapshot";
import { CreateProps } from "../models/BaseModel";
import { getDataSourceById } from "../models/DataSourceModel";
import { SafeRolloutResultsQueryRunner } from "../queryRunners/SafeRolloutResultsQueryRunner";
import { FactTableMap } from "../models/FactTableModel";
import { MetricSnapshotSettings } from "back-end/types/report";
import { getSnapshotSettings } from "./experiments";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/organization";
import { FeatureInterface, SafeRolloutRule } from "../validators/features";
import { getSourceIntegrationObject } from "./datasource";

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
      regressionAdjustmentDays:
        metricSnapshotSettings?.computedSettings?.regressionAdjustmentDays ??
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled:
        metricSnapshotSettings?.computedSettings?.regressionAdjustmentEnabled ??
        false,
      regressionAdjustmentAvailable:
        metricSnapshotSettings?.computedSettings
          ?.regressionAdjustmentAvailable ?? true,
      regressionAdjustmentReason:
        metricSnapshotSettings?.computedSettings?.regressionAdjustmentReason ??
        "",
    },
  };
}

export function getAnalysisSettingsFromSafeRolloutArgs(
  args: SafeRolloutSnapshotAnalysisSettings
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: args.dimensions,
    statsEngine: "frequentist",
    regressionAdjusted: args.regressionAdjusted,
    pValueCorrection: args.pValueCorrection,
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

export async function createSnapshot({
  feature,
  safeRollout,
  context,
  triggeredBy,
  phaseIndex,
  useCache = false,
  defaultAnalysisSettings,
  additionalAnalysisSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
  reweight,
}: {
  feature: FeatureInterface;
  safeRollout: SafeRolloutRule;
  context: ReqContext | ApiReqContext;
  triggeredBy: SnapshotTriggeredBy;
  phaseIndex: number;
  useCache?: boolean;
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings;
  additionalAnalysisSettings: ExperimentSnapshotAnalysisSettings[];
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  reweight?: boolean;
}): Promise<SafeRolloutResultsQueryRunner> {
  const { org: organization } = context;
  const dimension = defaultAnalysisSettings.dimensions[0] || null;
  const metricGroups = await context.models.metricGroups.getAll();

  const datasource = await getDataSourceById(context, safeRollout.datasource);
  if (!datasource) {
    throw new Error("Could not load data source");
  }

  const snapshotSettings = getSnapshotSettings({
    safeRollout,
    phaseIndex,
    orgPriorSettings: organization.settings?.metricDefaults?.priorSettings,
    settings: defaultAnalysisSettings,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    metricGroups,
    reweight,
    datasource,
  });

  const data: CreateProps<SafeRolloutSnapshotInterface> = {
    featureId: feature.id,
    safeRolloutRuleId: safeRollout.id,
    runStarted: new Date(),
    error: "",
    queries: [],
    dimension: dimension || null,
    settings: snapshotSettings,
    triggeredBy,
    multipleExposures: 0,
    analyses: [
      {
        dateCreated: new Date(),
        results: [],
        settings: defaultAnalysisSettings,
        status: "running",
      },
      ...additionalAnalysisSettings
        .filter((a) => isAnalysisAllowed(snapshotSettings, a))
        .map((a) => {
          const analysis: SafeRolloutSnapshotAnalysis = {
            dateCreated: new Date(),
            results: [],
            settings: a,
            status: "running",
          };
          return analysis;
        }),
    ],
    status: "running",
  };

  // let scheduleNextSnapshot = true;
  // if (experiment.type === "multi-armed-bandit" && type !== "standard") {
  //   // explore tab actions should never trigger the next schedule for bandits
  //   scheduleNextSnapshot = false;
  // }

  // if (scheduleNextSnapshot) {
  //   const nextUpdate =
  //     experiment.type !== "multi-armed-bandit"
  //       ? determineNextDate(organization.settings?.updateSchedule || null)
  //       : determineNextBanditSchedule(experiment);

  //   await updateExperiment({
  //     context,
  //     experiment,
  //     changes: {
  //       lastSnapshotAttempt: new Date(),
  //       ...(nextUpdate ? { nextSnapshotAttempt: nextUpdate } : {}),
  //       autoSnapshots: nextUpdate !== null,
  //     },
  //   });
  // }

  const snapshot = await context.models.safeRolloutSnapshots.create(data);

  const integration = getSourceIntegrationObject(context, datasource, true);

  const queryRunner = new SafeRolloutResultsQueryRunner(
    context,
    snapshot,
    integration,
    useCache
  );

  await queryRunner.startAnalysis({
    metricMap,
    factTableMap,
  });

  return queryRunner;
}
