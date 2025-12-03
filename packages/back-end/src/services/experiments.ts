import uniqid from "uniqid";
import cronParser from "cron-parser";
import { z } from "zod";
import { isEqual } from "lodash";
import cloneDeep from "lodash/cloneDeep";
import {
  DEFAULT_METRIC_CAPPING,
  DEFAULT_METRIC_CAPPING_VALUE,
  DEFAULT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { getScopedSettings, ScopedSettings } from "shared/settings";
import {
  DRAFT_REVISION_STATUSES,
  generateVariationId,
  getMatchingRules,
  getSnapshotAnalysis,
  isAnalysisAllowed,
  isDefined,
  MatchingRule,
  validateCondition,
} from "shared/util";
import { getSRMValue } from "shared/health";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  getAllExpandedMetricIdsFromExperiment,
  expandAllSliceMetricsInMap,
  getEqualWeights,
  getMetricResultStatus,
  getMetricSnapshotSettings,
  getPredefinedDimensionSlicesByExperiment,
  isFactMetric,
  isFactMetricId,
  isMetricJoinable,
  parseSliceMetricId,
  setAdjustedCIs,
  setAdjustedPValuesOnResults,
} from "shared/experiments";
import { hoursBetween } from "shared/dates";
import { v4 as uuidv4 } from "uuid";
import { differenceInHours } from "date-fns";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { MetricPriorSettings } from "back-end/types/fact-table";
import {
  ExperimentAnalysisSummaryVariationStatus,
  BanditResult,
  ExperimentAnalysisSummary,
  ExperimentAnalysisSummaryResultsStatus,
  GoalMetricResult,
  ExperimentInterfaceExcludingHoldouts,
} from "back-end/src/validators/experiments";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { promiseAllChunks } from "back-end/src/util/promise";
import { Context } from "back-end/src/models/BaseModel";
import {
  ExperimentAnalysisParamsContextData,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotTriggeredBy,
  SnapshotType,
  SnapshotVariation,
  SnapshotBanditSettings,
  DimensionForSnapshot,
} from "back-end/types/experiment-snapshot";
import {
  getMetricById,
  getMetricMap,
  getMetricsByIds,
  insertMetric,
} from "back-end/src/models/MetricModel";
import { checkSrm, sumSquaresFromStats } from "back-end/src/util/stats";
import { addTags } from "back-end/src/models/TagModel";
import {
  addOrUpdateSnapshotAnalysis,
  createExperimentSnapshotModel,
  getLatestSnapshotMultipleExperiments,
  updateSnapshotAnalysis,
} from "back-end/src/models/ExperimentSnapshotModel";
import { Dimension } from "back-end/src/types/Integration";
import {
  Condition,
  MetricInterface,
  MetricStats,
  Operator,
} from "back-end/types/metric";
import { SegmentInterface } from "back-end/types/segment";
import {
  Changeset,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  ExperimentPhase,
  LinkedFeatureEnvState,
  LinkedFeatureInfo,
  LinkedFeatureState,
} from "back-end/types/experiment";
import { findDimensionById } from "back-end/src/models/DimensionModel";
import {
  APP_ORIGIN,
  DEFAULT_CONVERSION_WINDOW_HOURS,
  EXPERIMENT_REFRESH_FREQUENCY,
} from "back-end/src/util/secrets";
import {
  ExperimentUpdateSchedule,
  OrganizationInterface,
  ReqContext,
} from "back-end/types/organization";
import { logger } from "back-end/src/util/logger";
import { DataSourceInterface, ExposureQuery } from "back-end/types/datasource";
import {
  ApiExperiment,
  ApiExperimentMetric,
  ApiExperimentResults,
  ApiMetric,
} from "back-end/types/openapi";
import {
  ExperimentReportAnalysisSettings,
  MetricSnapshotSettings,
} from "back-end/types/report";
import {
  postExperimentValidator,
  postMetricValidator,
  putMetricValidator,
  updateExperimentValidator,
} from "back-end/src/validators/openapi";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import { LegacyMetricAnalysisQueryRunner } from "back-end/src/queryRunners/LegacyMetricAnalysisQueryRunner";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { QueryMap, getQueryMap } from "back-end/src/queryRunners/QueryRunner";
import {
  FactTableMap,
  getFactTableMap,
} from "back-end/src/models/FactTableModel";
import { StatsEngine } from "back-end/types/stats";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { getFeatureRevisionsByFeatureIds } from "back-end/src/models/FeatureRevisionModel";
import { ExperimentRefRule, FeatureRule } from "back-end/types/feature";
import { ApiReqContext } from "back-end/types/api";
import { ProjectInterface } from "back-end/types/project";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { SafeRolloutSnapshotAnalysis } from "back-end/src/validators/safe-rollout-snapshot";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { ExperimentQueryMetadata } from "back-end/types/query";
import { getSignedImageUrl } from "back-end/src/services/files";
import { updateExperimentDashboards } from "back-end/src/enterprise/services/dashboards";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";
import { getReportVariations, getMetricForSnapshot } from "./reports";
import { validateIncrementalPipeline } from "./dataPipeline";
import {
  getIntegrationFromDatasourceId,
  getSourceIntegrationObject,
} from "./datasource";
import {
  analyzeExperimentResults,
  getMetricsAndQueryDataForStatsEngine,
  getMetricSettingsForStatsEngine,
  MetricSettingsForStatsEngine,
  QueryResultsForStatsEngine,
  runSnapshotAnalyses,
  runSnapshotAnalysis,
  writeSnapshotAnalyses,
} from "./stats";
import {
  getConfidenceLevelsForOrg,
  getEnvironmentIdsFromOrg,
  getMetricDefaultsForOrg,
  getPValueCorrectionForOrg,
  getPValueThresholdForOrg,
} from "./organizations";

export const DEFAULT_METRIC_ANALYSIS_DAYS = 90;

