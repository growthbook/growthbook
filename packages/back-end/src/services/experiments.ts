import uniqid from "uniqid";
import cronParser from "cron-parser";
import uniq from "lodash/uniq";
import { z } from "zod";
import { isEqual } from "lodash";
import {
  DEFAULT_STATS_ENGINE,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_P_VALUE_THRESHOLD,
} from "shared/constants";
import { getScopedSettings } from "shared/settings";
import {
  getSnapshotAnalysis,
  generateVariationId,
  isAnalysisAllowed,
  getMatchingRules,
  MatchingRule,
  validateCondition,
} from "shared/util";
import {
  ExperimentMetricInterface,
  getRegressionAdjustmentsForMetric,
  isFactMetric,
  isFactMetricId,
} from "shared/experiments";
import { orgHasPremiumFeature } from "enterprise";
import { hoursBetween } from "shared/dates";
import { updateExperiment } from "../models/ExperimentModel";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
  SnapshotVariation,
} from "../../types/experiment-snapshot";
import {
  getMetricById,
  getMetricMap,
  insertMetric,
} from "../models/MetricModel";
import { checkSrm, sumSquaresFromStats } from "../util/stats";
import { addTags } from "../models/TagModel";
import {
  addOrUpdateSnapshotAnalysis,
  createExperimentSnapshotModel,
  updateSnapshotAnalysis,
} from "../models/ExperimentSnapshotModel";
import { Dimension } from "../types/Integration";
import {
  Condition,
  MetricInterface,
  MetricStats,
  Operator,
} from "../../types/metric";
import { SegmentInterface } from "../../types/segment";
import {
  ExperimentInterface,
  ExperimentPhase,
  LinkedFeatureEnvState,
  LinkedFeatureInfo,
  LinkedFeatureState,
} from "../../types/experiment";
import { findDimensionById } from "../models/DimensionModel";
import { findSegmentById } from "../models/SegmentModel";
import {
  DEFAULT_CONVERSION_WINDOW_HOURS,
  EXPERIMENT_REFRESH_FREQUENCY,
} from "../util/secrets";
import {
  ExperimentUpdateSchedule,
  OrganizationInterface,
  ReqContext,
} from "../../types/organization";
import { logger } from "../util/logger";
import { DataSourceInterface } from "../../types/datasource";
import {
  ApiExperiment,
  ApiExperimentMetric,
  ApiExperimentResults,
  ApiMetric,
} from "../../types/openapi";
import { MetricRegressionAdjustmentStatus } from "../../types/report";
import {
  postExperimentValidator,
  postMetricValidator,
  putMetricValidator,
  updateExperimentValidator,
} from "../validators/openapi";
import { EventAuditUser } from "../events/event-types";
import { VisualChangesetInterface } from "../../types/visual-changeset";
import { findProjectById } from "../models/ProjectModel";
import { MetricAnalysisQueryRunner } from "../queryRunners/MetricAnalysisQueryRunner";
import { ExperimentResultsQueryRunner } from "../queryRunners/ExperimentResultsQueryRunner";
import { QueryMap, getQueryMap } from "../queryRunners/QueryRunner";
import { getFactMetric } from "../models/FactMetricModel";
import { FactTableMap } from "../models/FactTableModel";
import { StatsEngine } from "../../types/stats";
import { getFeaturesByIds } from "../models/FeatureModel";
import { getFeatureRevisionsByFeatureIds } from "../models/FeatureRevisionModel";
import { ExperimentRefRule, FeatureRule } from "../../types/feature";
import { ApiReqContext } from "../../types/api";
import { getReportVariations, getMetricForSnapshot } from "./reports";
import { getIntegrationFromDatasourceId } from "./datasource";
import {
  MetricSettingsForStatsEngine,
  QueryResultsForStatsEngine,
  analyzeExperimentMetric,
  analyzeExperimentResults,
  getMetricSettingsForStatsEngine,
} from "./stats";
import { getEnvironmentIdsFromOrg } from "./organizations";

