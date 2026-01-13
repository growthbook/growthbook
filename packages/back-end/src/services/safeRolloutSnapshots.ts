import {
  DEFAULT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_POST_STRATIFICATION_ENABLED,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
} from "shared/constants";
import { getSafeRolloutSnapshotAnalysis, isDefined } from "shared/util";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  getMetricSnapshotSettings,
  isBinomialMetric,
  isFactMetric,
  parseSliceMetricId,
} from "shared/experiments";
import { getSafeRolloutSRMValue } from "shared/health";
import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";
import { CreateProps } from "shared/types/base-model";
import {
  ExperimentAnalysisSummary,
  SafeRolloutNotification,
  MetricForSafeRolloutSnapshot,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotInterface,
  SafeRolloutSnapshotSettings,
  FeatureInterface,
  SafeRolloutRule,
} from "shared/validators";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import { OrganizationInterface } from "shared/types/organization";
import { MetricSnapshotSettings } from "shared/types/report";
import { MetricInterface } from "shared/types/metric";
import { DataSourceInterface } from "shared/types/datasource";
import { MetricPriorSettings } from "shared/types/fact-table";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { ResourceEvents } from "shared/types/events/base-types";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { SafeRolloutResultsQueryRunner } from "back-end/src/queryRunners/SafeRolloutResultsQueryRunner";
import {
  FactTableMap,
  getFactTableMap,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { getFeature } from "back-end/src/models/FeatureModel";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { getSafeRolloutRuleFromFeature } from "back-end/src/routers/safe-rollout/safe-rollout.helper";
import { determineNextSafeRolloutSnapshotAttempt } from "back-end/src/enterprise/saferollouts/safeRolloutUtils";
import { getSourceIntegrationObject } from "./datasource";
import { computeResultsStatus, isJoinableMetric } from "./experiments";

export function getMetricForSafeRolloutSnapshot(
  id: string | null | undefined,
  metricMap: Map<string, ExperimentMetricInterface>,
  settingsForSnapshotMetrics: MetricSnapshotSettings[],
): MetricForSafeRolloutSnapshot | null {
  if (!id) return null;
  const metric = metricMap.get(id);
  if (!metric) return null;
  // For slice metrics, use the base metric ID for lookups
  const { baseMetricId } = parseSliceMetricId(id);
  const metricSnapshotSettings = settingsForSnapshotMetrics?.find(
    (s) => s.metric === baseMetricId,
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
  args: SafeRolloutSnapshotAnalysisSettings,
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: [],
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
  args: SafeRolloutSnapshotInterface,
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
    dimensions: [],
    variations: settings.variations.map((v) => ({
      id: v.id,
      weight: v.weight,
    })),
    coverage: settings.coverage,
    customFields: settings.customFields,
    phase: settings.phase,
  };

  const analysisSettings = getAnalysisSettingsFromSafeRolloutArgs(
    args.analyses[0].settings,
  );
  return { snapshotSettings, analysisSettings };
}

export async function getSettingsForSnapshotMetrics(
  context: ReqContext | ApiReqContext,
  safeRollout: SafeRolloutInterface,
): Promise<{
  regressionAdjustmentEnabled: boolean;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
}> {
  let regressionAdjustmentEnabled = false;
  const settingsForSnapshotMetrics: MetricSnapshotSettings[] = [];

  const metricMap = await getMetricMap(context);

  const metricGroups = await context.models.metricGroups.getAll();
  const allExperimentMetricIds = getAllMetricIdsFromExperiment(
    { guardrailMetrics: safeRollout.guardrailMetricIds },
    false,
    metricGroups,
  );
  const allExperimentMetrics = allExperimentMetricIds
    .map((id) => metricMap.get(id))
    .filter(isDefined);

  const denominatorMetrics = allExperimentMetrics
    .filter((m) => m && !isFactMetric(m) && m.denominator)
    .map((m: ExperimentMetricInterface) =>
      metricMap.get(m.denominator as string),
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
): ExperimentSnapshotAnalysisSettings {
  const hasRegressionAdjustmentFeature = organization
    ? orgHasPremiumFeature(organization, "regression-adjustment")
    : false;
  const hasSequentialTestingFeature = organization
    ? orgHasPremiumFeature(organization, "sequential-testing")
    : false;
  const hasPostStratificationFeature = organization
    ? orgHasPremiumFeature(organization, "post-stratification")
    : false;
  return {
    statsEngine: "frequentist",
    dimensions: [],
    regressionAdjusted:
      hasRegressionAdjustmentFeature &&
      (regressionAdjustmentEnabled !== undefined
        ? regressionAdjustmentEnabled
        : (organization.settings?.regressionAdjustmentEnabled ?? false)),
    postStratificationEnabled:
      hasPostStratificationFeature &&
      !organization.settings?.disablePrecomputedDimensions &&
      (organization.settings?.postStratificationEnabled ??
        DEFAULT_POST_STRATIFICATION_ENABLED),
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

function getSafeRolloutSnapshotSettings({
  safeRollout,
  safeRolloutRule,
  settings,
  orgPriorSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
  metricGroups,
  datasource,
  customFields,
}: {
  safeRollout: SafeRolloutInterface;
  safeRolloutRule: SafeRolloutRule;
  settings: ExperimentSnapshotAnalysisSettings;
  orgPriorSettings: MetricPriorSettings | undefined;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  metricGroups: MetricGroupInterface[];
  datasource?: DataSourceInterface;
  customFields?: Record<string, unknown>;
}): SafeRolloutSnapshotSettings {
  const defaultPriorSettings = orgPriorSettings ?? {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };

  const queries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = queries.find(
    (q) => q.id === safeRollout.exposureQueryId,
  );

  // expand metric groups and scrub unjoinable metrics
  const guardrailMetrics = expandMetricGroups(
    safeRollout.guardrailMetricIds,
    metricGroups,
  ).filter((m) =>
    isJoinableMetric({
      metricId: m,
      metricMap,
      factTableMap,
      exposureQuery,
      datasource,
    }),
  );

  const metricSettings = expandMetricGroups(
    getAllMetricIdsFromExperiment(
      {
        guardrailMetrics: safeRollout.guardrailMetricIds,
      },
      true,
      metricGroups,
    ),
    metricGroups,
  )
    .map((m) =>
      getMetricForSafeRolloutSnapshot(m, metricMap, settingsForSnapshotMetrics),
    )
    .filter(isDefined);

  return {
    queryFilter: "",
    experimentId: safeRolloutRule.trackingKey,
    phase: {
      index: "0",
    },
    customFields,
    datasourceId: safeRollout.datasourceId || "",
    dimensions: settings.dimensions.map((id) => ({ id })),
    startDate: safeRollout.startedAt || new Date(), // TODO: What do we want to do if startedAt is not set?
    endDate: new Date(),
    guardrailMetrics,
    regressionAdjustmentEnabled: !!settings.regressionAdjusted,
    defaultMetricPriorSettings: defaultPriorSettings,
    exposureQueryId: safeRollout.exposureQueryId,
    metricSettings,
    variations: [
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ],
    coverage: 1, //hardcoded for now
  };
}

export async function _createSafeRolloutSnapshot({
  safeRollout,
  customFields,
  context,
  triggeredBy,
  useCache = false,
  defaultAnalysisSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
}: {
  safeRollout: SafeRolloutInterface;
  customFields?: Record<string, unknown>;
  context: ReqContext | ApiReqContext;
  triggeredBy: SafeRolloutSnapshotInterface["triggeredBy"];
  useCache?: boolean;
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
}): Promise<SafeRolloutResultsQueryRunner> {
  const { org: organization } = context;
  const metricGroups = await context.models.metricGroups.getAll();
  const feature = await getFeature(context, safeRollout.featureId);
  if (!feature) {
    throw new Error("Could not load safe rollout feature");
  }
  const safeRolloutRule = getSafeRolloutRuleFromFeature(
    feature,
    safeRollout.id,
  );
  if (!safeRolloutRule) {
    throw new Error("Could not find safe rollout rule");
  }

  const datasource = await getDataSourceById(context, safeRollout.datasourceId);
  if (!datasource) {
    throw new Error("Could not load data source");
  }

  const snapshotSettings = getSafeRolloutSnapshotSettings({
    safeRollout,
    safeRolloutRule,
    orgPriorSettings: organization.settings?.metricDefaults?.priorSettings,
    settings: defaultAnalysisSettings,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    metricGroups,
    datasource,
    customFields,
  });
  const data: CreateProps<SafeRolloutSnapshotInterface> = {
    safeRolloutId: safeRollout.id,
    runStarted: new Date(),
    error: "",
    queries: [],
    settings: snapshotSettings,
    multipleExposures: 0,
    triggeredBy,
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

  const { nextSnapshot } = determineNextSafeRolloutSnapshotAttempt(
    safeRollout,
    organization,
  );
  await context.models.safeRollout.update(safeRollout, {
    nextSnapshotAttempt: nextSnapshot,
  });

  const snapshot = await context.models.safeRolloutSnapshots.create(data);

  const integration = getSourceIntegrationObject(context, datasource, true);

  const queryRunner = new SafeRolloutResultsQueryRunner(
    context,
    snapshot,
    integration,
    useCache,
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
  customFields,
  useCache = true,
  triggeredBy,
}: {
  context: ReqContext;
  safeRollout: SafeRolloutInterface;
  customFields?: Record<string, unknown>;
  useCache?: boolean;
  triggeredBy?: SafeRolloutSnapshotInterface["triggeredBy"];
}): Promise<{
  snapshot: SafeRolloutSnapshotInterface;
  queryRunner: SafeRolloutResultsQueryRunner;
}> {
  const { org } = context;

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  const { settingsForSnapshotMetrics, regressionAdjustmentEnabled } =
    await getSettingsForSnapshotMetrics(context, safeRollout);

  const analysisSettings = getDefaultExperimentAnalysisSettingsForSafeRollout(
    org,
    regressionAdjustmentEnabled,
  );

  const queryRunner = await _createSafeRolloutSnapshot({
    context,
    useCache,
    defaultAnalysisSettings: analysisSettings,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    triggeredBy: triggeredBy ?? "manual",
    safeRollout,
    customFields,
  });
  const snapshot = queryRunner.model;

  return { snapshot, queryRunner };
}

export async function getSafeRolloutAnalysisSummary({
  context,
  safeRollout,
  safeRolloutSnapshot,
}: {
  context: ReqContext;
  safeRollout: SafeRolloutInterface;
  safeRolloutSnapshot: SafeRolloutSnapshotInterface;
}): Promise<ExperimentAnalysisSummary> {
  const analysisSummary: ExperimentAnalysisSummary = {
    snapshotId: safeRolloutSnapshot.id,
  };

  const overallTraffic = safeRolloutSnapshot.health?.traffic?.overall;

  const totalUsers =
    (overallTraffic?.variationUnits.length
      ? overallTraffic.variationUnits.reduce((acc, a) => acc + a, 0)
      : safeRolloutSnapshot?.analyses?.[0]?.results?.[0]?.variations?.reduce(
          (acc, a) => acc + a.users,
          0,
        )) ?? null;

  const srm = getSafeRolloutSRMValue(safeRolloutSnapshot);

  if (srm !== undefined) {
    analysisSummary.health = {
      srm,
      multipleExposures: safeRolloutSnapshot.multipleExposures,
      totalUsers,
    };
  }

  const analysis = getSafeRolloutSnapshotAnalysis(safeRolloutSnapshot);

  if (analysis) {
    analysisSummary.resultsStatus = await computeResultsStatus({
      context,
      analysis,
      experiment: safeRollout,
    });
  }

  return analysisSummary;
}

const dispatchSafeRolloutEvent = async <T extends ResourceEvents<"feature">>({
  context,
  feature,
  environment,
  event,
  data,
}: {
  context: ReqContext;
  feature: FeatureInterface;
  environment: string;
  event: T;
  data: CreateEventData<"feature", T>;
}) => {
  await createEvent({
    context,
    object: "feature",
    objectId: feature.id,
    event,
    data,
    projects: feature.project ? [feature.project] : [],
    tags: feature.tags || [],
    environments: [environment],
    containsSecrets: false,
  });
};

const memoizeSafeRolloutNotification = async ({
  context,
  types,
  safeRollout,
  dispatch,
}: {
  context: ReqContext;
  types: SafeRolloutNotification[];
  safeRollout: SafeRolloutInterface;
  dispatch: () => Promise<void>;
}): Promise<boolean> => {
  if (types.every((t) => safeRollout.pastNotifications?.includes(t)))
    return false;

  await dispatch();

  await context.models.safeRollout.update(safeRollout, {
    pastNotifications: types,
  });

  return true;
};

export async function notifySafeRolloutChange({
  context,
  updatedSafeRollout,
  safeRolloutSnapshot,
}: {
  context: ReqContext;
  updatedSafeRollout: SafeRolloutInterface;
  safeRolloutSnapshot: SafeRolloutSnapshotInterface;
}): Promise<boolean> {
  if (updatedSafeRollout.status !== "running") return false;

  let notificationSent = false;

  const daysLeft = getSafeRolloutDaysLeft({
    safeRollout: updatedSafeRollout,
    snapshotWithResults: safeRolloutSnapshot,
  });
  const healthSettings = getHealthSettings(
    context.org.settings,
    orgHasPremiumFeature(context.org, "decision-framework"),
  );
  const safeRolloutStatus = getSafeRolloutResultStatus({
    safeRollout: updatedSafeRollout,
    healthSettings,
    daysLeft,
  });
  const feature = await getFeature(context, updatedSafeRollout.featureId);
  if (!feature) {
    throw new Error("Could not find feature to fire event");
  }

  const notificationData = {
    featureId: feature.id,
    safeRolloutId: updatedSafeRollout.id,
    environment: updatedSafeRollout.environment,
  };

  // always notify of new status, regardless of old status
  // (no memoization or checking the old status)
  if (safeRolloutStatus?.status === "unhealthy") {
    const unhealthyReasons: ("srm" | "multipleExposures")[] = [];
    if (safeRolloutStatus.unhealthyData.srm) {
      unhealthyReasons.push("srm");
    }
    if (safeRolloutStatus.unhealthyData.multipleExposures) {
      unhealthyReasons.push("multipleExposures");
    }

    const unhealthyNotificationSent = await memoizeSafeRolloutNotification({
      context,
      types: unhealthyReasons,
      safeRollout: updatedSafeRollout,
      dispatch: () =>
        dispatchSafeRolloutEvent({
          context,
          feature,
          environment: notificationData.environment,
          event: "saferollout.unhealthy",
          data: {
            object: {
              ...notificationData,
              unhealthyReason: unhealthyReasons,
            },
          },
        }),
    });
    notificationSent = notificationSent || unhealthyNotificationSent;
  }

  if (safeRolloutStatus?.status === "rollback-now") {
    const rollbackNotificationSent = await memoizeSafeRolloutNotification({
      context,
      types: ["rollback"],
      safeRollout: updatedSafeRollout,
      dispatch: () =>
        dispatchSafeRolloutEvent({
          context,
          feature,
          environment: notificationData.environment,
          event: "saferollout.rollback",
          data: {
            object: notificationData,
          },
        }),
    });
    notificationSent = notificationSent || rollbackNotificationSent;
  }
  if (safeRolloutStatus?.status === "ship-now") {
    const shipNotificationSent = await memoizeSafeRolloutNotification({
      context,
      types: ["ship"],
      safeRollout: updatedSafeRollout,
      dispatch: () =>
        dispatchSafeRolloutEvent({
          context,
          feature,
          environment: notificationData.environment,
          event: "saferollout.ship",
          data: {
            object: notificationData,
          },
        }),
    });
    notificationSent = notificationSent || shipNotificationSent;
  }

  return notificationSent;
}
