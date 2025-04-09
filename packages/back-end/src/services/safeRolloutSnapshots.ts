import {
  DEFAULT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
} from "shared/constants";
import { isDefined } from "shared/util";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  getMetricSnapshotSettings,
  isBinomialMetric,
  isFactMetric,
} from "shared/experiments";
import { getSafeRolloutSRMValue } from "shared/health";
import {
  fullSafeRolloutInterface,
  safeRolloutInterface,
  SafeRolloutModel,
} from "back-end/src/models/SafeRolloutModel";
import {
  MetricForSnapshot,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotInterface,
  SafeRolloutSnapshotSettings,
} from "back-end/src/validators/safe-rollout";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
  SnapshotTriggeredBy,
} from "back-end/types/experiment-snapshot";
import { ApiReqContext } from "back-end/types/api";
import { OrganizationInterface, ReqContext } from "back-end/types/organization";
import { MetricSnapshotSettings } from "back-end/types/report";
import { MetricInterface } from "back-end/types/metric";
import { getMetricMap } from "back-end/src/models/MetricModel";
import {
  FeatureInterface,
  SafeRolloutRule,
} from "back-end/src/validators/features";
import { DataSourceInterface } from "back-end/types/datasource";
import { MetricPriorSettings } from "back-end/types/fact-table";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { SafeRolloutResultsQueryRunner } from "back-end/src/queryRunners/SafeRolloutResultsQueryRunner";
import {
  FactTableMap,
  getFactTableMap,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { CreateProps } from "back-end/src/models/BaseModel";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ExperimentAnalysisSummary } from "back-end/src/validators/experiments";
import {
  determineNextDate,
  isJoinableMetric,
  isJoinableMetric,
} from "./experiments";
import { getSourceIntegrationObject } from "./datasource";

export function getMetricForSnapshot(
  id: string | null | undefined,
  metricMap: Map<string, ExperimentMetricInterface>,
  settingsForSnapshotMetrics: MetricSnapshotSettings[]
): MetricForSnapshot | null {
  if (!id) return null;
  const metric = metricMap.get(id);
  if (!metric) return null;
  const metricSnapshotSettings = settingsForSnapshotMetrics?.find(
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
        metricSnapshotSettings?.regressionAdjustmentDays ??
        DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      regressionAdjustmentEnabled:
        metricSnapshotSettings?.regressionAdjustmentEnabled ?? false,
      regressionAdjustmentAvailable:
        metricSnapshotSettings?.regressionAdjustmentAvailable ?? true,
      regressionAdjustmentReason:
        metricSnapshotSettings?.regressionAdjustmentReason ?? "",
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
    oneSidedIntervals: true,
  };
}

