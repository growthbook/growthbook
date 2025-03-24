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
import { orgHasPremiumFeature } from "shared/enterprise";
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
import {
  OrganizationInterface,
  OrganizationSettings,
  ReqContext,
} from "back-end/types/organization";
import { MetricSnapshotSettings } from "back-end/types/report";
import { MetricInterface } from "back-end/types/metric";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { SafeRolloutRule } from "back-end/src/validators/features";
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
import { determineNextDate, isJoinableMetric } from "./experiments";
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
  safeRollout: SafeRolloutRule
): Promise<{
  regressionAdjustmentEnabled: boolean;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
}> {
  let regressionAdjustmentEnabled = false;
  const settingsForSnapshotMetrics: MetricSnapshotSettings[] = [];

  const metricMap = await getMetricMap(context);

  const allExperimentMetricIds = getAllMetricIdsFromExperiment(
    safeRollout,
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
  experiment,
  settings,
  orgPriorSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
  metricGroups,
  datasource,
}: {
  experiment: SafeRolloutRule;
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
    (q) => q.id === experiment.exposureQueryId
  );

  // expand metric groups and scrub unjoinable metrics
  const guardrailMetrics = expandMetricGroups(
    experiment.guardrailMetrics,
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
    getAllMetricIdsFromExperiment(experiment),
    metricGroups
  )
    .map((m) => getMetricForSnapshot(m, metricMap, settingsForSnapshotMetrics))
    .filter(isDefined);

  return {
    manual: !experiment.datasource,
    queryFilter: "",
    datasourceId: experiment.datasource || "",
    dimensions: settings.dimensions.map((id) => ({ id })),
    startDate: experiment.startedAt,
    endDate: new Date(),
    experimentId: experiment.trackingKey || experiment.id,
    guardrailMetrics,
    regressionAdjustmentEnabled: !!settings.regressionAdjusted,
    defaultMetricPriorSettings: defaultPriorSettings,
    exposureQueryId: experiment.exposureQueryId,
    metricSettings,
    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],
    coverage: experiment.coverage,
  };
}

export async function createSnapshot({
  experiment,
  context,
  triggeredBy,
  useCache = false,
  defaultAnalysisSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
}: {
  experiment: SafeRolloutRule;
  context: ReqContext | ApiReqContext;
  triggeredBy: SnapshotTriggeredBy;
  useCache?: boolean;
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
}): Promise<SafeRolloutResultsQueryRunner> {
  const { org: organization } = context;
  const dimension = defaultAnalysisSettings.dimensions[0] || null;
  const metricGroups = await context.models.metricGroups.getAll();

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    throw new Error("Could not load data source");
  }

  const snapshotSettings = getSnapshotSettings({
    experiment,
    orgPriorSettings: organization.settings?.metricDefaults?.priorSettings,
    settings: defaultAnalysisSettings,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    metricGroups,
    datasource,
  });

  const data: CreateProps<SafeRolloutSnapshotInterface> = {
    featureId: experiment.id, // TODO: replace with actual feature id
    safeRolloutRuleId: experiment.id,
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

  // TODO: Update safe rollout rule once we have a helper function to do so
  // await updateExperiment({
  //   context,
  //   experiment,
  //   changes: {
  //     lastSnapshotAttempt: new Date(),
  //     ...(nextUpdate ? { nextSnapshotAttempt: nextUpdate } : {}),
  //     autoSnapshots: nextUpdate !== null,
  //   },
  // });

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
  safeRollout,
  dimension,
  useCache = true,
  triggeredBy,
}: {
  context: ReqContext;
  safeRollout: SafeRolloutRule;
  dimension: string | undefined;
  useCache?: boolean;
  triggeredBy?: SnapshotTriggeredBy;
}): Promise<{
  snapshot: SafeRolloutSnapshotInterface;
  queryRunner: SafeRolloutResultsQueryRunner;
}> {
  // let project = null;
  // if (projectId) {
  //   project = await context.models.projects.getById(projectId);
  // }

  const { org } = context;
  const orgSettings: OrganizationSettings = org.settings as OrganizationSettings;

  const metricMap = await getMetricMap(context);
  // const metricIds = getAllMetricIdsFromExperiment(safeRollout, false);

  // const allExperimentMetrics = metricIds.map((m) => metricMap.get(m) || null);
  // const denominatorMetricIds = uniq<string>(
  //   allExperimentMetrics
  //     .map((m) => m?.denominator)
  //     .filter((d) => d && typeof d === "string") as string[]
  // );
  // const denominatorMetrics = denominatorMetricIds
  //   .map((m) => metricMap.get(m) || null)
  //   .filter(isDefined) as MetricInterface[];
  const {
    settingsForSnapshotMetrics,
    regressionAdjustmentEnabled,
  } = await getSettingsForSnapshotMetrics(context, safeRollout);

  const analysisSettings = getDefaultExperimentAnalysisSettingsForSafeRollout(
    org,
    regressionAdjustmentEnabled,
    dimension
  );

  const factTableMap = await getFactTableMap(context);

  const queryRunner = await createSnapshot({
    experiment: safeRollout,
    context,
    useCache,
    defaultAnalysisSettings: analysisSettings,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    triggeredBy: triggeredBy ?? "manual",
  });
  const snapshot = queryRunner.model;

  return { snapshot, queryRunner };
}