export const DEFAULT_METRIC_ANALYSIS_DAYS = 90;

export async function createMetric(data: Partial<MetricInterface>) {
  const metric = insertMetric({
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
  context: ReqContext | ApiReqContext,
  metricId: string
): Promise<ExperimentMetricInterface | null> {
  if (isFactMetricId(metricId)) {
    return getFactMetric(context, metricId);
  }
  return getMetricById(context, metricId);
}

export async function refreshMetric(
  context: ReqContext | ApiReqContext,
  metric: MetricInterface,
  metricAnalysisDays: number = DEFAULT_METRIC_ANALYSIS_DAYS
) {
  if (metric.datasource) {
    const integration = await getIntegrationFromDatasourceId(
      context,
      metric.datasource,
      true
    );

    let segment: SegmentInterface | undefined = undefined;
    if (metric.segment) {
      segment =
        (await findSegmentById(metric.segment, context.org.id)) || undefined;
      if (!segment || segment.datasource !== metric.datasource) {
        throw new Error("Invalid user segment chosen");
      }
    }

    let days = metricAnalysisDays;
    if (days < 1) {
      days = DEFAULT_METRIC_ANALYSIS_DAYS;
    }

    const from = new Date();
    from.setDate(from.getDate() - days);
    const to = new Date();
    to.setDate(to.getDate() + 1);

    const queryRunner = new MetricAnalysisQueryRunner(
      metric,
      integration,
      context
    );
    await queryRunner.startAnalysis({
      from,
      to,
      name: `Last ${days} days`,
      includeByDate: true,
      segment,
      metric,
    });
  } else {
    throw new Error("Cannot analyze manual metrics");
  }
}

export function generateTrackingKey(name: string, n: number): string {
  let key = ("-" + name)
    .toLowerCase()
    // Replace whitespace with hyphen
    .replace(/\s+/g, "-")
    // Get rid of all non alpha-numeric characters
    .replace(/[^a-z0-9\-_]*/g, "")
    // Remove stopwords
    .replace(
      /-((a|about|above|after|again|all|am|an|and|any|are|arent|as|at|be|because|been|before|below|between|both|but|by|cant|could|did|do|does|dont|down|during|each|few|for|from|had|has|have|having|here|how|if|in|into|is|isnt|it|its|itself|more|most|no|nor|not|of|on|once|only|or|other|our|out|over|own|same|should|shouldnt|so|some|such|that|than|then|the|there|theres|these|this|those|through|to|too|under|until|up|very|was|wasnt|we|weve|were|what|whats|when|where|which|while|who|whos|whom|why|with|wont|would)-)+/g,
      "-"
    )
    // Collapse duplicate hyphens
    .replace(/-{2,}/g, "-")
    // Remove leading and trailing hyphens
    .replace(/(^-|-$)/g, "");

  // Add number if this is not the first attempt
  if (n > 1) {
    key += "-" + n;
  }

  return key;
}

export async function getManualSnapshotData(
  experiment: ExperimentInterface,
  analysisSettings: ExperimentSnapshotAnalysisSettings,
  phaseIndex: number,
  users: number[],
  metrics: {
    [key: string]: MetricStats[];
  },
  metricMap: Map<string, ExperimentMetricInterface>
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
      ...getMetricSettingsForStatsEngine(metric, metricMap, false),
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
            s.count
          ),
        };
      }),
      metrics: [m],
    });
  });

  const result = await analyzeExperimentMetric({
    variations: getReportVariations(experiment, phase),
    phaseLengthHours: Math.max(
      hoursBetween(phase.dateStarted, phase.dateEnded ?? new Date()),
      1
    ),
    coverage: experiment.phases?.[phaseIndex]?.coverage ?? 1,
    analyses: [{ ...analysisSettings, regressionAdjusted: false }], // no RA for manual snapshots
    metrics: metricSettings,
    queryResults: queryResults,
  });

  result.forEach(({ metric, analyses }) => {
    const res = analyses[0];
    const data = res.dimensions[0];
    if (!data) return;
    data.variations.map((v, i) => {
      variations[i].metrics[metric] = v;
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
  experiment: ExperimentInterface,
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
    statsEngine,
    dimensions: dimension ? [dimension] : [],
    regressionAdjusted:
      hasRegressionAdjustmentFeature &&
      statsEngine === "frequentist" &&
      (regressionAdjustmentEnabled !== undefined
        ? regressionAdjustmentEnabled
        : organization.settings?.regressionAdjustmentEnabled ?? false),
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
  };
}

export function getAdditionalExperimentAnalysisSettings(
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings,
  experiment: ExperimentInterface
): ExperimentSnapshotAnalysisSettings[] {
  // one analysis per possible baseline
  const additionalAnalyses: ExperimentSnapshotAnalysisSettings[] = [];
  experiment.variations.forEach((v, i) => {
    if (i > 0) {
      additionalAnalyses.push({
        ...defaultAnalysisSettings,
        baselineVariationIndex: i,
      });
    }
  });
  // for default baseline, get difference types
  additionalAnalyses.push({
    ...defaultAnalysisSettings,
    differenceType: "absolute",
  });
  additionalAnalyses.push({
    ...defaultAnalysisSettings,
    differenceType: "scaled",
  });

  // Skip all of these additional analyses until we fix the performance issues
  //return additionalAnalyses;
  return [];
}

export function getSnapshotSettings({
  experiment,
  phaseIndex,
  settings,
  metricRegressionAdjustmentStatuses,
  metricMap,
}: {
  experiment: ExperimentInterface;
  phaseIndex: number;
  settings: ExperimentSnapshotAnalysisSettings;
  metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[];
  metricMap: Map<string, ExperimentMetricInterface>;
}): ExperimentSnapshotSettings {
  const phase = experiment.phases[phaseIndex];
  if (!phase) {
    throw new Error("Invalid snapshot phase");
  }

  const metricSettings = [
    // Combine goals, guardrails, and activation metric and de-dupe the list
    ...new Set([
      ...experiment.metrics,
      ...(experiment.guardrails || []),
      ...(experiment.activationMetric ? [experiment.activationMetric] : []),
    ]),
  ]
    .map((m) =>
      getMetricForSnapshot(
        m,
        metricMap,
        metricRegressionAdjustmentStatuses,
        experiment.metricOverrides
      )
    )
    .filter(Boolean) as MetricForSnapshot[];

  return {
    manual: !experiment.datasource,
    activationMetric: experiment.activationMetric || null,
    attributionModel: experiment.attributionModel || "firstExposure",
    skipPartialData: !!experiment.skipPartialData,
    segment: experiment.segment || "",
    queryFilter: experiment.queryFilter || "",
    datasourceId: experiment.datasource || "",
    dimensions: settings.dimensions.map((id) => ({ id })),
    startDate: phase.dateStarted,
    endDate: phase.dateEnded || new Date(),
    experimentId: experiment.trackingKey || experiment.id,
    goalMetrics: experiment.metrics,
    guardrailMetrics: experiment.guardrails || [],
    regressionAdjustmentEnabled:
      settings.statsEngine === "frequentist" && !!settings.regressionAdjusted,
    exposureQueryId: experiment.exposureQueryId,
    metricSettings: metricSettings,
    variations: experiment.variations.map((v, i) => ({
      id: v.key || i + "",
      weight: phase.variationWeights[i] || 0,
    })),
    coverage: phase.coverage ?? 1,
  };
}

export async function createManualSnapshot(
  experiment: ExperimentInterface,
  phaseIndex: number,
  users: number[],
  metrics: {
    [key: string]: MetricStats[];
  },
  analysisSettings: ExperimentSnapshotAnalysisSettings,
  metricMap: Map<string, ExperimentMetricInterface>
) {
  const { srm, variations } = await getManualSnapshotData(
    experiment,
    analysisSettings,
    phaseIndex,
    users,
    metrics,
    metricMap
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
    settings: getSnapshotSettings({
      experiment,
      phaseIndex,
      settings: analysisSettings,
      metricRegressionAdjustmentStatuses: [],
      metricMap,
    }),
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
  };

  const snapshot = await createExperimentSnapshotModel(data);

  return snapshot;
}

export async function parseDimensionId(
  dimension: string | null | undefined,
  organization: string
): Promise<Dimension | null> {
  if (dimension) {
    if (dimension.match(/^exp:/)) {
      return {
        type: "experiment",
        id: dimension.substr(4),
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

export async function createSnapshot({
  experiment,
  context,
  user = null,
  phaseIndex,
  useCache = false,
  defaultAnalysisSettings,
  additionalAnalysisSettings,
  metricRegressionAdjustmentStatuses,
  metricMap,
  factTableMap,
}: {
  experiment: ExperimentInterface;
  context: ReqContext | ApiReqContext;
  user?: EventAuditUser;
  phaseIndex: number;
  useCache?: boolean;
  defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings;
  additionalAnalysisSettings: ExperimentSnapshotAnalysisSettings[];
  metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
}): Promise<ExperimentResultsQueryRunner> {
  const { org: organization } = context;
  const dimension = defaultAnalysisSettings.dimensions[0] || null;

  const snapshotSettings = getSnapshotSettings({
    experiment,
    phaseIndex,
    settings: defaultAnalysisSettings,
    metricRegressionAdjustmentStatuses,
    metricMap,
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

  const nextUpdate =
    determineNextDate(organization.settings?.updateSchedule || null) ||
    undefined;

  await updateExperiment({
    context,
    experiment,
    user,
    changes: {
      lastSnapshotAttempt: new Date(),
      nextSnapshotAttempt: nextUpdate,
      autoSnapshots: nextUpdate !== null,
    },
  });

  const snapshot = await createExperimentSnapshotModel(data);

  const integration = await getIntegrationFromDatasourceId(
    context,
    experiment.datasource,
    true
  );

  const queryRunner = new ExperimentResultsQueryRunner(
    snapshot,
    integration,
    context,
    useCache
  );
  await queryRunner.startAnalysis({
    snapshotSettings: data.settings,
    variationNames: experiment.variations.map((v) => v.name),
    metricMap,
    queryParentId: snapshot.id,
    factTableMap,
  });

  return queryRunner;
}

export async function createSnapshotAnalysis({
  experiment,
  organization,
  analysisSettings,
  metricMap,
  snapshot,
}: {
  experiment: ExperimentInterface;
  organization: OrganizationInterface;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  snapshot: ExperimentSnapshotInterface;
}): Promise<void> {
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
  addOrUpdateSnapshotAnalysis(organization.id, snapshot.id, analysis);

  // Format data correctly
  const queryMap: QueryMap = await getQueryMap(
    organization.id,
    snapshot.queries
  );

  // Run the analysis
  const results = await analyzeExperimentResults({
    queryData: queryMap,
    snapshotSettings: snapshot.settings,
    analysisSettings: [analysisSettings],
    variationNames: experiment.variations.map((v) => v.name),
    metricMap: metricMap,
  });
  analysis.results = results[0]?.dimensions || [];
  analysis.status = "success";
  analysis.error = undefined;

  updateSnapshotAnalysis(organization.id, snapshot.id, analysis);
}

function getExperimentMetric(
  experiment: ExperimentInterface,
  id: string
): ApiExperimentMetric {
  const overrides = experiment.metricOverrides?.find((o) => o.id === id);
  const ret: ApiExperimentMetric = {
    metricId: id,
    overrides: {},
  };

  if (overrides?.conversionDelayHours) {
    ret.overrides.conversionWindowStart = overrides.conversionDelayHours;
  }
  if (overrides?.conversionWindowHours) {
    ret.overrides.conversionWindowEnd =
      overrides.conversionWindowHours + (overrides?.conversionDelayHours || 0);
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
  experiment: ExperimentInterface
): Promise<ApiExperiment> {
  let project = null;
  const organization = context.org;
  if (experiment.project) {
    project = await findProjectById(context, experiment.project);
  }
  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    // todo: experiment settings
  });

  const activationMetric = experiment.activationMetric;
  return {
    id: experiment.id,
    name: experiment.name || "",
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
    variations: experiment.variations.map((v) => ({
      variationId: v.id,
      key: v.key,
      name: v.name || "",
      description: v.description || "",
      screenshots: v.screenshots.map((s) => s.path),
    })),
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
      goals: experiment.metrics.map((m) => getExperimentMetric(experiment, m)),
      guardrails: (experiment.guardrails || []).map((m) =>
        getExperimentMetric(experiment, m)
      ),
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
  };
}

export function toSnapshotApiInterface(
  experiment: ExperimentInterface,
  snapshot: ExperimentSnapshotInterface
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

  const metricIds = new Set([
    ...experiment.metrics,
    ...(experiment.guardrails || []),
  ]);
  if (activationMetric) {
    metricIds.add(activationMetric);
  }

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
      goals: experiment.metrics.map((m) => getExperimentMetric(experiment, m)),
      guardrails: (experiment.guardrails || []).map((m) =>
        getExperimentMetric(experiment, m)
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
  datasource: Pick<DataSourceInterface, "type">
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
    const { capping, capValue } = behavior;

    const cappingExists = typeof capping !== "undefined" && capping !== null;
    const capValueExists = typeof capValue !== "undefined";
    if (cappingExists !== capValueExists) {
      return {
        valid: false,
        error:
          "Must specify both `behavior.capping` (as non-null) and `behavior.capValue` or neither.",
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
  payload: z.infer<typeof putMetricValidator.bodySchema>
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
  datasource: Pick<DataSourceInterface, "type">
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
    if (typeof behavior.capping !== "undefined") {
      metric.capping = behavior.capping;
      metric.capValue = behavior.capValue;
    }
    // handle old post requests
    else if (typeof behavior.cap !== "undefined" && behavior.cap) {
      metric.capping = "absolute";
      metric.capValue = behavior.cap;
    }

    if (typeof behavior.conversionWindowStart !== "undefined") {
      // The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the Conversion Delay
      metric.conversionDelayHours = behavior.conversionWindowStart;
    }

    if (
      typeof behavior.conversionWindowEnd !== "undefined" &&
      typeof behavior.conversionWindowStart !== "undefined"
    ) {
      // The end of a Conversion Window relative to the exposure date, in hours.
      // This is equivalent to the Conversion Delay + Conversion Window Hours settings in the UI. In other words,
      // if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and
      // conversionWindowEnd to 72 (24+48).
      metric.conversionWindowHours =
        behavior.conversionWindowEnd - behavior.conversionWindowStart;
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
  payload: z.infer<typeof putMetricValidator.bodySchema>
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
  } = payload;

  const metric: Partial<MetricInterface> = {
    ...(typeof description !== "undefined" ? { description } : {}),
    ...(typeof name !== "undefined" ? { name } : {}),
    ...(typeof owner !== "undefined" ? { owner } : {}),
    ...(typeof tags !== "undefined" ? { tags } : {}),
    ...(typeof projects !== "undefined" ? { projects } : {}),
    ...(typeof type !== "undefined" ? { type } : {}),
  };

  // Assign all undefined behavior fields to the metric
  if (behavior) {
    if (typeof behavior.goal !== "undefined") {
      metric.inverse = behavior.goal === "decrease";
    }

    if (typeof behavior.capping !== "undefined") {
      metric.capping = behavior.capping;
      if (behavior.capping !== null) {
        metric.capValue = behavior.capValue;
      }
    }

    if (typeof behavior.conversionWindowStart !== "undefined") {
      // The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the Conversion Delay
      metric.conversionDelayHours = behavior.conversionWindowStart;
    }

    if (
      typeof behavior.conversionWindowEnd !== "undefined" &&
      typeof behavior.conversionWindowStart !== "undefined"
    ) {
      // The end of a Conversion Window relative to the exposure date, in hours.
      // This is equivalent to the Conversion Delay + Conversion Window Hours settings in the UI. In other words,
      // if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and
      // conversionWindowEnd to 72 (24+48).
      metric.conversionWindowHours =
        behavior.conversionWindowEnd - behavior.conversionWindowStart;
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
      })
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
  datasource: DataSourceInterface | null
): ApiMetric {
  const metricDefaults = organization.settings?.metricDefaults;

  let conversionStart = metric.conversionDelayHours || 0;
  const conversionEnd =
    conversionStart +
    (metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS);
  if (!conversionStart && metric.earlyStart) {
    conversionStart = -0.5;
  }

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
      capping: metric.capping,
      capValue: metric.capValue || 0,
      minPercentChange:
        metric.minPercentChange ?? metricDefaults?.minPercentageChange ?? 0.005,
      maxPercentChange:
        metric.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0.5,
      minSampleSize:
        metric.minSampleSize ?? metricDefaults?.minimumSampleSize ?? 150,
      riskThresholdDanger: metric.loseRisk ?? 0.0125,
      riskThresholdSuccess: metric.winRisk ?? 0.0025,
      conversionWindowStart: conversionStart,
      conversionWindowEnd: conversionEnd,
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
  raw: number[] | undefined
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
  datasource: DataSourceInterface
): Omit<ExperimentInterface, "dateCreated" | "dateUpdated" | "id"> {
  const phases: ExperimentPhase[] = payload.phases?.map((p) => {
    const conditionRes = validateCondition(p.condition);
    if (!conditionRes.success) {
      throw new Error(`Invalid targeting condition: ${conditionRes.error}`);
    }

    return {
      ...p,
      dateStarted: new Date(p.dateStarted),
      dateEnded: p.dateEnded ? new Date(p.dateEnded) : undefined,
      reason: p.reason || "",
      coverage: p.coverage != null ? p.coverage : 1,
      condition: p.condition || "{}",
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
        () => 1 / payload.variations.length
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

  return {
    organization: organization.id,
    datasource: datasource.id,
    archived: payload.archived ?? false,
    hashAttribute: payload.hashAttribute ?? "",
    hashVersion: payload.hashVersion ?? 2,
    autoSnapshots: true,
    project: payload.project,
    owner: payload.owner || "",
    trackingKey: payload.trackingKey || "",
    exposureQueryId:
      payload.assignmentQueryId ||
      datasource.settings.queries?.exposure?.[0]?.id ||
      "",
    name: payload.name || "",
    phases,
    tags: payload.tags || [],
    description: payload.description || "",
    hypothesis: payload.hypothesis || "",
    metrics: payload.metrics || [],
    metricOverrides: [],
    guardrails: payload.guardrailMetrics || [],
    activationMetric: "",
    segment: "",
    queryFilter: "",
    skipPartialData: false,
    attributionModel: "firstExposure",
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
    sequentialTestingEnabled: !!organization?.settings
      ?.sequentialTestingEnabled,
    sequentialTestingTuningParameter: DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  };
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
  experiment: ExperimentInterface
): Partial<ExperimentInterface> {
  const {
    trackingKey,
    project,
    owner,
    assignmentQueryId,
    hashAttribute,
    hashVersion,
    name,
    tags,
    description,
    hypothesis,
    metrics,
    guardrailMetrics,
    archived,
    status,
    phases,
    variations,
    releasedVariationId,
    excludeFromPayload,
  } = payload;
  return {
    ...(trackingKey ? { trackingKey } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(assignmentQueryId ? { assignmentQueryId } : {}),
    ...(hashAttribute ? { hashAttribute } : {}),
    ...(hashVersion ? { hashVersion } : {}),
    ...(name ? { name } : {}),
    ...(tags ? { tags } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(hypothesis !== undefined ? { hypothesis } : {}),
    ...(metrics ? { metrics } : {}),
    ...(guardrailMetrics ? { guardrails: guardrailMetrics } : {}),
    ...(archived !== undefined ? { archived } : {}),
    ...(status ? { status } : {}),
    ...(releasedVariationId !== undefined ? { releasedVariationId } : {}),
    ...(excludeFromPayload !== undefined ? { excludeFromPayload } : {}),
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
                `Invalid targeting condition: ${conditionRes.error}`
              );
            }

            return {
              ...p,
              dateStarted: new Date(p.dateStarted),
              dateEnded: p.dateEnded ? new Date(p.dateEnded) : undefined,
              reason: p.reason || "",
              coverage: p.coverage != null ? p.coverage : 1,
              condition: p.condition || "{}",
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
                  (_v, _i, arr) => 1 / arr.length
                ),
            };
          }),
        }
      : {}),
    dateUpdated: new Date(),
  };
}

export async function getRegressionAdjustmentInfo(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface
): Promise<{
  regressionAdjustmentEnabled: boolean;
  metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[];
}> {
  let regressionAdjustmentEnabled = false;
  const metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[] = [];

  if (!experiment.regressionAdjustmentEnabled) {
    return { regressionAdjustmentEnabled, metricRegressionAdjustmentStatuses };
  }

  const metricMap = await getMetricMap(context);

  const allExperimentMetricIds = uniq([
    ...experiment.metrics,
    ...(experiment.guardrails ?? []),
  ]);
  const allExperimentMetrics = allExperimentMetricIds
    .map((id) => metricMap.get(id))
    .filter(Boolean);

  const denominatorMetrics = allExperimentMetrics
    .filter((m) => m && !isFactMetric(m) && m.denominator)
    .map((m: ExperimentMetricInterface) =>
      metricMap.get(m.denominator as string)
    )
    .filter(Boolean) as MetricInterface[];

  for (const metric of allExperimentMetrics) {
    if (!metric) continue;
    const {
      metricRegressionAdjustmentStatus,
    } = getRegressionAdjustmentsForMetric({
      metric: metric,
      denominatorMetrics: denominatorMetrics,
      experimentRegressionAdjustmentEnabled:
        experiment.regressionAdjustmentEnabled ??
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      organizationSettings: context.org.settings,
      metricOverrides: experiment.metricOverrides,
    });
    if (metricRegressionAdjustmentStatus.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = true;
    }
    metricRegressionAdjustmentStatuses.push(metricRegressionAdjustmentStatus);
  }
  if (!experiment.regressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = false;
  }
  return { regressionAdjustmentEnabled, metricRegressionAdjustmentStatuses };
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
    ({ css, domMutations }) => ({ css, domMutations })
  );
  const newVisualChanges = newVisualChangeset.visualChanges.map(
    ({ css, domMutations }) => ({ css, domMutations })
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
  experiment: ExperimentInterface
) {
  const linkedFeatures = experiment.linkedFeatures || [];
  if (!linkedFeatures.length) return [];

  const features = await getFeaturesByIds(context, linkedFeatures);

  const revisionsByFeatureId = await getFeatureRevisionsByFeatureIds(
    context.org.id,
    linkedFeatures
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
        .filter((r) => r.status === "draft")
        .map((r) => getMatchingRules(feature, filter, environments, r))
        .filter((matches) => matches.length > 0)[0] || [];

    const lockedMatches =
      revisions
        .filter(
          (r) => r.status === "published" && r.version !== feature.version
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
            b.variationId.localeCompare(a.variationId)
          )
        )
      )
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

  return linkedFeatureInfo.filter((info) => info.state !== "discarded");
}