export function getSnapshotSettingsFromSafeRolloutArgs(
  args: SafeRolloutSnapshotInterface
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
    metricSettings,
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

export async function getSettingsForSnapshotMetrics(
  context: ReqContext | ApiReqContext,
  fullSafeRollout: fullSafeRolloutInterface
): Promise<{
  regressionAdjustmentEnabled: boolean;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
}> {
  let regressionAdjustmentEnabled = false;
  const settingsForSnapshotMetrics: MetricSnapshotSettings[] = [];

  const metricMap = await getMetricMap(context);

  const allExperimentMetricIds = getAllMetricIdsFromExperiment(
    fullSafeRollout,
    false
  );
  const allExperimentMetrics = allExperimentMetricIds
    .map((id) => metricMap.get(id))
    .filter(isDefined);

  const denominatorMetrics = allExperimentMetrics
    .filter((m) => m && !isFactMetric(m) && m.denominator)
    .map((m: ExperimentMetricInterface) =>
      metricMap.get(m.denominator as string)
    )
    .filter(Boolean) as MetricInterface[];

  for (const metric of allExperimentMetrics) {
    if (!metric) continue;
    const { metricSnapshotSettings } = getMetricSnapshotSettings({
      metric: metric,
      denominatorMetrics: denominatorMetrics,
      experimentRegressionAdjustmentEnabled:
        context.org.settings?.regressionAdjustmentEnabled ??
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      organizationSettings: context.org.settings,
    });
    if (metricSnapshotSettings.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = true;
    }
    settingsForSnapshotMetrics.push(metricSnapshotSettings);
  }

  return { regressionAdjustmentEnabled, settingsForSnapshotMetrics };
}

export function getDefaultExperimentAnalysisSettingsForSafeRollout(
  organization: OrganizationInterface,
  regressionAdjustmentEnabled?: boolean,
  dimension?: string
): ExperimentSnapshotAnalysisSettings {
  const hasRegressionAdjustmentFeature = organization
    ? orgHasPremiumFeature(organization, "regression-adjustment")
    : false;
  const hasSequentialTestingFeature = organization
    ? orgHasPremiumFeature(organization, "sequential-testing")
    : false;
  return {
    statsEngine: "frequentist",
    dimensions: dimension ? [dimension] : [],
    regressionAdjusted:
      hasRegressionAdjustmentFeature &&
      (regressionAdjustmentEnabled !== undefined
        ? regressionAdjustmentEnabled
        : organization.settings?.regressionAdjustmentEnabled ?? false),
    sequentialTesting:
      hasSequentialTestingFeature &&
      !!organization.settings?.sequentialTestingEnabled,
    sequentialTestingTuningParameter:
      organization.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    baselineVariationIndex: 0,
    differenceType: "absolute",
    pValueThreshold:
      organization.settings?.pValueThreshold ?? DEFAULT_P_VALUE_THRESHOLD,
    numGoalMetrics: 0,
  };
}

function getSnapshotSettings({
  fullSafeRollout,
  settings,
  orgPriorSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
  metricGroups,
  datasource,
}: {
  fullSafeRollout: fullSafeRolloutInterface;
  settings: ExperimentSnapshotAnalysisSettings;
  orgPriorSettings: MetricPriorSettings | undefined;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  metricGroups: MetricGroupInterface[];
  datasource?: DataSourceInterface;
}): SafeRolloutSnapshotSettings {
  const defaultPriorSettings = orgPriorSettings ?? {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };

  const queries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = queries.find(
    (q) => q.id === fullSafeRollout.exposureQueryId
  );

  // expand metric groups and scrub unjoinable metrics
  const guardrailMetrics = expandMetricGroups(
    fullSafeRollout.guardrailMetrics,
    metricGroups
  ).filter((m) =>
    isJoinableMetric({
      metricId: m,
      metricMap,
      factTableMap,
      exposureQuery,
      datasource,
    })
  );

  const metricSettings = expandMetricGroups(
    getAllMetricIdsFromExperiment(fullSafeRollout),
    metricGroups
  )
    .map((m) => getMetricForSnapshot(m, metricMap, settingsForSnapshotMetrics))
    .filter(isDefined);

  return {
    manual: !fullSafeRollout.datasource,
    queryFilter: "",
    datasourceId: fullSafeRollout.datasource || "",
    dimensions: settings.dimensions.map((id) => ({ id })),
    startDate: fullSafeRollout.startedAt || new Date(), // might want to fix this
    endDate: new Date(),
    experimentId: fullSafeRollout.trackingKey || fullSafeRollout.id,
    guardrailMetrics,
    regressionAdjustmentEnabled: !!settings.regressionAdjusted,
    defaultMetricPriorSettings: defaultPriorSettings,
    exposureQueryId: fullSafeRollout.exposureQueryId,
    metricSettings,
    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],
    coverage: fullSafeRollout.coverage,
  };
}