export async function createMetric(
  context: Context,
  data: Partial<MetricInterface>,
) {
  const metric = insertMetric(context, {
    id: uniqid("met_"),
    ...data,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  if (data.tags && data.organization) {
    await addTags(data.organization, data.tags);
  }

  return metric;
}

export async function getExperimentMetricById(
  context: Context,
  metricId: string,
): Promise<ExperimentMetricInterface | null> {
  // Handle slice metric IDs by extracting the base metric ID
  const sliceInfo = parseSliceMetricId(metricId);
  const actualMetricId = sliceInfo.isSliceMetric
    ? sliceInfo.baseMetricId
    : metricId;

  if (isFactMetricId(actualMetricId)) {
    return context.models.factMetrics.getById(actualMetricId);
  }
  return getMetricById(context, actualMetricId);
}

export async function getExperimentMetricsByIds(
  context: Context,
  metricIds: string[],
): Promise<ExperimentMetricInterface[]> {
  const factMetricIds: string[] = [];
  const nonFactMetricIds: string[] = [];
  metricIds.forEach((id) => {
    if (isFactMetricId(id)) {
      factMetricIds.push(id);
    } else {
      nonFactMetricIds.push(id);
    }
  });
  const factMetrics = await context.models.factMetrics.getByIds(factMetricIds);
  const metrics = await getMetricsByIds(context, nonFactMetricIds);
  return [...factMetrics, ...metrics];
}

export async function refreshMetric(
  context: Context,
  metric: MetricInterface,
  metricAnalysisDays: number = DEFAULT_METRIC_ANALYSIS_DAYS,
) {
  if (metric.datasource) {
    const integration = await getIntegrationFromDatasourceId(
      context,
      metric.datasource,
      true,
    );

    let segment: SegmentInterface | undefined = undefined;
    if (metric.segment) {
      segment =
        (await context.models.segments.getById(metric.segment)) || undefined;
      if (!segment || segment.datasource !== metric.datasource) {
        throw new Error("Invalid user segment chosen");
      }
    }

    const factTableMap = await getFactTableMap(context);

    let days = metricAnalysisDays;
    if (days < 1) {
      days = DEFAULT_METRIC_ANALYSIS_DAYS;
    }

    const from = new Date();
    from.setDate(from.getDate() - days);
    const to = new Date();
    to.setDate(to.getDate() + 1);

    const queryRunner = new LegacyMetricAnalysisQueryRunner(
      context,
      metric,
      integration,
    );
    await queryRunner.startAnalysis({
      from,
      to,
      name: `Last ${days} days`,
      includeByDate: true,
      segment,
      metric,
      factTableMap,
    });
  } else {
    throw new Error("Cannot analyze manual metrics");
  }
}

export async function getManualSnapshotData(
  experiment: ExperimentInterface,
  snapshotSettings: ExperimentSnapshotSettings,
  analysisSettings: ExperimentSnapshotAnalysisSettings,
  phaseIndex: number,
  users: number[],
  metrics: {
    [key: string]: MetricStats[];
  },
  metricMap: Map<string, ExperimentMetricInterface>,
) {
  const phase = experiment.phases[phaseIndex];

  // Default variation values, override from SQL results if available
  const variations: SnapshotVariation[] = experiment.variations.map((v, i) => ({
    users: users[i],
    metrics: {},
  }));

  const metricSettings: Record<string, MetricSettingsForStatsEngine> = {};
  const queryResults: QueryResultsForStatsEngine[] = [];
  Object.keys(metrics).forEach((m) => {
    const stats = metrics[m];
    const metric = metricMap.get(m);
    if (!metric) return null;
    metricSettings[m] = {
      ...getMetricSettingsForStatsEngine(metric, metricMap, snapshotSettings),
      // no ratio or regression adjustment for manual snapshots
      statistic_type: "mean",
    };
    queryResults.push({
      rows: stats.map((s, i) => {
        return {
          dimension: "All",
          variation: experiment.variations[i].key || i + "",
          users: s.count,
          count: s.count,
          main_sum: s.mean * s.count,
          main_sum_squares: sumSquaresFromStats(
            s.mean * s.count,
            Math.pow(s.stddev, 2),
            s.count,
          ),
        };
      }),
      metrics: [m],
    });
  });

  const { results } = await runSnapshotAnalysis({
    id: experiment.id,
    variations: getReportVariations(experiment, phase),
    phaseLengthHours: Math.max(
      hoursBetween(phase.dateStarted, phase.dateEnded ?? new Date()),
      1,
    ),
    coverage: experiment.phases?.[phaseIndex]?.coverage ?? 1,
    analyses: [{ ...analysisSettings, regressionAdjusted: false }], // no RA for manual snapshots
    metrics: metricSettings,
    queryResults: queryResults,
  });

  results.forEach(({ metric, analyses }) => {
    const res = analyses[0];
    const data = res.dimensions[0];
    if (!data) return;

    // If the value inside the ci is null from gbstats
    // it actually means Infinity, so handle that case
    data.variations.map((v, i) => {
      const ci: [number, number] | undefined = v.ci
        ? [v.ci[0] ?? -Infinity, v.ci[1] ?? Infinity]
        : undefined;
      variations[i].metrics[metric] = {
        ...v,
        ci,
      };
    });
  });

  const srm = checkSrm(users, phase.variationWeights);

  return {
    srm,
    variations,
  };
}

export function getDefaultExperimentAnalysisSettings(
  statsEngine: StatsEngine,
  experiment: ExperimentInterface | ExperimentReportAnalysisSettings,
  organization: OrganizationInterface,
  regressionAdjustmentEnabled?: boolean,
  dimension?: string,
): ExperimentSnapshotAnalysisSettings {
  const hasRegressionAdjustmentFeature = organization
    ? orgHasPremiumFeature(organization, "regression-adjustment")
    : false;
  const hasPostStratificationFeature = organization
    ? orgHasPremiumFeature(organization, "post-stratification")
    : false;
  const hasSequentialTestingFeature = organization
    ? orgHasPremiumFeature(organization, "sequential-testing")
    : false;
  return {
    statsEngine,
    dimensions: dimension ? [dimension] : [],
    regressionAdjusted:
      hasRegressionAdjustmentFeature &&
      (regressionAdjustmentEnabled !== undefined
        ? regressionAdjustmentEnabled
        : (organization.settings?.regressionAdjustmentEnabled ?? false)),
    postStratificationEnabled:
      hasPostStratificationFeature &&
      !(organization.settings?.postStratificationDisabled ?? false),
    sequentialTesting:
      hasSequentialTestingFeature &&
      statsEngine === "frequentist" &&
      (experiment?.sequentialTestingEnabled ??
        !!organization.settings?.sequentialTestingEnabled),
    sequentialTestingTuningParameter:
      experiment?.sequentialTestingTuningParameter ??
      organization.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    baselineVariationIndex: 0,
    differenceType: "relative",
    pValueThreshold:
      organization.settings?.pValueThreshold ?? DEFAULT_P_VALUE_THRESHOLD,
    numGoalMetrics: experiment.goalMetrics.length,
  };
}

export function getAdditionalExperimentAnalysisSettings(
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings,
): ExperimentSnapshotAnalysisSettings[] {
  const additionalAnalyses: ExperimentSnapshotAnalysisSettings[] = [];

  // for default baseline, get difference types
  additionalAnalyses.push({
    ...defaultAnalysisSettings,
    differenceType: "absolute",
  });
  additionalAnalyses.push({
    ...defaultAnalysisSettings,
    differenceType: "scaled",
  });

  return additionalAnalyses;
}

export function isJoinableMetric({
  metricId,
  metricMap,
  factTableMap,
  exposureQuery,
  datasource,
}: {
  metricId: string;
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  exposureQuery?: ExposureQuery;
  datasource?: DataSourceInterface;
}): boolean {
  if (!exposureQuery || !datasource) {
    // be lenient and allow metrics through
    return true;
  }
  const experimentIdType = exposureQuery.userIdType;
  const metric = metricMap.get(metricId);

  if (!metric) {
    // be lenient and allow metrics through
    return true;
  }

  const metricIdTypes =
    (isFactMetric(metric)
      ? factTableMap.get(metric.numerator.factTableId)?.userIdTypes
      : metric.userIdTypes) ?? [];

  return isMetricJoinable(metricIdTypes, experimentIdType, datasource.settings);
}

export function getSnapshotSettings({
  experiment,
  phaseIndex,
  snapshotType,
  dimension,
  regressionAdjustmentEnabled,
  orgPriorSettings,
  orgDisabledPrecomputedDimensions,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
  metricGroups,
  reweight,
  datasource,
}: {
  experiment: ExperimentInterface;
  phaseIndex: number;
  snapshotType: SnapshotType;
  dimension: string | null;
  regressionAdjustmentEnabled: boolean;
  orgPriorSettings: MetricPriorSettings | undefined;
  orgDisabledPrecomputedDimensions: boolean;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  metricGroups: MetricGroupInterface[];
  reweight?: boolean;
  datasource?: DataSourceInterface;
}): ExperimentSnapshotSettings {
  const phase = experiment.phases[phaseIndex];
  if (!phase) {
    throw new Error("Invalid snapshot phase");
  }

  const defaultPriorSettings = orgPriorSettings ?? {
    override: false,
    proper: false,
    mean: 0,
    stddev: DEFAULT_PROPER_PRIOR_STDDEV,
  };

  const queries = datasource?.settings?.queries?.exposure || [];
  const exposureQuery = queries.find(
    (q) => q.id === experiment.exposureQueryId,
  );

  // get dimensions for standard analysis
  // TODO(dimensions): customize which dimensions to use at experiment level

  const precomputeDimensions =
    snapshotType === "standard" &&
    experiment.type !== "multi-armed-bandit" &&
    !dimension &&
    !!datasource &&
    !!exposureQuery &&
    !!exposureQuery.dimensionMetadata &&
    !orgDisabledPrecomputedDimensions;

  let dimensions: DimensionForSnapshot[] = dimension ? [{ id: dimension }] : [];
  if (precomputeDimensions) {
    // if standard snapshot with no dimension set, we should pre-compute dimensions
    const predefinedDimensions = getPredefinedDimensionSlicesByExperiment(
      (exposureQuery.dimensionMetadata ?? []).filter((d) =>
        exposureQuery.dimensions.includes(d.dimension),
      ),
      experiment.variations.length,
    );
    dimensions =
      predefinedDimensions.map((d) => ({
        id: "precomputed:" + d.dimension,
        slices: d.specifiedSlices,
      })) ?? [];
  }

  // expand metric groups and scrub unjoinable metrics
  let goalMetrics = expandMetricGroups(
    experiment.goalMetrics,
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
  let secondaryMetrics = expandMetricGroups(
    experiment.secondaryMetrics,
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
  let guardrailMetrics = expandMetricGroups(
    experiment.guardrailMetrics,
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

  // filter invalid metrics (holdouts)
  if (experiment.type === "holdout") {
    goalMetrics = goalMetrics.filter((m) => {
      const metric = metricMap.get(m);
      return metric?.windowSettings?.type !== "conversion";
    });
    secondaryMetrics = secondaryMetrics.filter((m) => {
      const metric = metricMap.get(m);
      return metric?.windowSettings?.type !== "conversion";
    });
    guardrailMetrics = [];
  }

  // Set currentDate in a const to use the same date for all metric settings
  const currentDate = new Date();

  // Expand all slice metrics (auto and custom) and add them to the metricMap
  // Skip slice expansion for dimension snapshots
  if (!dimension) {
    expandAllSliceMetricsInMap({
      metricMap,
      factTableMap,
      experiment,
      metricGroups,
    });
  }

  const metricSettings = getAllExpandedMetricIdsFromExperiment({
    exp: {
      goalMetrics,
      secondaryMetrics,
      guardrailMetrics,
      activationMetric: experiment.activationMetric,
    },
    expandedMetricMap: metricMap,
    includeActivationMetric: true,
    metricGroups,
  })
    .map((m) =>
      getMetricForSnapshot({
        id: m,
        metricMap,
        settingsForSnapshotMetrics,
        metricOverrides: experiment.metricOverrides,
        decisionFrameworkSettings: experiment.decisionFrameworkSettings,
        phaseLookbackWindow:
          experiment.type === "holdout" &&
          phase.lookbackStartDate &&
          phase.lookbackStartDate < currentDate
            ? {
                value: differenceInHours(currentDate, phase.lookbackStartDate, {
                  roundingMethod: "ceil",
                }),
                unit: "hours",
              }
            : undefined,
      }),
    )
    .filter(isDefined);

  // JIT initialize banditEvents in memory if missing
  if (
    experiment.type === "multi-armed-bandit" &&
    phase &&
    (!phase.banditEvents || phase.banditEvents.length === 0)
  ) {
    logger.warn(
      "JIT initializing banditEvents in memory (getSnapshotSettings)",
    );
    const weights =
      phase.variationWeights || getEqualWeights(experiment.variations.length);
    const initialBanditEvent = {
      date: phase.dateStarted || new Date(),
      banditResult: {
        currentWeights: weights,
        updatedWeights: weights,
        bestArmProbabilities: weights,
      },
    };
    phase.banditEvents = [initialBanditEvent];
  }

  const banditSettings: SnapshotBanditSettings | undefined =
    experiment.type === "multi-armed-bandit"
      ? {
          reweight: !!reweight,
          decisionMetric: experiment.goalMetrics?.[0],
          seed: Math.floor(Math.random() * 100000),
          currentWeights:
            phase?.banditEvents?.[phase.banditEvents.length - 1]?.banditResult
              ?.updatedWeights ??
            phase?.variationWeights ??
            [],
          historicalWeights:
            phase?.banditEvents
              ?.filter(
                // only keep first sign post or reweight event for
                // srm or SQL
                (event, i) => i === 0 || event.banditResult?.reweight,
              )
              .map((event) => ({
                date: event.date,
                weights: event.banditResult.updatedWeights,
                totalUsers:
                  event.banditResult?.singleVariationResults?.reduce(
                    (sum, cur) => sum + (cur.users ?? 0),
                    0,
                  ) ?? 0,
              })) ?? [],
        }
      : undefined;

  return {
    manual: !experiment.datasource,
    activationMetric: experiment.activationMetric || null,
    attributionModel: experiment.attributionModel || "firstExposure",
    skipPartialData: !!experiment.skipPartialData,
    segment: experiment.segment || "",
    queryFilter: experiment.queryFilter || "",
    datasourceId: experiment.datasource || "",
    dimensions: dimensions,
    startDate: phase.dateStarted,
    endDate: phase.dateEnded || new Date(),
    experimentId: experiment.trackingKey || experiment.id,
    phase: {
      index: phaseIndex + "",
    },
    customFields: experiment.customFields,
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics,
    regressionAdjustmentEnabled,
    defaultMetricPriorSettings: defaultPriorSettings,
    exposureQueryId: experiment.exposureQueryId,
    metricSettings,
    variations: experiment.variations.map((v, i) => ({
      id: v.key || i + "",
      weight: phase.variationWeights[i] || 0,
    })),
    coverage: phase.coverage ?? 1,
    banditSettings,
  };
}

export async function createManualSnapshot({
  experiment,
  phaseIndex,
  users,
  metrics,
  orgPriorSettings,
  analysisSettings,
  metricMap,
}: {
  experiment: ExperimentInterface;
  phaseIndex: number;
  users: number[];
  metrics: {
    [key: string]: MetricStats[];
  };
  orgPriorSettings: MetricPriorSettings | undefined;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
}) {
  const snapshotSettings = getSnapshotSettings({
    experiment,
    phaseIndex,
    orgPriorSettings: orgPriorSettings,
    orgDisabledPrecomputedDimensions: false,
    snapshotType: "standard",
    dimension: null,
    regressionAdjustmentEnabled: false,
    settingsForSnapshotMetrics: [],
    metricMap,
    factTableMap: new Map(), // todo
    metricGroups: [], // todo?
  });

  const { srm, variations } = await getManualSnapshotData(
    experiment,
    snapshotSettings,
    analysisSettings,
    phaseIndex,
    users,
    metrics,
    metricMap,
  );

  const data: ExperimentSnapshotInterface = {
    id: uniqid("snp_"),
    organization: experiment.organization,
    experiment: experiment.id,
    dimension: null,
    phase: phaseIndex,
    queries: [],
    runStarted: new Date(),
    dateCreated: new Date(),
    status: "success",
    settings: snapshotSettings,
    unknownVariations: [],
    multipleExposures: 0,
    analyses: [
      {
        dateCreated: new Date(),
        status: "success",
        settings: analysisSettings,
        results: [
          {
            name: "All",
            srm,
            variations,
          },
        ],
      },
    ],
    triggeredBy: "manual",
  };

  return await createExperimentSnapshotModel({ data });
}

export async function parseDimension(
  dimension: string | null | undefined,
  slices: string[] | undefined,
  organization: string,
): Promise<Dimension | null> {
  if (dimension) {
    if (dimension.match(/^exp:/)) {
      return {
        type: "experiment",
        id: dimension.substr(4),
        specifiedSlices: slices,
      };
    } else if (dimension.match(/^precomputed:/)) {
      return {
        type: "experiment",
        id: dimension.substr(12),
        specifiedSlices: slices,
      };
    } else if (dimension.substr(0, 4) === "pre:") {
      return {
        // eslint-disable-next-line
        type: dimension.substr(4) as any,
      };
    } else {
      const obj = await findDimensionById(dimension, organization);
      if (obj) {
        return {
          type: "user",
          dimension: obj,
        };
      }
    }
  }
  return null;
}

export function determineNextDate(schedule: ExperimentUpdateSchedule | null) {
  // Default to every X hours if no organization-specific schedule is set
  let hours = EXPERIMENT_REFRESH_FREQUENCY;

  if (schedule?.type === "never") {
    return null;
  }
  if (schedule?.type === "cron") {
    try {
      const interval = cronParser.parseExpression(schedule?.cron || "");
      const next = interval.next();

      hours = (next.getTime() - Date.now()) / 1000 / 60 / 60;
    } catch (e) {
      logger.warn(e, "Failed to parse cron expression");
    }
  }
  if (schedule?.type === "stale") {
    hours = schedule?.hours || 0;
  }

  // Sanity check to make sure the next update is somewhere between 1 hour and 7 days
  if (!hours) hours = EXPERIMENT_REFRESH_FREQUENCY;
  if (hours < 1) hours = 1;
  if (hours > 168) hours = 168;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function determineNextBanditSchedule(exp: ExperimentInterface): Date {
  const start = (
    exp?.banditStageDateStarted ??
    exp.phases?.[exp.phases.length - 1]?.dateStarted ??
    new Date()
  ).getTime();

  if (exp.banditBurnInValue === undefined) {
    throw new Error(
      "Cannot schedule next experiment update. banditBurnInValue is unset.",
    );
  }
  if (exp.banditBurnInUnit === undefined) {
    throw new Error(
      "Cannot schedule next experiment update. banditBurnInUnit is unset.",
    );
  }
  if (exp.banditScheduleValue === undefined) {
    throw new Error(
      "Cannot schedule next experiment update. banditScheduleValue is unset.",
    );
  }
  if (exp.banditScheduleUnit === undefined) {
    throw new Error(
      "Cannot schedule next experiment update. banditScheduleUnit is unset.",
    );
  }

  const standardHoursMultiple = exp.banditScheduleUnit === "days" ? 24 : 1;
  const standardInterval =
    exp.banditScheduleValue * standardHoursMultiple * 60 * 60 * 1000;
  const elapsedTime = Date.now() - start;
  const intervalsPassed = Math.floor(elapsedTime / standardInterval);
  const nextStandardRunDate = new Date(
    start + (intervalsPassed + 1) * standardInterval,
  );

  if (exp.banditStage === "explore") {
    const burnInHoursMultiple = exp.banditBurnInUnit === "days" ? 24 : 1;
    const burnInRunDate = new Date(
      start + exp.banditBurnInValue * burnInHoursMultiple * 60 * 60 * 1000,
    );
    if (burnInRunDate < nextStandardRunDate) {
      return burnInRunDate;
    }
  }

  return nextStandardRunDate;
}

export function resetExperimentBanditSettings({
  experiment,
  metricMap,
  changes,
  settings,
  preserveExistingBanditEvents,
}: {
  experiment: ExperimentInterface | Omit<ExperimentInterface, "id">;
  metricMap?: Map<string, ExperimentMetricInterface>;
  changes?: Changeset;
  settings: ScopedSettings;
  preserveExistingBanditEvents?: boolean;
}): Changeset {
  if (!changes) changes = {};
  if (!changes.phases) changes.phases = [...experiment.phases];
  const phase = changes.phases.length - 1;

  // 1 goal metric
  let goalMetric: string | undefined =
    changes.goalMetrics?.[0] || experiment.goalMetrics?.[0];
  changes.goalMetrics = goalMetric ? [goalMetric] : [];

  // No empty datasource allowed. If empty, remove the metric to block starting.
  const dataSource = changes.datasource || experiment.datasource;
  if (!dataSource) {
    goalMetric = undefined;
    changes.goalMetrics = [];
  }

  // No quantile metrics allowed (only need to check for endpoints that change metrics)
  if (goalMetric && metricMap) {
    const metric = metricMap.get(goalMetric);
    if (metric && metric?.cappingSettings?.type === "percentile") {
      changes.goalMetrics = [];
    }
  }

  // Scrub invalid settings:
  // stats engine
  changes.statsEngine = "bayesian";
  // activation metric
  changes.activationMetric = undefined;
  // segments
  changes.segment = undefined;
  // conversion windows
  changes.attributionModel = "firstExposure";
  // custom SQL filter
  changes.queryFilter = undefined;
  // metric overrides
  changes.metricOverrides = undefined;
  // don't disable sticky bucketing
  changes.disableStickyBucketing = false;

  // Reset bandit stage
  if (!preserveExistingBanditEvents) {
    changes.banditStage = "explore";
    changes.banditStageDateStarted = new Date();

    // Set equal weights
    const weights = getEqualWeights(experiment.variations.length ?? 0);
    changes.phases[phase].variationWeights = weights;

    // Log first weight change event
    changes.phases[phase].banditEvents = [
      {
        date: new Date(),
        banditResult: {
          currentWeights: weights,
          updatedWeights: weights,
          bestArmProbabilities: weights,
        },
      },
    ];
  } else {
    // Even when preserving existing events, ensure banditEvents exists and has at least one event
    const changesBanditEvents = changes.phases[phase]?.banditEvents;
    const experimentBanditEvents = experiment.phases[phase]?.banditEvents;
    const hasValidBanditEvents =
      (changesBanditEvents && changesBanditEvents.length > 0) ||
      (experimentBanditEvents && experimentBanditEvents.length > 0);

    if (!hasValidBanditEvents) {
      logger.warn(
        "initializing missing banditEvents (resetExperimentBanditSettings)",
      );
      const weights =
        changes.phases[phase].variationWeights ||
        experiment.phases[phase]?.variationWeights ||
        getEqualWeights(experiment.variations.length ?? 0);
      changes.phases[phase].banditEvents = [
        {
          date:
            changes.phases[phase].dateStarted ||
            experiment.phases[phase]?.dateStarted ||
            new Date(),
          banditResult: {
            currentWeights: weights,
            updatedWeights: weights,
            bestArmProbabilities: weights,
          },
        },
      ];
    }
  }

  // Scheduling
  // ensure bandit scheduling exists
  changes.banditScheduleValue =
    changes.banditScheduleValue ??
    experiment.banditScheduleValue ??
    settings.banditScheduleValue.value;
  changes.banditScheduleUnit =
    changes.banditScheduleUnit ??
    experiment.banditScheduleUnit ??
    settings.banditScheduleUnit.value;
  changes.banditBurnInValue =
    changes.banditBurnInValue ??
    experiment.banditBurnInValue ??
    settings.banditBurnInValue.value;
  changes.banditBurnInUnit =
    changes.banditBurnInUnit ??
    experiment.banditBurnInUnit ??
    settings.banditBurnInUnit.value;
  // schedule
  changes.nextSnapshotAttempt = determineNextBanditSchedule({
    ...experiment,
    ...changes,
  } as ExperimentInterface);

  return changes;
}

export function updateExperimentBanditSettings({
  experiment,
  changes,
  snapshot,
  reweight = false,
  isScheduled = false,
}: {
  experiment: ExperimentInterface;
  changes?: Changeset;
  snapshot?: ExperimentSnapshotInterface;
  reweight?: boolean;
  isScheduled?: boolean;
}): Changeset {
  if (!changes) changes = {};
  if (!changes.phases) {
    changes.phases = cloneDeep<ExperimentPhase[]>(experiment.phases);
  }
  const phase = changes.phases.length - 1;

  const banditResult: BanditResult | undefined = snapshot?.banditResult;
  const snapshotDateCreated =
    snapshot?.analyses?.[0]?.dateCreated ?? new Date();

  // Check if we need to move from explore to exploit phase:
  let startNextbanditStage = false;
  if (experiment.banditStage === "explore") {
    if (!isScheduled && reweight) {
      // manual reweights during explore immediately start the exploit phase
      startNextbanditStage = true;
    } else {
      // if we are past the explore period, start the exploit phase
      const banditStageStartDate =
        experiment?.banditStageDateStarted ??
        experiment.phases[phase]?.dateStarted ??
        new Date();
      const hoursMultiple = experiment.banditBurnInUnit === "days" ? 24 : 1;
      const exploitInterval =
        (experiment.banditBurnInValue ?? 0) * hoursMultiple * 60 * 60 * 1000;

      if (
        snapshotDateCreated.getTime() >
        banditStageStartDate.getTime() + exploitInterval
      ) {
        if (isScheduled) reweight = true;
        startNextbanditStage = true;
      }
    }
  }

  if (startNextbanditStage) {
    changes.banditStage = "exploit";
    changes.banditStageDateStarted = new Date();
  }

  // Apply the bandit results:
  if (banditResult) {
    if (reweight) {
      // apply the latest weights (SDK level)
      changes.phases[phase].variationWeights = banditResult.updatedWeights;
      // re-randomize to reduce bias (in cases of multiple exposures / failed sticky bucketing)
      changes.phases[phase].seed = uuidv4();
    } else {
      // ignore (revert) the weight changes
      banditResult.updatedWeights = changes.phases[phase].variationWeights;
    }

    // log weight change event
    if (!changes.phases[phase].banditEvents) {
      changes.phases[phase].banditEvents = [];
    }
    changes.phases[phase].banditEvents?.push({
      date: snapshotDateCreated,
      banditResult: { ...banditResult, reweight },
      snapshotId: snapshot?.id,
    });
  } else {
    logger.error(
      {
        eid: experiment.id,
        snapshot,
      },
      "No bandit results present, skipping bandit event log",
    );
  }

  // scheduling
  if (
    changes.banditStage === "exploit" ||
    experiment.banditStage === "exploit"
  ) {
    changes.nextSnapshotAttempt = determineNextBanditSchedule({
      ...experiment,
      ...changes,
    } as ExperimentInterface);
  }

  return changes;
}

export function getAdditionalQueryMetadataForExperiment(
  experiment: ExperimentInterface,
): ExperimentQueryMetadata {
  return {
    experimentOwner: experiment.owner || undefined,
    experimentProject: experiment.project || undefined,
    experimentTags: experiment.tags.length > 0 ? experiment.tags : undefined,
  };
}

export async function createSnapshot({
  experiment,
  context,
  type,
  triggeredBy,
  phaseIndex,
  useCache = false,
  defaultAnalysisSettings,
  additionalAnalysisSettings,
  settingsForSnapshotMetrics,
  metricMap,
  factTableMap,
  reweight,
  preventStartingAnalysis,
}: {
  experiment: ExperimentInterface;
  context: ReqContext | ApiReqContext;
  type: SnapshotType;
  triggeredBy: SnapshotTriggeredBy;
  phaseIndex: number;
  useCache?: boolean;
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings;
  additionalAnalysisSettings: ExperimentSnapshotAnalysisSettings[];
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  reweight?: boolean;
  preventStartingAnalysis?: boolean;
}): Promise<
  | ExperimentResultsQueryRunner
  | ExperimentIncrementalRefreshQueryRunner
  | ExperimentIncrementalRefreshExploratoryQueryRunner
> {
  const { org: organization } = context;
  const dimension = defaultAnalysisSettings.dimensions[0] || null;
  const metricGroups = await context.models.metricGroups.getAll();

  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) {
    throw new Error("Could not load data source");
  }

  const snapshotSettings = getSnapshotSettings({
    experiment,
    phaseIndex,
    orgPriorSettings: organization.settings?.metricDefaults?.priorSettings,
    orgDisabledPrecomputedDimensions:
      organization.settings?.disablePrecomputedDimensions ?? true,
    snapshotType: type,
    dimension,
    regressionAdjustmentEnabled: !!defaultAnalysisSettings.regressionAdjusted,
    settingsForSnapshotMetrics,
    metricMap,
    factTableMap,
    metricGroups,
    reweight,
    datasource,
  });

  const data: ExperimentSnapshotInterface = {
    id: uniqid("snp_"),
    organization: experiment.organization,
    experiment: experiment.id,
    runStarted: new Date(),
    error: "",
    dateCreated: new Date(),
    phase: phaseIndex,
    queries: [],
    dimension: dimension || null,
    settings: snapshotSettings,
    type,
    triggeredBy,
    unknownVariations: [],
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
          const analysis: ExperimentSnapshotAnalysis = {
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

  let scheduleNextSnapshot = true;
  if (experiment.type === "multi-armed-bandit" && type !== "standard") {
    // explore tab actions should never trigger the next schedule for bandits
    scheduleNextSnapshot = false;
  }

  if (scheduleNextSnapshot) {
    const nextUpdate =
      experiment.type !== "multi-armed-bandit"
        ? determineNextDate(organization.settings?.updateSchedule || null)
        : determineNextBanditSchedule(experiment);

    await updateExperiment({
      context,
      experiment,
      changes: {
        lastSnapshotAttempt: new Date(),
        ...(nextUpdate ? { nextSnapshotAttempt: nextUpdate } : {}),
        autoSnapshots: nextUpdate !== null,
      },
    });
  }

  const snapshot = await createExperimentSnapshotModel({ data });
  const integration = getSourceIntegrationObject(context, datasource, true);
  const incrementalRefreshModel =
    await context.models.incrementalRefresh.getByExperimentId(experiment.id);
  const fullRefresh = !useCache || !incrementalRefreshModel;

  const isIncrementalRefreshEnabledForExperiment =
    datasource.settings.pipelineSettings?.mode === "incremental" &&
    !datasource.settings.pipelineSettings?.excludedExperimentIds?.includes(
      experiment.id,
    ) &&
    (datasource.settings.pipelineSettings?.includedExperimentIds ===
      undefined ||
      datasource.settings.pipelineSettings?.includedExperimentIds.includes(
        experiment.id,
      ));

  let isExperimentCompatibleWithIncrementalRefresh;
  try {
    await validateIncrementalPipeline({
      org: organization,
      integration,
      snapshotSettings: data.settings,
      metricMap,
      factTableMap,
      experiment,
      incrementalRefreshModel,
      analysisType: fullRefresh
        ? "main-fullRefresh"
        : snapshot.type === "standard"
          ? "main-update"
          : "exploratory",
    });
    isExperimentCompatibleWithIncrementalRefresh = true;
  } catch (error) {
    isExperimentCompatibleWithIncrementalRefresh = false;
    logger.info(
      `Experiment ${experiment.id} does not support incremental refresh: ${"message" in error ? error.message : error}`,
    );
  }

  let queryRunner:
    | ExperimentResultsQueryRunner
    | ExperimentIncrementalRefreshQueryRunner
    | ExperimentIncrementalRefreshExploratoryQueryRunner;

  if (
    isIncrementalRefreshEnabledForExperiment &&
    (experiment.type === undefined || experiment.type === "standard") &&
    isExperimentCompatibleWithIncrementalRefresh
  ) {
    if (snapshot.type === "exploratory") {
      queryRunner = new ExperimentIncrementalRefreshExploratoryQueryRunner(
        context,
        snapshot,
        integration,
        false, // TODO(incremental-refresh): allow cache + cache override for exploratory queries
      );
    } else {
      queryRunner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        snapshot,
        integration,
        false, // always ignore cache for incremental refresh queries
      );
    }
  } else {
    queryRunner = new ExperimentResultsQueryRunner(
      context,
      snapshot,
      integration,
      useCache,
    );
  }

  if (!preventStartingAnalysis) {
    const analysisProps = {
      snapshotType: type,
      snapshotSettings: data.settings,
      variationNames: experiment.variations.map((v) => v.name),
      metricMap,
      queryParentId: snapshot.id,
      factTableMap,
      experimentQueryMetadata:
        getAdditionalQueryMetadataForExperiment(experiment),
    };

    if (
      queryRunner instanceof ExperimentIncrementalRefreshQueryRunner ||
      queryRunner instanceof ExperimentIncrementalRefreshExploratoryQueryRunner
    ) {
      const incrementalRefreshData =
        await context.models.incrementalRefresh.getByExperimentId(
          experiment.id,
        );
      const hasIncrementalRefreshData = !!incrementalRefreshData;

      const fullRefresh =
        (!useCache || !hasIncrementalRefreshData) &&
        snapshot.type === "standard";

      await queryRunner.startAnalysis({
        ...analysisProps,
        experimentId: experiment.id,
        incrementalRefreshStartTime: new Date(),
        fullRefresh,
      });
    } else {
      await queryRunner.startAnalysis(analysisProps);
    }
  }

  const runningSnapshot = queryRunner.model;
  // Whenever the standard snapshot for an experiment is refreshed, also refresh the associated dashboards in the background
  if (
    runningSnapshot.type === "standard" &&
    runningSnapshot.triggeredBy !== "manual-dashboard"
  ) {
    updateExperimentDashboards({
      context,
      experiment,
      mainSnapshot: runningSnapshot,
      statsEngine: defaultAnalysisSettings.statsEngine,
      regressionAdjustmentEnabled:
        defaultAnalysisSettings.regressionAdjusted ?? false,
      settingsForSnapshotMetrics,
      metricMap,
      factTableMap,
    });
  }

  return queryRunner;
}

export type SnapshotAnalysisParams = {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  snapshot: ExperimentSnapshotInterface;
};

export async function _getSnapshots(
  context: ReqContext | ApiReqContext,
  experimentObjs: ExperimentInterface[],
  dimension?: string,
  withResults: boolean = true,
): Promise<ExperimentSnapshotInterface[]> {
  const experimentPhaseMap: Map<string, number> = new Map();
  experimentObjs.forEach((e) => {
    if (e.organization !== context.org.id) {
      throw new Error("You do not have access to view this experiment");
    }
    // get the latest phase
    experimentPhaseMap.set(e.id, e.phases.length - 1);
  });
  return await getLatestSnapshotMultipleExperiments(
    experimentPhaseMap,
    dimension,
    withResults,
  );
}

async function getSnapshotAnalyses(
  params: SnapshotAnalysisParams[],
  context: ReqContext,
) {
  const analysisParamsMap = new Map<
    string,
    ExperimentAnalysisParamsContextData
  >();

  // get queryMap for all snapshots
  const queryMap = await getQueryMap(
    context.org.id,
    params.map((p) => p.snapshot.queries).flat(),
  );

  const createAnalysisPromises: (() => Promise<void>)[] = [];
  params.forEach(
    (
      { experiment, organization, analysisSettings, metricMap, snapshot },
      i,
    ) => {
      // check if analysis is possible
      if (!isAnalysisAllowed(snapshot.settings, analysisSettings)) {
        logger.error(`Analysis not allowed with this snapshot: ${snapshot.id}`);
        return;
      }

      const totalQueries = snapshot.queries.length;
      const failedQueries = snapshot.queries.filter(
        (q) => q.status === "failed",
      );
      const runningQueries = snapshot.queries.filter(
        (q) => q.status === "running",
      );

      if (
        runningQueries.length > 0 ||
        failedQueries.length >= totalQueries / 2
      ) {
        logger.error(
          `Snapshot queries not available for analysis: ${snapshot.id}`,
        );
        return;
      }
      const analysis: ExperimentSnapshotAnalysis = {
        results: [],
        status: "running",
        settings: analysisSettings,
        dateCreated: new Date(),
      };

      // promise to add analysis to mongo record if it does not exist, overwrite if it does
      createAnalysisPromises.push(() =>
        addOrUpdateSnapshotAnalysis({
          organization: organization.id,
          id: snapshot.id,
          analysis,
        }),
      );

      const mdat = getMetricsAndQueryDataForStatsEngine(
        queryMap,
        metricMap,
        snapshot.settings,
      );
      const id = `${i}_${experiment.id}_${snapshot.id}`;
      const variationNames = experiment.variations.map((v) => v.name);
      const { queryResults, metricSettings, unknownVariations } = mdat;

      analysisParamsMap.set(id, {
        params: {
          id,
          coverage: snapshot.settings.coverage ?? 1,
          phaseLengthHours: Math.max(
            hoursBetween(
              snapshot.settings.startDate,
              snapshot.settings.endDate,
            ),
            1,
          ),
          variations: snapshot.settings.variations.map((v, i) => ({
            ...v,
            name: variationNames[i] || v.id,
          })),
          analyses: [analysisSettings],
          queryResults: queryResults,
          metrics: metricSettings,
        },
        context: {
          // extra settings for multiple experiment approach
          snapshotSettings: snapshot.settings,
          organization: organization.id,
          snapshot: snapshot.id,
        },
        data: {
          unknownVariations: unknownVariations,
          analysisObj: analysis,
        },
      });
    },
  );

  // write running snapshots to db
  if (createAnalysisPromises.length > 0) {
    await promiseAllChunks(createAnalysisPromises, 10);
  }

  return analysisParamsMap;
}

export async function createSnapshotAnalyses(
  params: SnapshotAnalysisParams[],
  context: ReqContext,
): Promise<void> {
  // creates snapshot analyses in mongo and gets analysis parameters
  const analysisParamsMap = await getSnapshotAnalyses(params, context);

  // calls stats engine to run analyses
  const results = await runSnapshotAnalyses(
    Array.from(analysisParamsMap.values()).map((v) => v.params),
  );

  // parses results and writes to mongo
  await writeSnapshotAnalyses(results, analysisParamsMap);
}

export async function createSnapshotAnalysis(
  params: SnapshotAnalysisParams,
): Promise<void> {
  const { snapshot, analysisSettings, organization, experiment, metricMap } =
    params;
  // check if analysis is possible
  if (!isAnalysisAllowed(snapshot.settings, analysisSettings)) {
    throw new Error("Analysis not allowed with this snapshot");
  }

  const totalQueries = snapshot.queries.length;
  const failedQueries = snapshot.queries.filter((q) => q.status === "failed");
  const runningQueries = snapshot.queries.filter((q) => q.status === "running");

  if (runningQueries.length > 0 || failedQueries.length >= totalQueries / 2) {
    throw new Error("Snapshot queries not available for analysis");
  }
  const analysis: ExperimentSnapshotAnalysis = {
    results: [],
    status: "running",
    settings: analysisSettings,
    dateCreated: new Date(),
  };
  // and analysis to mongo record if it does not exist, overwrite if it does
  addOrUpdateSnapshotAnalysis({
    organization: organization.id,
    id: snapshot.id,
    analysis,
  });

  // Format data correctly
  const queryMap: QueryMap = await getQueryMap(
    organization.id,
    snapshot.queries,
  );

  // Run the analysis
  const { results } = await analyzeExperimentResults({
    queryData: queryMap,
    snapshotSettings: snapshot.settings,
    analysisSettings: [analysisSettings],
    variationNames: experiment.variations.map((v) => v.name),
    metricMap: metricMap,
  });
  analysis.results = results[0]?.dimensions || [];
  analysis.status = "success";
  analysis.error = undefined;

  updateSnapshotAnalysis({
    organization: organization.id,
    id: snapshot.id,
    analysis,
  });
}

function getExperimentMetric(
  experiment: ExperimentInterface,
  id: string,
): ApiExperimentMetric {
  // For slice metrics, use the base metric ID for lookups
  const { baseMetricId } = parseSliceMetricId(id);
  const overrides = experiment.metricOverrides?.find(
    (o) => o.id === baseMetricId,
  );
  const ret: ApiExperimentMetric = {
    metricId: id,
    overrides: {},
  };

  if (overrides?.delayHours) {
    ret.overrides.delayHours = overrides.delayHours;
  }
  if (overrides?.windowHours) {
    ret.overrides.windowHours = overrides.windowHours;
  }
  if (overrides?.winRisk) {
    ret.overrides.winRiskThreshold = overrides.winRisk;
  }
  if (overrides?.loseRisk) {
    ret.overrides.loseRiskThreshold = overrides.loseRisk;
  }

  return ret;
}

export async function toExperimentApiInterface(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterfaceExcludingHoldouts,
): Promise<ApiExperiment> {
  const appOrigin = (APP_ORIGIN ?? "").replace(/\/$/, "");

  let project: ProjectInterface | null = null;
  const organization = context.org;
  if (experiment.project) {
    project = await context.models.projects.getById(experiment.project);
  }
  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    // todo: experiment settings
  });
  const experimentType = experiment.type || "standard";

  const activationMetric = experiment.activationMetric;
  return {
    id: experiment.id,
    trackingKey: experiment.trackingKey,
    name: experiment.name || "",
    type: experimentType,
    project: experiment.project || "",
    hypothesis: experiment.hypothesis || "",
    description: experiment.description || "",
    tags: experiment.tags || [],
    owner: experiment.owner || "",
    dateCreated: experiment.dateCreated.toISOString(),
    dateUpdated: experiment.dateUpdated.toISOString(),
    archived: !!experiment.archived,
    status: experiment.status,
    autoRefresh: !!experiment.autoSnapshots,
    hashAttribute: experiment.hashAttribute || "id",
    fallbackAttribute: experiment.fallbackAttribute,
    hashVersion: experiment.hashVersion || 2,
    disableStickyBucketing: experiment.disableStickyBucketing,
    bucketVersion: experiment.bucketVersion,
    minBucketVersion: experiment.minBucketVersion,
    variations: await Promise.all(
      experiment.variations.map(async (v) => ({
        variationId: v.id,
        key: v.key,
        name: v.name || "",
        description: v.description || "",
        screenshots: await Promise.all(
          v.screenshots.map(async (s) => {
            try {
              return await getSignedImageUrl(s.path);
            } catch (e) {
              return s.path;
            }
          }),
        ),
      })),
    ),
    phases: experiment.phases.map((p) => ({
      name: p.name,
      dateStarted: p.dateStarted.toISOString(),
      dateEnded: p.dateEnded ? p.dateEnded.toISOString() : "",
      reasonForStopping: p.reason || "",
      seed: p.seed || experiment.trackingKey,
      coverage: p.coverage,
      trafficSplit: experiment.variations.map((v, i) => ({
        variationId: v.id,
        weight: p.variationWeights[i] || 0,
      })),
      targetingCondition: p.condition || "",
      prerequisites: p.prerequisites || [],
      savedGroupTargeting: (p.savedGroups || []).map((s) => ({
        matchType: s.match,
        savedGroups: s.ids,
      })),
      namespace: p.namespace?.enabled
        ? {
            namespaceId: p.namespace.name,
            range: p.namespace.range,
          }
        : undefined,
    })),
    settings: {
      datasourceId: experiment.datasource || "",
      assignmentQueryId: experiment.exposureQueryId || "",
      experimentId: experiment.trackingKey,
      segmentId: experiment.segment || "",
      queryFilter: experiment.queryFilter || "",
      inProgressConversions: experiment.skipPartialData ? "exclude" : "include",
      attributionModel: experiment.attributionModel || "firstExposure",
      statsEngine: scopedSettings.statsEngine.value || DEFAULT_STATS_ENGINE,
      goals: experiment.goalMetrics.map((m) =>
        getExperimentMetric(experiment, m),
      ),
      secondaryMetrics: experiment.secondaryMetrics.map((m) =>
        getExperimentMetric(experiment, m),
      ),
      guardrails: experiment.guardrailMetrics.map((m) =>
        getExperimentMetric(experiment, m),
      ),
      regressionAdjustmentEnabled:
        experiment.regressionAdjustmentEnabled ??
        scopedSettings.regressionAdjustmentEnabled.value,
      sequentialTestingEnabled:
        experiment.sequentialTestingEnabled ??
        scopedSettings.sequentialTestingEnabled.value,
      sequentialTestingTuningParameter:
        experiment.sequentialTestingTuningParameter ??
        scopedSettings.sequentialTestingTuningParameter.value ??
        DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
      ...(activationMetric
        ? {
            activationMetric: getExperimentMetric(experiment, activationMetric),
          }
        : null),
    },
    ...(experiment.status === "stopped" && experiment.results
      ? {
          resultSummary: {
            status: experiment.results,
            winner: experiment.variations[experiment.winner ?? 0]?.id || "",
            conclusions: experiment.analysis || "",
            releasedVariationId: experiment.releasedVariationId || "",
            excludeFromPayload: !!experiment.excludeFromPayload,
          },
        }
      : null),
    shareLevel: experiment.shareLevel || "organization",
    ...(experiment.shareLevel === "public" && experiment.uid
      ? {
          publicUrl: `${appOrigin}/public/e/${experiment.uid}`,
        }
      : null),
    ...(experimentType === "multi-armed-bandit"
      ? {
          banditScheduleValue: experiment.banditScheduleValue ?? 1,
          banditScheduleUnit: experiment.banditScheduleUnit ?? "days",
          banditBurnInValue: experiment.banditBurnInValue ?? 1,
          banditBurnInUnit: experiment.banditBurnInUnit ?? "days",
        }
      : null),
    linkedFeatures: experiment.linkedFeatures || [],
    hasVisualChangesets: experiment.hasVisualChangesets || false,
    hasURLRedirects: experiment.hasURLRedirects || false,
    customFields: experiment.customFields ?? {},
  };
}

export function toSnapshotApiInterface(
  experiment: ExperimentInterface,
  snapshot: ExperimentSnapshotInterface,
  metricGroups: MetricGroupInterface[],
): ApiExperimentResults {
  const dimension = !snapshot.dimension
    ? {
        type: "none",
      }
    : snapshot.dimension.match(/^exp:/)
      ? {
          type: "experiment",
          id: snapshot.dimension.substring(4),
        }
      : snapshot.dimension.match(/^pre:/)
        ? {
            type: snapshot.dimension.substring(4),
          }
        : {
            type: "user",
            id: snapshot.dimension,
          };

  const phase = experiment.phases[snapshot.phase];

  const activationMetric =
    snapshot.settings.activationMetric || experiment.activationMetric;

  const metricIds = getAllMetricIdsFromExperiment(
    experiment,
    false,
    metricGroups,
  );

  const variationIds = experiment.variations.map((v) => v.id);

  // Get the default analysis
  const analysis = getSnapshotAnalysis(snapshot);

  return {
    id: snapshot.id,
    dateUpdated: snapshot.dateCreated.toISOString(),
    experimentId: snapshot.experiment,
    phase: snapshot.phase + "",
    dimension: dimension,
    dateStart: phase?.dateStarted?.toISOString() || "",
    dateEnd:
      phase?.dateEnded?.toISOString() ||
      snapshot.runStarted?.toISOString() ||
      "",
    settings: {
      datasourceId: experiment.datasource || "",
      assignmentQueryId: experiment.exposureQueryId || "",
      experimentId: experiment.trackingKey,
      segmentId: snapshot.settings.segment,
      queryFilter: snapshot.settings.queryFilter,
      inProgressConversions: snapshot.settings.skipPartialData
        ? "exclude"
        : "include",
      attributionModel: experiment.attributionModel || "firstExposure",
      statsEngine: analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE,
      goals: experiment.goalMetrics.map((m) =>
        getExperimentMetric(experiment, m),
      ),
      secondaryMetrics: experiment.secondaryMetrics.map((m) =>
        getExperimentMetric(experiment, m),
      ),
      guardrails: experiment.guardrailMetrics.map((m) =>
        getExperimentMetric(experiment, m),
      ),
      ...(activationMetric
        ? {
            activationMetric: getExperimentMetric(experiment, activationMetric),
          }
        : null),
    },
    queryIds: snapshot.queries.map((q) => q.query),
    results: (analysis?.results || []).map((s) => {
      return {
        dimension: s.name,
        totalUsers: s.variations.reduce((sum, v) => sum + v.users, 0),
        checks: {
          srm: s.srm,
        },
        metrics: Array.from(metricIds).map((m) => ({
          metricId: m,
          variations: s.variations.map((v, i) => {
            const data = v.metrics[m];
            return {
              variationId: variationIds[i],
              users: v.users,
              analyses: [
                {
                  engine:
                    analysis?.settings?.statsEngine || DEFAULT_STATS_ENGINE,
                  numerator: data?.value || 0,
                  denominator: data?.denominator || data?.users || 0,
                  mean: data?.stats?.mean || 0,
                  stddev: data?.stats?.stddev || 0,
                  percentChange: data?.expected || 0,
                  ciLow: data?.ci?.[0] ?? 0,
                  ciHigh: data?.ci?.[1] ?? 0,
                  pValue: data?.pValue || 0,
                  risk: data?.risk?.[1] || 0,
                  chanceToBeatControl: data?.chanceToWin || 0,
                },
              ],
            };
          }),
        })),
      };
    }),
  };
}

/**
 * While the `postMetricValidator` can detect the presence of values, it cannot figure out the correctness.
 * @param payload
 * @param datasource
 */
export function postMetricApiPayloadIsValid(
  payload: z.infer<typeof postMetricValidator.bodySchema>,
  datasource: Pick<DataSourceInterface, "type">,
): { valid: true } | { valid: false; error: string } {
  const { type, sql, sqlBuilder, mixpanel, behavior } = payload;

  // Validate query format: sql, sqlBuilder, mixpanel
  let queryFormatCount = 0;
  if (sqlBuilder) {
    queryFormatCount++;
  }
  if (sql) {
    queryFormatCount++;
  }
  if (mixpanel) {
    queryFormatCount++;
  }
  if (queryFormatCount !== 1) {
    return {
      valid: false,
      error: "Can only specify one of: sql, sqlBuilder, mixpanel",
    };
  }

  // Validate behavior
  if (behavior) {
    const { riskThresholdDanger, riskThresholdSuccess } = behavior;

    // Enforce that both and riskThresholdSuccess exist, or neither
    const riskDangerExists = typeof riskThresholdDanger !== "undefined";
    const riskSuccessExists = typeof riskThresholdSuccess !== "undefined";
    if (riskDangerExists !== riskSuccessExists)
      return {
        valid: false,
        error:
          "Must provide both riskThresholdDanger and riskThresholdSuccess or neither.",
      };

    // We have both. Make sure they're valid
    if (riskDangerExists && riskSuccessExists) {
      // Enforce riskThresholdDanger must be higher than riskThresholdSuccess
      if (riskThresholdDanger < riskThresholdSuccess)
        return {
          valid: false,
          error: "riskThresholdDanger must be higher than riskThresholdSuccess",
        };
    }

    // Validate conversion window
    const { conversionWindowEnd, conversionWindowStart } = behavior;
    const conversionWindowEndExists =
      typeof conversionWindowEnd !== "undefined";
    const conversionWindowStartExists =
      typeof conversionWindowStart !== "undefined";
    if (conversionWindowEndExists !== conversionWindowStartExists) {
      return {
        valid: false,
        error:
          "Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither",
      };
    }

    if (conversionWindowEndExists && conversionWindowStartExists) {
      // Enforce conversion window end is greater than start
      if (conversionWindowEnd <= conversionWindowStart)
        return {
          valid: false,
          error:
            "`behavior.conversionWindowEnd` must be greater than `behavior.conversionWindowStart`",
        };
    }

    // Min/max percentage change
    const { maxPercentChange, minPercentChange } = behavior;
    const maxPercentExists = typeof maxPercentChange !== "undefined";
    const minPercentExists = typeof minPercentChange !== "undefined";
    // Enforce both max/min percent or neither
    if (maxPercentExists !== minPercentExists)
      return {
        valid: false,
        error:
          "Must specify both `behavior.maxPercentChange` and `behavior.minPercentChange` or neither",
      };

    if (maxPercentExists && minPercentExists) {
      // Enforce max is greater than min
      if (maxPercentChange <= minPercentChange)
        return {
          valid: false,
          error:
            "`behavior.maxPercentChange` must be greater than `behavior.minPercentChange`",
        };
    }

    // Check capping args + capping values
    const { cappingSettings } = behavior;

    const cappingExists =
      typeof cappingSettings !== "undefined" && !!cappingSettings.type;
    const capValueExists = typeof cappingSettings?.value !== "undefined";
    if (cappingExists !== capValueExists) {
      return {
        valid: false,
        error:
          "Must specify both `behavior.cappingSettings.type` (as non-null) and `behavior.cappingSettings.value` or neither.",
      };
    }
    if (
      cappingSettings?.type === "percentile" &&
      (cappingSettings?.value || 0) > 1
    ) {
      return {
        valid: false,
        error:
          "When using percentile capping, `behavior.capValue` must be between 0 and 1.",
      };
    }
  }

  // Validate for payload.sql
  if (sql) {
    // Validate binomial metrics
    if (type === "binomial" && typeof sql.userAggregationSQL !== "undefined")
      return {
        valid: false,
        error: "Binomial metrics cannot have userAggregationSQL",
      };
  }

  // Validate payload.mixpanel
  if (mixpanel) {
    // Validate binomial metrics
    if (type === "binomial" && typeof mixpanel.eventValue !== "undefined")
      return {
        valid: false,
        error: "Binomial metrics cannot have an eventValue",
      };

    if (datasource.type !== "mixpanel")
      return {
        valid: false,
        error: "Mixpanel datasources must provide `mixpanel`",
      };
  }

  // Validate payload.sqlBuilder
  if (sqlBuilder) {
    // Validate binomial metrics
    if (
      type === "binomial" &&
      typeof sqlBuilder.valueColumnName !== "undefined"
    )
      return {
        valid: false,
        error: "Binomial metrics cannot have a valueColumnName",
      };
  }

  return {
    valid: true,
  };
}

export function putMetricApiPayloadIsValid(
  payload: z.infer<typeof putMetricValidator.bodySchema>,
): { valid: true } | { valid: false; error: string } {
  const { type, sql, sqlBuilder, mixpanel, behavior } = payload;

  // Validate query format: sql, sqlBuilder, mixpanel
  let queryFormatCount = 0;
  if (sqlBuilder) {
    queryFormatCount++;
  }
  if (sql) {
    queryFormatCount++;
  }
  if (mixpanel) {
    queryFormatCount++;
  }
  if (queryFormatCount > 1) {
    return {
      valid: false,
      error: "Can only specify one of: sql, sqlBuilder, mixpanel",
    };
  }

  // Validate behavior
  if (behavior) {
    const { riskThresholdDanger, riskThresholdSuccess } = behavior;

    // Enforce that both and riskThresholdSuccess exist, or neither
    const riskDangerExists = typeof riskThresholdDanger !== "undefined";
    const riskSuccessExists = typeof riskThresholdSuccess !== "undefined";
    if (riskDangerExists !== riskSuccessExists)
      return {
        valid: false,
        error:
          "Must provide both riskThresholdDanger and riskThresholdSuccess or neither.",
      };

    // We have both. Make sure they're valid
    if (riskDangerExists && riskSuccessExists) {
      // Enforce riskThresholdDanger must be higher than riskThresholdSuccess
      if (riskThresholdDanger < riskThresholdSuccess)
        return {
          valid: false,
          error: "riskThresholdDanger must be higher than riskThresholdSuccess",
        };
    }

    // Validate conversion window
    const { conversionWindowEnd, conversionWindowStart } = behavior;
    const conversionWindowEndExists =
      typeof conversionWindowEnd !== "undefined";
    const conversionWindowStartExists =
      typeof conversionWindowStart !== "undefined";
    if (conversionWindowEndExists !== conversionWindowStartExists) {
      return {
        valid: false,
        error:
          "Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither",
      };
    }

    if (conversionWindowEndExists && conversionWindowStartExists) {
      // Enforce conversion window end is greater than start
      if (conversionWindowEnd <= conversionWindowStart)
        return {
          valid: false,
          error:
            "`behavior.conversionWindowEnd` must be greater than `behavior.conversionWindowStart`",
        };
    }

    // Min/max percentage change
    const { maxPercentChange, minPercentChange } = behavior;
    const maxPercentExists = typeof maxPercentChange !== "undefined";
    const minPercentExists = typeof minPercentChange !== "undefined";
    // Enforce both max/min percent or neither
    if (maxPercentExists !== minPercentExists)
      return {
        valid: false,
        error:
          "Must specify both `behavior.maxPercentChange` and `behavior.minPercentChange` or neither",
      };

    if (maxPercentExists && minPercentExists) {
      // Enforce max is greater than min
      if (maxPercentChange <= minPercentChange)
        return {
          valid: false,
          error:
            "`behavior.maxPercentChange` must be greater than `behavior.minPercentChange`",
        };
    }

    // Check capping args + capping values
    const { capping, capValue } = behavior;

    const cappingExists = typeof capping !== "undefined" && capping !== null;
    const capValueExists = typeof capValue !== "undefined";
    if (cappingExists !== capValueExists) {
      return {
        valid: false,
        error:
          "Must specify `behavior.capping` (as non-null) and `behavior.capValue` or neither.",
      };
    }
    if (capping === "percentile" && (capValue || 0) > 1) {
      return {
        valid: false,
        error:
          "When using percentile capping, `behavior.capValue` must be between 0 and 1.",
      };
    }
  }

  // Validate for payload.sql
  if (sql) {
    // Validate binomial metrics
    if (type === "binomial" && typeof sql.userAggregationSQL !== "undefined")
      return {
        valid: false,
        error: "Binomial metrics cannot have userAggregationSQL",
      };
  }

  // Validate payload.mixpanel
  if (mixpanel) {
    // Validate binomial metrics
    if (type === "binomial" && typeof mixpanel.eventValue !== "undefined")
      return {
        valid: false,
        error: "Binomial metrics cannot have an eventValue",
      };
  }

  // Validate payload.sqlBuilder
  if (sqlBuilder) {
    // Validate binomial metrics
    if (
      type === "binomial" &&
      typeof sqlBuilder.valueColumnName !== "undefined"
    )
      return {
        valid: false,
        error: "Binomial metrics cannot have a valueColumnName",
      };
  }

  return {
    valid: true,
  };
}

/**
 * Converts the OpenAPI POST /metric payload to a {@link MetricInterface}
 * @param payload
 * @param organization
 * @param datasource
 */
export function postMetricApiPayloadToMetricInterface(
  payload: z.infer<typeof postMetricValidator.bodySchema>,
  organization: OrganizationInterface,
  datasource: Pick<DataSourceInterface, "type">,
): Omit<MetricInterface, "dateCreated" | "dateUpdated" | "id"> {
  const {
    datasourceId,
    name,
    description = "",
    type,
    behavior,
    owner = "",
    sql,
    sqlBuilder,
    mixpanel,
    tags = [],
    projects = [],
    managedBy = "",
  } = payload;

  const metric: Omit<MetricInterface, "dateCreated" | "dateUpdated" | "id"> = {
    datasource: datasourceId,
    description,
    managedBy,
    name,
    organization: organization.id,
    owner,
    tags,
    projects,
    inverse: behavior?.goal === "decrease",
    ignoreNulls: false,
    queries: [],
    runStarted: null,
    cappingSettings: {
      type: DEFAULT_METRIC_CAPPING,
      value: DEFAULT_METRIC_CAPPING_VALUE,
    },
    windowSettings: {
      type: DEFAULT_METRIC_WINDOW,
      delayValue: DEFAULT_METRIC_WINDOW_DELAY_HOURS,
      delayUnit: "hours",
      windowValue: DEFAULT_CONVERSION_WINDOW_HOURS,
      windowUnit: "hours",
    },
    priorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: DEFAULT_PROPER_PRIOR_STDDEV,
    },
    type,
    userIdColumns: (sqlBuilder?.identifierTypeColumns || []).reduce<
      Record<string, string>
    >((acc, { columnName, identifierType }) => {
      acc[columnName] = identifierType;
      return acc;
    }, {}),
  };

  // Assign all undefined behavior fields to the metric
  if (behavior) {
    if (typeof behavior.cappingSettings !== "undefined") {
      metric.cappingSettings = {
        type:
          behavior.cappingSettings.type === "none"
            ? ""
            : (behavior.cappingSettings.type ?? ""),
        value: behavior.cappingSettings.value ?? DEFAULT_METRIC_CAPPING_VALUE,
        ignoreZeros: behavior.cappingSettings.ignoreZeros,
      };
      // handle old post requests
    } else if (typeof behavior.capping !== "undefined") {
      metric.cappingSettings.type = behavior.capping ?? "";
      metric.cappingSettings.value =
        behavior.capValue ?? DEFAULT_METRIC_CAPPING_VALUE;
    } else if (typeof behavior.cap !== "undefined" && behavior.cap) {
      metric.cappingSettings.type = "absolute";
      metric.cappingSettings.value = behavior.cap;
    }

    if (typeof behavior.windowSettings !== "undefined") {
      metric.windowSettings = {
        type:
          behavior.windowSettings.type === "none"
            ? ""
            : (behavior?.windowSettings?.type ?? DEFAULT_METRIC_WINDOW),
        delayUnit: behavior.windowSettings.delayUnit ?? "hours",
        delayValue:
          behavior.windowSettings.delayValue ??
          behavior.windowSettings.delayHours ??
          DEFAULT_METRIC_WINDOW_DELAY_HOURS,
        windowUnit: behavior.windowSettings.windowUnit ?? "hours",
        windowValue:
          behavior.windowSettings.windowValue ??
          DEFAULT_CONVERSION_WINDOW_HOURS,
      };
    } else if (typeof behavior.conversionWindowStart !== "undefined") {
      // The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the Conversion Delay
      metric.windowSettings.delayValue = behavior.conversionWindowStart;
      metric.windowSettings.delayUnit = "hours";

      // The end of a Conversion Window relative to the exposure date, in hours.
      // This is equivalent to the Conversion Delay + Conversion Window Hours settings in the UI. In other words,
      // if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and
      // conversionWindowEnd to 72 (24+48).
      if (typeof behavior.conversionWindowEnd !== "undefined") {
        metric.windowSettings.windowValue =
          behavior.conversionWindowEnd - behavior.conversionWindowStart;
      }
    }

    if (typeof behavior.maxPercentChange !== "undefined") {
      metric.maxPercentChange = behavior.maxPercentChange;
    }

    if (typeof behavior.minPercentChange !== "undefined") {
      metric.minPercentChange = behavior.minPercentChange;
    }

    if (typeof behavior.minSampleSize !== "undefined") {
      metric.minSampleSize = behavior.minSampleSize;
    }

    if (typeof behavior.riskThresholdDanger !== "undefined") {
      metric.loseRisk = behavior.riskThresholdDanger;
    }

    if (typeof behavior.riskThresholdSuccess !== "undefined") {
      metric.winRisk = behavior.riskThresholdSuccess;
    }
  }

  let queryFormat: undefined | "builder" | "sql" = undefined;
  if (sqlBuilder) {
    queryFormat = "builder";
  } else if (sql) {
    queryFormat = "sql";
  }
  metric.queryFormat = queryFormat;

  // Conditions
  metric.conditions =
    datasource.type == "mixpanel"
      ? (mixpanel?.conditions || []).map(({ operator, property, value }) => ({
          column: property,
          operator: operator as Operator,
          value: value,
        }))
      : ((sqlBuilder?.conditions || []) as Condition[]);

  if (sqlBuilder) {
    // conditions are handled above in the Conditions section
    metric.table = sqlBuilder.tableName;
    metric.timestampColumn = sqlBuilder.timestampColumnName;
    metric.column = sqlBuilder.valueColumnName;
  }

  if (sql) {
    metric.aggregation = sql.userAggregationSQL;
    metric.denominator = sql.denominatorMetricId;
    metric.userIdTypes = sql.identifierTypes;
    metric.sql = sql.conversionSQL;
  }

  if (mixpanel) {
    metric.aggregation = mixpanel.userAggregation;
    metric.table = mixpanel.eventName;
    metric.column = mixpanel.eventValue;
  }

  return metric;
}

/**
 * Converts the OpenAPI PUT /metric payload to a {@link MetricInterface}
 * @param payload
 * @param organization
 * @param datasource
 */
export function putMetricApiPayloadToMetricInterface(
  payload: z.infer<typeof putMetricValidator.bodySchema>,
): Partial<MetricInterface> {
  const {
    behavior,
    sql,
    sqlBuilder,
    mixpanel,
    description,
    name,
    owner,
    tags,
    projects,
    type,
    managedBy,
    archived,
  } = payload;

  const metric: Partial<MetricInterface> = {
    ...(typeof description !== "undefined" ? { description } : {}),
    ...(typeof name !== "undefined" ? { name } : {}),
    ...(typeof owner !== "undefined" ? { owner } : {}),
    ...(typeof tags !== "undefined" ? { tags } : {}),
    ...(typeof projects !== "undefined" ? { projects } : {}),
    ...(typeof type !== "undefined" ? { type } : {}),
    ...(typeof archived !== "undefined"
      ? { status: archived ? "archived" : "active" }
      : {}),
  };

  // Assign all undefined behavior fields to the metric
  if (behavior) {
    if (typeof behavior.goal !== "undefined") {
      metric.inverse = behavior.goal === "decrease";
    }

    if (typeof behavior.cappingSettings !== "undefined") {
      metric.cappingSettings = {
        ...behavior.cappingSettings,
        type:
          behavior.cappingSettings.type === "none"
            ? ""
            : (behavior.cappingSettings.type ?? ""),
        value: behavior.cappingSettings.value ?? DEFAULT_METRIC_CAPPING_VALUE,
        ignoreZeros: behavior.cappingSettings.ignoreZeros,
      };
    } else if (typeof behavior.capping !== "undefined") {
      metric.cappingSettings = {
        type: behavior.capping ?? DEFAULT_METRIC_CAPPING,
        value: behavior.capValue ?? DEFAULT_METRIC_CAPPING_VALUE,
      };
    }

    if (typeof behavior.windowSettings !== "undefined") {
      metric.windowSettings = {
        type:
          behavior.windowSettings?.type == "none"
            ? ""
            : (behavior.windowSettings?.type ?? DEFAULT_METRIC_WINDOW),
        delayValue:
          behavior.windowSettings?.delayValue ??
          behavior.windowSettings?.delayHours ??
          DEFAULT_METRIC_WINDOW_DELAY_HOURS,
        delayUnit: behavior.windowSettings?.delayUnit ?? "hours",
        windowValue:
          behavior.windowSettings?.windowValue ??
          DEFAULT_CONVERSION_WINDOW_HOURS,
        windowUnit: behavior.windowSettings?.windowUnit ?? "hours",
      };
    } else if (typeof behavior.conversionWindowStart !== "undefined") {
      // The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the Conversion Delay
      metric.windowSettings = {
        type: DEFAULT_METRIC_WINDOW,
        delayValue: behavior.conversionWindowStart,
        delayUnit: "hours",
        windowValue: DEFAULT_CONVERSION_WINDOW_HOURS,
        windowUnit: "hours",
      };

      // The end of a Conversion Window relative to the exposure date, in hours.
      // This is equivalent to the Conversion Delay + Conversion Window Hours settings in the UI. In other words,
      // if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and
      // conversionWindowEnd to 72 (24+48).
      if (typeof behavior.conversionWindowEnd !== "undefined") {
        metric.windowSettings.windowValue =
          behavior.conversionWindowEnd - behavior.conversionWindowStart;
      }
    }

    if (typeof behavior.maxPercentChange !== "undefined") {
      metric.maxPercentChange = behavior.maxPercentChange;
    }

    if (typeof behavior.minPercentChange !== "undefined") {
      metric.minPercentChange = behavior.minPercentChange;
    }

    if (typeof behavior.minSampleSize !== "undefined") {
      metric.minSampleSize = behavior.minSampleSize;
    }

    if (typeof behavior.riskThresholdDanger !== "undefined") {
      metric.loseRisk = behavior.riskThresholdDanger;
    }

    if (typeof behavior.riskThresholdSuccess !== "undefined") {
      metric.winRisk = behavior.riskThresholdSuccess;
    }
  }

  if (sqlBuilder) {
    metric.queryFormat = "builder";
  } else if (sql) {
    metric.queryFormat = "sql";
  }

  // Conditions
  if (mixpanel?.conditions) {
    metric.conditions = mixpanel.conditions.map(
      ({ operator, property, value }) => ({
        column: property,
        operator: operator as Operator,
        value: value,
      }),
    );
  } else if (sqlBuilder?.conditions) {
    metric.conditions = sqlBuilder.conditions as Condition[];
  }

  if (sqlBuilder) {
    if (typeof sqlBuilder.tableName !== "undefined") {
      metric.table = sqlBuilder.tableName;
    }
    if (typeof sqlBuilder.timestampColumnName !== "undefined") {
      metric.timestampColumn = sqlBuilder.timestampColumnName;
    }
    if (typeof sqlBuilder.valueColumnName !== "undefined") {
      metric.column = sqlBuilder.valueColumnName;
    }
    if (typeof sqlBuilder.identifierTypeColumns !== "undefined") {
      metric.userIdColumns = (sqlBuilder?.identifierTypeColumns || []).reduce<
        Record<string, string>
      >((acc, { columnName, identifierType }) => {
        acc[columnName] = identifierType;
        return acc;
      }, {});
    }
  }

  if (sql) {
    if (typeof sql.userAggregationSQL !== "undefined") {
      metric.aggregation = sql.userAggregationSQL;
    }
    if (typeof sql.denominatorMetricId !== "undefined") {
      metric.denominator = sql.denominatorMetricId;
    }
    if (typeof sql.identifierTypes !== "undefined") {
      metric.userIdTypes = sql.identifierTypes;
    }
    if (typeof sql.conversionSQL !== "undefined") {
      metric.sql = sql.conversionSQL;
    }
  }

  if (mixpanel) {
    if (typeof mixpanel.userAggregation !== "undefined") {
      metric.aggregation = mixpanel.userAggregation;
    }
    if (typeof mixpanel.eventName !== "undefined") {
      metric.table = mixpanel.eventName;
    }
    if (typeof mixpanel.eventValue !== "undefined") {
      metric.column = mixpanel.eventValue;
    }
  }

  if (managedBy !== undefined) {
    metric.managedBy = managedBy;
  }

  return metric;
}

export function toMetricApiInterface(
  organization: OrganizationInterface,
  metric: MetricInterface,
  datasource: DataSourceInterface | null,
): ApiMetric {
  const metricDefaults = organization.settings?.metricDefaults;

  const obj: ApiMetric = {
    id: metric.id,
    managedBy: metric.managedBy || "",
    name: metric.name,
    description: metric.description || "",
    dateCreated: metric.dateCreated?.toISOString() || "",
    dateUpdated: metric.dateUpdated?.toISOString() || "",
    archived: metric.status === "archived",
    datasourceId: datasource?.id || "",
    owner: metric.owner || "",
    projects: metric.projects || [],
    tags: metric.tags || [],
    type: metric.type,
    behavior: {
      goal: metric.inverse ? "decrease" : "increase",
      cappingSettings: metric.cappingSettings
        ? {
            ...metric.cappingSettings,
            type: metric.cappingSettings.type || "none",
          }
        : {
            type: DEFAULT_METRIC_CAPPING || "none",
            value: DEFAULT_METRIC_CAPPING_VALUE,
          },
      minPercentChange:
        metric.minPercentChange ?? metricDefaults?.minPercentageChange ?? 0.005,
      maxPercentChange:
        metric.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0.5,
      minSampleSize:
        metric.minSampleSize ?? metricDefaults?.minimumSampleSize ?? 150,
      targetMDE: metric.targetMDE ?? metricDefaults?.targetMDE ?? 0.1,
      riskThresholdDanger: metric.loseRisk ?? 0.0125,
      riskThresholdSuccess: metric.winRisk ?? 0.0025,
      windowSettings: metric.windowSettings
        ? {
            ...metric.windowSettings,
            type: metric.windowSettings.type || "none",
          }
        : metricDefaults?.windowSettings
          ? {
              ...metricDefaults.windowSettings,
              type: metricDefaults.windowSettings.type || "none",
            }
          : {
              type: DEFAULT_METRIC_WINDOW || "none",
              delayValue: metric.earlyStart
                ? -0.5
                : DEFAULT_METRIC_WINDOW_DELAY_HOURS,
              delayUnit: "hours",
              windowValue: DEFAULT_CONVERSION_WINDOW_HOURS,
              windowUnit: "hours",
            },
    },
  };

  if (datasource) {
    if (datasource.type === "mixpanel") {
      obj.mixpanel = {
        eventName: metric.table || "",
        eventValue: metric.column || "",
        userAggregation: metric.aggregation || "sum(values)",
        conditions: (metric.conditions || []).map((c) => ({
          property: c.column,
          operator: c.operator,
          value: c.value,
        })),
      };
    } else if (datasource.type !== "google_analytics") {
      const identifierTypes = metric.userIdTypes ?? ["user_id"];
      obj.sql = {
        identifierTypes,
        // TODO: if builder mode is selected, use that to generate the SQL here
        conversionSQL: metric.sql || "",
        userAggregationSQL: metric.aggregation || "SUM(value)",
        denominatorMetricId: metric.denominator || "",
      };

      if (metric.queryFormat === "builder") {
        obj.sqlBuilder = {
          identifierTypeColumns: identifierTypes.map((t) => ({
            identifierType: t,
            columnName: metric.userIdColumns?.[t] || t,
          })),
          tableName: metric.table || "",
          valueColumnName: metric.column || "",
          timestampColumnName: metric.timestampColumn || "timestamp",
          conditions: metric.conditions || [],
        };
      }
    }
  }

  return obj;
}

export const toNamespaceRange = (
  raw: number[] | undefined,
): [number, number] => [raw?.[0] ?? 0, raw?.[1] ?? 1];
/**
 * Converts the OpenAPI POST /experiment payload to a {@link ExperimentInterface}
 * @param payload
 * @param organization
 * @param datasource
 * @param userId
 */
export function postExperimentApiPayloadToInterface(
  payload: z.infer<typeof postExperimentValidator.bodySchema>,
  organization: OrganizationInterface,
  datasource: DataSourceInterface | null,
): Omit<ExperimentInterface, "dateCreated" | "dateUpdated" | "id"> {
  const phases: ExperimentPhase[] = payload.phases?.map((p) => {
    const conditionRes = validateCondition(p.condition);
    if (!conditionRes.success) {
      throw new Error(`Invalid targeting condition: ${conditionRes.error}`);
    }
    p.prerequisites?.forEach((prerequisite) => {
      const conditionRes = validateCondition(prerequisite.condition);
      if (!conditionRes.success) {
        throw new Error(
          `Invalid prerequisite condition: ${conditionRes.error}`,
        );
      }
    });

    return {
      ...p,
      dateStarted: new Date(p.dateStarted),
      dateEnded: p.dateEnded ? new Date(p.dateEnded) : undefined,
      reason: p.reason || "",
      coverage: p.coverage != null ? p.coverage : 1,
      condition: p.condition || "{}",
      prerequisites: p.prerequisites || [],
      savedGroups: (p.savedGroupTargeting || []).map((s) => ({
        match: s.matchType,
        ids: s.savedGroups,
      })),
      namespace: {
        name: p.namespace?.namespaceId || "",
        range: toNamespaceRange(p.namespace?.range),
        enabled: p.namespace?.enabled != null ? p.namespace.enabled : false,
      },
      variationWeights:
        p.variationWeights ||
        payload.variations.map(() => 1 / payload.variations.length),
    };
  }) || [
    {
      coverage: 1,
      dateStarted: new Date(),
      name: "Main",
      reason: "",
      variationWeights: payload.variations.map(
        () => 1 / payload.variations.length,
      ),
      condition: "",
      savedGroups: [],
      namespace: {
        enabled: false,
        name: "",
        range: [0, 1],
      },
    },
  ];

  const obj: Omit<ExperimentInterface, "dateCreated" | "dateUpdated" | "id"> = {
    organization: organization.id,
    datasource: datasource?.id ?? "",
    archived: payload.archived ?? false,
    hashAttribute: payload.hashAttribute ?? "",
    fallbackAttribute: payload.fallbackAttribute || "",
    hashVersion: payload.hashVersion ?? 2,
    disableStickyBucketing: payload.disableStickyBucketing ?? false,
    ...(payload.bucketVersion !== undefined
      ? { bucketVersion: payload.bucketVersion }
      : {}),
    ...(payload.minBucketVersion !== undefined
      ? { minBucketVersion: payload.minBucketVersion }
      : {}),
    autoSnapshots: true,
    project: payload.project,
    owner: payload.owner || "",
    trackingKey: payload.trackingKey || "",
    exposureQueryId:
      payload.assignmentQueryId ||
      datasource?.settings.queries?.exposure?.[0]?.id ||
      "",
    name: payload.name || "",
    type: payload.type || "standard",
    phases,
    tags: payload.tags || [],
    description: payload.description || "",
    hypothesis: payload.hypothesis || "",
    goalMetrics: payload.metrics || [],
    secondaryMetrics: payload.secondaryMetrics || [],
    guardrailMetrics: payload.guardrailMetrics || [],
    activationMetric: payload.activationMetric || "",
    metricOverrides: [],
    decisionFrameworkSettings: {},
    segment: payload.segmentId || "",
    queryFilter: payload.queryFilter || "",
    skipPartialData: payload.inProgressConversions === "strict",
    attributionModel: payload.attributionModel || "firstExposure",
    ...(payload.statsEngine ? { statsEngine: payload.statsEngine } : {}),
    variations:
      payload.variations.map((v) => ({
        ...v,
        id: generateVariationId(),
        screenshots: v.screenshots || [],
      })) || [],
    // Legacy field, no longer used when creating experiments
    implementation: "code",
    status: payload.status || "draft",
    analysis: "",
    releasedVariationId: payload.releasedVariationId || "",
    excludeFromPayload: !!payload.excludeFromPayload,
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    ideaSource: "",
    sequentialTestingEnabled:
      payload.sequentialTestingEnabled ??
      !!organization?.settings?.sequentialTestingEnabled,
    sequentialTestingTuningParameter:
      payload.sequentialTestingTuningParameter ??
      organization?.settings?.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    regressionAdjustmentEnabled:
      payload.regressionAdjustmentEnabled ??
      !!organization?.settings?.regressionAdjustmentEnabled,
    shareLevel: payload.shareLevel,
    pinnedMetricSlices: payload.pinnedMetricSlices || [],
    customMetricSlices: payload.customMetricSlices || [],
    customFields: payload.customFields,
  };

  const { settings } = getScopedSettings({
    organization,
  });

  if (payload.type === "multi-armed-bandit") {
    Object.assign(
      obj,
      resetExperimentBanditSettings({
        experiment: obj as unknown as ExperimentInterface,
        settings,
      }),
    );
  }

  return obj;
}

/**
 * Converts the OpenAPI POST /experiment/:id payload to a {@link ExperimentInterface}
 * @param payload
 * @param organization
 * @param datasource
 * @param userId
 */
export function updateExperimentApiPayloadToInterface(
  payload: z.infer<typeof updateExperimentValidator.bodySchema>,
  experiment: ExperimentInterface,
  metricMap: Map<string, ExperimentMetricInterface>,
  organization: OrganizationInterface,
): Partial<ExperimentInterface> {
  const {
    trackingKey,
    project,
    owner,
    datasourceId,
    assignmentQueryId,
    hashAttribute,
    hashVersion,
    disableStickyBucketing,
    bucketVersion,
    minBucketVersion,
    name,
    type,
    tags,
    description,
    hypothesis,
    metrics,
    guardrailMetrics,
    activationMetric,
    segmentId,
    queryFilter,
    archived,
    status,
    phases,
    variations,
    releasedVariationId,
    excludeFromPayload,
    inProgressConversions,
    attributionModel,
    statsEngine,
    regressionAdjustmentEnabled,
    sequentialTestingEnabled,
    sequentialTestingTuningParameter,
    secondaryMetrics,
    shareLevel,
    pinnedMetricSlices,
    customMetricSlices,
    customFields,
  } = payload;
  let changes: ExperimentInterface = {
    ...(trackingKey ? { trackingKey } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(datasourceId ? { datasource: datasourceId } : {}),
    ...(assignmentQueryId ? { assignmentQueryId } : {}),
    ...(hashAttribute ? { hashAttribute } : {}),
    ...(hashVersion ? { hashVersion } : {}),
    ...(disableStickyBucketing !== undefined ? { disableStickyBucketing } : {}),
    ...(bucketVersion !== undefined ? { bucketVersion } : {}),
    ...(minBucketVersion !== undefined ? { minBucketVersion } : {}),
    ...(name ? { name } : {}),
    ...(type ? { type } : {}),
    ...(tags ? { tags } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(hypothesis !== undefined ? { hypothesis } : {}),
    ...(metrics ? { goalMetrics: metrics } : {}),
    ...(guardrailMetrics ? { guardrailMetrics } : {}),
    ...(secondaryMetrics ? { secondaryMetrics } : {}),
    ...(activationMetric ? { activationMetric } : {}),
    ...(segmentId ? { segment: segmentId } : {}),
    ...(queryFilter !== undefined ? { queryFilter } : {}),
    ...(archived !== undefined ? { archived } : {}),
    ...(status ? { status } : {}),
    ...(releasedVariationId !== undefined ? { releasedVariationId } : {}),
    ...(excludeFromPayload !== undefined ? { excludeFromPayload } : {}),
    ...(inProgressConversions !== undefined
      ? { skipPartialData: inProgressConversions === "strict" }
      : {}),
    ...(attributionModel !== undefined ? { attributionModel } : {}),
    ...(statsEngine !== undefined ? { statsEngine } : {}),
    ...(regressionAdjustmentEnabled !== undefined
      ? { regressionAdjustmentEnabled }
      : {}),
    ...(sequentialTestingEnabled !== undefined
      ? { sequentialTestingEnabled }
      : {}),
    ...(sequentialTestingTuningParameter !== undefined
      ? { sequentialTestingTuningParameter }
      : {}),
    ...(variations
      ? {
          variations: variations?.map((v) => ({
            id: generateVariationId(),
            screenshots: [],
            ...v,
          })),
        }
      : {}),
    ...(phases
      ? {
          phases: phases.map((p) => {
            const conditionRes = validateCondition(p.condition);
            if (!conditionRes.success) {
              throw new Error(
                `Invalid targeting condition: ${conditionRes.error}`,
              );
            }
            p.prerequisites?.forEach((prerequisite) => {
              const conditionRes = validateCondition(prerequisite.condition);
              if (!conditionRes.success) {
                throw new Error(
                  `Invalid prerequisite condition: ${conditionRes.error}`,
                );
              }
            });

            return {
              ...p,
              dateStarted: new Date(p.dateStarted),
              dateEnded: p.dateEnded ? new Date(p.dateEnded) : undefined,
              reason: p.reason || "",
              coverage: p.coverage != null ? p.coverage : 1,
              condition: p.condition || "{}",
              prerequisites: p.prerequisites || [],
              savedGroups: (p.savedGroupTargeting || []).map((s) => ({
                match: s.matchType,
                ids: s.savedGroups,
              })),
              namespace: {
                name: p.namespace?.namespaceId || "",
                range: toNamespaceRange(p.namespace?.range),
                enabled:
                  p.namespace?.enabled != null ? p.namespace.enabled : false,
              },
              variationWeights:
                p.variationWeights ||
                (payload.variations || experiment.variations)?.map(
                  (_v, _i, arr) => 1 / arr.length,
                ),
            };
          }),
        }
      : {}),
    ...(shareLevel !== undefined ? { shareLevel } : {}),
    ...(pinnedMetricSlices !== undefined ? { pinnedMetricSlices } : {}),
    ...(customMetricSlices !== undefined ? { customMetricSlices } : {}),
    ...(customFields !== undefined ? { customFields } : {}),
    dateUpdated: new Date(),
  } as ExperimentInterface;

  const { settings } = getScopedSettings({
    organization,
  });

  // Clean up some vars for bandits, but only if safe to do so...
  // If it's a draft, hasn't been run as a bandit before, and is/will be a MAB:
  if (
    experiment.status === "draft" &&
    experiment.banditStage === undefined &&
    ((changes.type === undefined && experiment.type === "multi-armed-bandit") ||
      changes.type === "multi-armed-bandit")
  ) {
    changes = resetExperimentBanditSettings({
      experiment,
      metricMap,
      changes,
      settings,
    }) as ExperimentInterface;
  }
  // If it's already a bandit and..
  if (experiment.type === "multi-armed-bandit") {
    // ...the schedule has changed, recompute next run
    if (
      changes.banditScheduleUnit !== undefined ||
      changes.banditScheduleValue !== undefined ||
      changes.banditBurnInUnit !== undefined ||
      changes.banditBurnInValue !== undefined
    ) {
      changes.nextSnapshotAttempt = determineNextBanditSchedule({
        ...experiment,
        ...changes,
      } as ExperimentInterface);
    }
  }

  return changes;
}

export async function getSettingsForSnapshotMetrics(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<{
  regressionAdjustmentEnabled: boolean;
  settingsForSnapshotMetrics: MetricSnapshotSettings[];
}> {
  let regressionAdjustmentEnabled = false;
  const settingsForSnapshotMetrics: MetricSnapshotSettings[] = [];
  const metricMap = await getMetricMap(context);

  const metricGroups = await context.models.metricGroups.getAll();
  const allExperimentMetricIds = getAllMetricIdsFromExperiment(
    experiment,
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
        experiment.regressionAdjustmentEnabled ??
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      organizationSettings: context.org.settings,
      metricOverrides: experiment.metricOverrides,
    });
    if (metricSnapshotSettings.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = true;
    }
    settingsForSnapshotMetrics.push(metricSnapshotSettings);
  }
  if (!experiment.regressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = false;
  }
  return { regressionAdjustmentEnabled, settingsForSnapshotMetrics };
}

export function visualChangesetsHaveChanges({
  oldVisualChangeset,
  newVisualChangeset,
}: {
  oldVisualChangeset: VisualChangesetInterface;
  newVisualChangeset: VisualChangesetInterface;
}): boolean {
  // If there are visual change differences
  const oldVisualChanges = oldVisualChangeset.visualChanges.map(
    ({ css, js, domMutations }) => ({ css, js, domMutations }),
  );
  const newVisualChanges = newVisualChangeset.visualChanges.map(
    ({ css, js, domMutations }) => ({ css, js, domMutations }),
  );
  if (!isEqual(oldVisualChanges, newVisualChanges)) {
    return true;
  }

  // If there are URL targeting differences
  if (
    !isEqual(oldVisualChangeset.urlPatterns, newVisualChangeset.urlPatterns)
  ) {
    return true;
  }

  // Otherwise, there are no meaningful changes
  return false;
}

export async function getLinkedFeatureInfo(
  context: ReqContext,
  experiment: ExperimentInterface,
) {
  const linkedFeatures = experiment.linkedFeatures || [];
  if (!linkedFeatures.length) return [];

  const features = await getFeaturesByIds(context, linkedFeatures);

  const revisionsByFeatureId = await getFeatureRevisionsByFeatureIds(
    context,
    context.org.id,
    linkedFeatures,
  );

  const environments = getEnvironmentIdsFromOrg(context.org);

  const filter = (rule: FeatureRule) =>
    rule.type === "experiment-ref" && rule.experimentId === experiment.id;

  const linkedFeatureInfo = features.map((feature) => {
    const revisions = revisionsByFeatureId[feature.id] || [];

    // Get all published revisions from most recent to oldest
    const liveMatches = getMatchingRules(feature, filter, environments);

    const draftMatches =
      revisions
        .filter((r) => DRAFT_REVISION_STATUSES.includes(r.status))
        .map((r) => getMatchingRules(feature, filter, environments, r))
        .filter((matches) => matches.length > 0)[0] || [];

    const lockedMatches =
      revisions
        .filter(
          (r) => r.status === "published" && r.version !== feature.version,
        )
        .sort((a, b) => b.version - a.version)
        .map((r) => getMatchingRules(feature, filter, environments, r))
        .filter((matches) => matches.length > 0)[0] || [];

    let state: LinkedFeatureState = "discarded";
    let matches: MatchingRule[] = [];
    if (liveMatches.length > 0) {
      state = "live";
      matches = liveMatches;
    } else if (draftMatches.length > 0) {
      state = "draft";
      matches = draftMatches;
    } else if (lockedMatches.length > 0) {
      state = "locked";
      matches = lockedMatches;
    }

    const uniqueValues: Set<string> = new Set(
      matches.map((m) =>
        JSON.stringify(
          (m.rule as ExperimentRefRule).variations.sort((a, b) =>
            b.variationId.localeCompare(a.variationId),
          ),
        ),
      ),
    );

    const environmentStates: Record<string, LinkedFeatureEnvState> = {};
    environments.forEach((env) => (environmentStates[env] = "missing"));
    matches.forEach((match) => {
      if (!match.environmentEnabled) {
        environmentStates[match.environmentId] = "disabled-env";
      } else if (
        match.rule.enabled === false &&
        environmentStates[match.environmentId] !== "active"
      ) {
        environmentStates[match.environmentId] = "disabled-rule";
      } else if (match.rule.enabled !== false) {
        environmentStates[match.environmentId] = "active";
      }
    });

    const info: LinkedFeatureInfo = {
      feature,
      state,
      environmentStates,
      values: (matches[0]?.rule as ExperimentRefRule)?.variations || [],
      valuesFrom: matches[0]?.environmentId || "",
      rulesAbove: matches.some((m) => m.i > 0),
      inconsistentValues: uniqueValues.size > 1,
    };

    return info;
  });

  return linkedFeatureInfo;
}

export async function getChangesToStartExperiment(
  context: ReqContext,
  experiment: ExperimentInterface,
) {
  const phases = [...experiment.phases];
  const lastIndex = phases.length - 1;

  const changes: Changeset = {};

  // If the experiment doesn't have any results yet, reset the phase start date to now
  if (!experiment.analysisSummary?.snapshotId) {
    phases[lastIndex] = {
      ...phases[lastIndex],
      dateStarted: new Date(),
    };
    changes.phases = phases;
  }

  // Bandit-specific changes
  if (experiment.type === "multi-armed-bandit") {
    const { settings } = getScopedSettings({
      organization: context.org,
      experiment,
    });

    // Multiple events (not just the seed 0th event) means this bandit phase was already running somehow.
    // If multiple events, don't flush.
    const preserveExistingBanditEvents =
      (phases[lastIndex]?.banditEvents?.length ?? 0) > 1;
    Object.assign(
      changes,
      resetExperimentBanditSettings({
        experiment,
        changes,
        settings,
        preserveExistingBanditEvents,
      }),
    );

    // validate datasources
    let datasource: DataSourceInterface | null = null;
    if (!experiment.datasource) {
      throw new Error("Missing datasource");
    }
    datasource = await getDataSourceById(context, experiment.datasource);
    if (!datasource) {
      throw new Error("Invalid datasource: " + experiment.datasource);
    }

    // validate goal metric
    if (!experiment?.goalMetrics?.[0]) {
      throw new Error("Missing goal metric");
    }

    const metric = await getExperimentMetricById(
      context,
      experiment.goalMetrics[0],
    );
    if (!metric) {
      throw new Error("Invalid metric: " + experiment.goalMetrics[0]);
    }
    if (metric.cappingSettings.type === "percentile") {
      throw new Error("Goal metric must not use percentile capping");
    }
  }

  changes.status = "running";

  return changes;
}

export async function getExperimentAnalysisSummary({
  context,
  experiment,
  experimentSnapshot,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
}): Promise<ExperimentAnalysisSummary> {
  const analysisSummary: ExperimentAnalysisSummary = {
    snapshotId: experimentSnapshot.id,
    precomputedDimensions: experimentSnapshot.settings.dimensions.map(
      (d) => d.id,
    ),
  };

  const overallTraffic = experimentSnapshot.health?.traffic?.overall;
  const snapshotHealthPower = experimentSnapshot.health?.power;

  const standardSnapshot =
    experimentSnapshot.type === "standard" &&
    experimentSnapshot.analyses?.[0]?.results?.length === 1;
  const totalUsers =
    (overallTraffic?.variationUnits.length
      ? overallTraffic.variationUnits.reduce((acc, a) => acc + a, 0)
      : standardSnapshot
        ? // fall back to first result for standard snapshots if overall traffic
          // is missing
          experimentSnapshot?.analyses?.[0]?.results?.[0]?.variations?.reduce(
            (acc, a) => acc + a.users,
            0,
          )
        : null) ?? null;

  const srm = getSRMValue(experiment.type ?? "standard", experimentSnapshot);

  if (srm !== undefined) {
    analysisSummary.health = {
      srm,
      multipleExposures: experimentSnapshot.multipleExposures,
      totalUsers,
    };

    if (snapshotHealthPower?.type === "error") {
      const errorMessage = snapshotHealthPower.metricVariationPowerResults.find(
        (r) => r.errorMessage !== undefined,
      )?.errorMessage;

      analysisSummary.health.power = {
        type: "error",
        errorMessage:
          errorMessage ?? "An error occurred while calculating power",
      };
    } else if (snapshotHealthPower?.type === "success") {
      analysisSummary.health.power = {
        type: "success",
        isLowPowered: snapshotHealthPower.isLowPowered,
        additionalDaysNeeded: snapshotHealthPower.additionalDaysNeeded,
      };
    }
  }

  const relativeAnalysis = experimentSnapshot.analyses.find(
    (v) => v.settings.differenceType === "relative",
  );

  // by default, we compute experiment results status on relative analysis
  if (relativeAnalysis) {
    const overallResults = relativeAnalysis.results?.[0];
    // redundant check for dimension
    if (overallResults && overallResults.name === "") {
      const resultsStatus = await computeResultsStatus({
        context,
        analysis: relativeAnalysis,
        experiment,
      });

      if (resultsStatus) {
        analysisSummary.resultsStatus = resultsStatus;
      }
    }
  }

  return analysisSummary;
}

export async function updateExperimentAnalysisSummary({
  context,
  experiment,
  experimentSnapshot,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  experimentSnapshot: ExperimentSnapshotInterface;
}): Promise<ExperimentInterface> {
  const analysisSummary = await getExperimentAnalysisSummary({
    context,
    experiment,
    experimentSnapshot,
  });

  return updateExperiment({
    context,
    experiment,
    changes: {
      analysisSummary,
    },
  });
}

function getVariationId(
  experiment: ExperimentInterface | SafeRolloutInterface,
  i: number,
): string {
  if ("variations" in experiment) {
    return experiment.variations?.[i]?.id;
  }
  return i + "";
}

export async function computeResultsStatus({
  context,
  analysis,
  experiment,
}: {
  context: ReqContext;
  analysis: ExperimentSnapshotAnalysis | SafeRolloutSnapshotAnalysis;
  experiment: ExperimentInterface | SafeRolloutInterface;
}): Promise<ExperimentAnalysisSummaryResultsStatus | undefined> {
  const statsEngine = analysis.settings.statsEngine;
  const pValueCorrection = getPValueCorrectionForOrg(context);
  const { ciUpper, ciLower } = getConfidenceLevelsForOrg(context);
  const metricDefaults = getMetricDefaultsForOrg(context);
  const pValueThreshold = getPValueThresholdForOrg(context);
  const metricMap = await getMetricMap(context);
  const metricGroups = await context.models.metricGroups.getAll();

  const expandedGoalMetrics =
    "goalMetrics" in experiment
      ? expandMetricGroups(experiment.goalMetrics, metricGroups)
      : [];
  const expandedGuardrailMetrics =
    "guardrailMetrics" in experiment
      ? expandMetricGroups(experiment.guardrailMetrics, metricGroups)
      : expandMetricGroups(experiment.guardrailMetricIds, metricGroups);

  const results = cloneDeep(analysis.results);

  // modifies results in place
  setAdjustedPValuesOnResults(results, expandedGoalMetrics, pValueCorrection);
  setAdjustedCIs(results, pValueThreshold);

  const variations = results[0]?.variations;
  if (!variations || !variations.length) {
    return;
  }

  const variationStatuses: ExperimentAnalysisSummaryVariationStatus[] = [];
  const baselineVariation = variations[0];

  for (let i = 1; i < variations.length; i++) {
    // try to get id from experiment object
    const variationId = getVariationId(experiment, i);
    const currentVariation = variations[i];
    const variationStatus: ExperimentAnalysisSummaryVariationStatus = {
      variationId,
      goalMetrics: {},
      guardrailMetrics: {},
    };
    for (const m in currentVariation.metrics) {
      const goalMetric = expandedGoalMetrics.includes(m);
      const guardrailMetric = expandedGuardrailMetrics.includes(m);
      if (goalMetric || guardrailMetric) {
        const baselineMetric = baselineVariation.metrics?.[m];
        const currentMetric = currentVariation.metrics?.[m];
        if (!currentMetric || !baselineMetric) continue;
        const metric = metricMap.get(m);
        if (!metric) continue;
        const resultsStatus = getMetricResultStatus({
          metric,
          metricDefaults,
          baseline: baselineMetric,
          stats: currentMetric,
          ciLower,
          ciUpper,
          pValueThreshold,
          statsEngine: statsEngine,
          differenceType:
            "differenceType" in analysis.settings
              ? analysis.settings.differenceType
              : "relative",
        });

        if (goalMetric) {
          const metricStatus: GoalMetricResult = {
            status: "neutral",
            superStatSigStatus: "neutral",
          };
          if (resultsStatus.resultsStatus === "won") {
            metricStatus.status = "won";
          } else if (resultsStatus.resultsStatus === "lost") {
            metricStatus.status = "lost";
          }

          if (resultsStatus.clearSignalResultsStatus === "won") {
            metricStatus.superStatSigStatus = "won";
          } else if (resultsStatus.resultsStatus === "lost") {
            metricStatus.superStatSigStatus = "lost";
          }
          if (!variationStatus.goalMetrics) {
            variationStatus.goalMetrics = {};
          }
          variationStatus.goalMetrics[metric.id] = metricStatus;
        }

        if (guardrailMetric) {
          if (!variationStatus.guardrailMetrics) {
            variationStatus.guardrailMetrics = {};
          }
          if (resultsStatus.guardrailSafeStatus) {
            variationStatus.guardrailMetrics[metric.id] = {
              status: "safe",
            };
          } else {
            variationStatus.guardrailMetrics[metric.id] = {
              status:
                resultsStatus.resultsStatus === "lost" ? "lost" : "neutral",
            };
          }
        }
      }
    }
    variationStatuses.push(variationStatus);
  }

  return {
    variations: variationStatuses,
    settings: {
      sequentialTesting: analysis.settings.sequentialTesting ?? false,
    },
  };
}

export async function validateExperimentData(
  context: ReqContext,
  data: Partial<ExperimentInterfaceStringDates>,
): Promise<{ metricIds: string[]; datasource: DataSourceInterface | null }> {
  let datasource: DataSourceInterface | null = null;
  if (data.datasource) {
    datasource = await getDataSourceById(context, data.datasource);
    if (!datasource) {
      throw new Error("Invalid datasource: " + data.datasource);
    }
  }

  // Validate that specified metrics exist and belong to the organization
  const allMetricGroups = await context.models.metricGroups.getAll();
  const metricIds = getAllMetricIdsFromExperiment(data, true, allMetricGroups);
  if (metricIds.length) {
    const map = await getMetricMap(context);
    for (let i = 0; i < metricIds.length; i++) {
      const metric = map.get(metricIds[i]);
      if (metric) {
        // Make sure it is tied to the same datasource as the experiment
        if (data.datasource && metric.datasource !== data.datasource) {
          throw new Error(
            "Metrics must be tied to the same datasource as the experiment: " +
              metricIds[i],
          );
        }
      } else {
        // check to see if this metric is actually a metric group
        const metricGroup = await context.models.metricGroups.getById(
          metricIds[i],
        );
        if (metricGroup) {
          // Make sure it is tied to the same datasource as the experiment
          if (data.datasource && metricGroup.datasource !== data.datasource) {
            throw new Error(
              "Metric group must be tied to the same datasource as the experiment: " +
                metricIds[i],
            );
          }
        } else {
          // new metric that's not recognized...
          throw new Error("Unknown metric: " + metricIds[i]);
        }
      }
    }
  }

  return { metricIds, datasource };
}