export async function createSnapshot({
  fullSafeRollout,
  feature,
  context,
  triggeredBy,
  useCache = false,
  defaultAnalysisSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
  safeRollout,
}: {
  fullSafeRollout: fullSafeRolloutInterface;
  feature: FeatureInterface;
  context: ReqContext | ApiReqContext;
  triggeredBy: SnapshotTriggeredBy;
  useCache?: boolean;
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  safeRollout: safeRolloutInterface;
}): Promise<SafeRolloutResultsQueryRunner> {
  const { org: organization } = context;
  const dimension = defaultAnalysisSettings.dimensions[0] || null;
  const metricGroups = await context.models.metricGroups.getAll();

  const datasource = await getDataSourceById(context, safeRollout.datasource);
  if (!datasource) {
    throw new Error("Could not load data source");
  }

  const snapshotSettings = getSnapshotSettings({
    fullSafeRollout,
    orgPriorSettings: organization.settings?.metricDefaults?.priorSettings,
    settings: defaultAnalysisSettings,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    metricGroups,
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
    ],
    status: "running",
  };

  const nextUpdate = determineNextDate(
    organization.settings?.updateSchedule || null
  );
  const safeRolloutModel = new SafeRolloutModel(context);
  await safeRolloutModel.update(safeRollout, {
    nextSnapshotAttempt:
      nextUpdate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

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

export async function createSafeRolloutSnapshot({
  context,
  safeRolloutRule,
  feature,
  dimension,
  useCache = true,
  triggeredBy,
  safeRollout,
}: {
  context: ReqContext;
  safeRolloutRule: SafeRolloutRule;
  safeRollout: safeRolloutInterface;
  feature: FeatureInterface;
  dimension: string | undefined;
  useCache?: boolean;
  triggeredBy?: SnapshotTriggeredBy;
}): Promise<{
  snapshot: SafeRolloutSnapshotInterface;
  queryRunner: SafeRolloutResultsQueryRunner;
}> {
  const fullSafeRollout: fullSafeRolloutInterface = {
    ...safeRollout,
    ...safeRolloutRule,
  };
  const { org } = context;

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  const {
    settingsForSnapshotMetrics,
    regressionAdjustmentEnabled,
  } = await getSettingsForSnapshotMetrics(context, fullSafeRollout);

  const analysisSettings = getDefaultExperimentAnalysisSettingsForSafeRollout(
    org,
    regressionAdjustmentEnabled,
    dimension
  );

  const queryRunner = await createSnapshot({
    fullSafeRollout,
    feature,
    context,
    useCache,
    defaultAnalysisSettings: analysisSettings,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    triggeredBy: triggeredBy ?? "manual",
    safeRollout,
  });
  const snapshot = queryRunner.model;

  return { snapshot, queryRunner };
}

export async function getSafeRolloutAnalysisSummary({
  context,
  safeRollout,
  experimentSnapshot,
}: {
  context: ReqContext;
  safeRollout: SafeRolloutRule;
  experimentSnapshot: SafeRolloutSnapshotInterface;
}): Promise<ExperimentAnalysisSummary> {
  const analysisSummary: ExperimentAnalysisSummary = {
    snapshotId: experimentSnapshot.id,
  };

  const overallTraffic = experimentSnapshot.health?.traffic?.overall;

  const standardSnapshot =
    experimentSnapshot.analyses?.[0]?.results?.length === 1;
  const totalUsers =
    (overallTraffic?.variationUnits.length
      ? overallTraffic.variationUnits.reduce((acc, a) => acc + a, 0)
      : standardSnapshot
      ? // fall back to first result for standard snapshots if overall traffic
        // is missing
        experimentSnapshot?.analyses?.[0]?.results?.[0]?.variations?.reduce(
          (acc, a) => acc + a.users,
          0
        )
      : null) ?? null;

  const srm = getSafeRolloutSRMValue(experimentSnapshot);

  if (srm !== undefined) {
    analysisSummary.health = {
      srm,
      multipleExposures: experimentSnapshot.multipleExposures,
      totalUsers,
    };
  }

  // TODO: Compute resultsStatus and add to analysisSummary to be able to getDecisionFrameworkStatus within the
  // DecisionBanner component

  // The function I based this off of, getExperimentAnalysisSummary, uses a function, computeResultStatus, to get the resultsStatus
  // that only seems to work with relative analyses but we use absolute analyses for Safe Rollouts
  // We need a version of that function that works with absolute analyses

  return analysisSummary;
}
