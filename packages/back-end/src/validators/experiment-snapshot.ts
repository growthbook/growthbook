import { z } from "zod";
import { MidExperimentPowerCalculationResultValidator } from "shared/enterprise";
import { statsEnginesValidator } from "back-end/src/models/ProjectModel";
import {
  cappingSettingsValidator,
  priorSettingsValidator,
  windowSettingsValidator,
} from "back-end/src/routers/fact-table/fact-table.validators";
import { attributionModel, banditResult } from "./experiments";
import { queryPointerValidator } from "./queries";

const experimentSnapshotTrafficDimensionObject = z.object({
  name: z.string(),
  srm: z.number(),
  variationUnits: z.array(z.number()),
});

export type ExperimentSnapshotTrafficDimension = z.infer<
  typeof experimentSnapshotTrafficDimensionObject
>;

const experimentSnapshotTrafficObject = z.object({
  overall: experimentSnapshotTrafficDimensionObject,
  dimension: z.record(
    z.string(),
    z.array(experimentSnapshotTrafficDimensionObject)
  ),
  error: z
    .enum(["NO_ROWS_IN_UNIT_QUERY", "TOO_MANY_ROWS"])
    .or(z.string())
    .optional(),
});

export type ExperimentSnapshotTraffic = z.infer<
  typeof experimentSnapshotTrafficObject
>;

const experimentSnapshotHealthObject = z.object({
  traffic: experimentSnapshotTrafficObject,
  power: MidExperimentPowerCalculationResultValidator.optional(),
});

export type ExperimentSnapshotHealth = z.infer<
  typeof experimentSnapshotHealthObject
>;

const metricStatsObject = z.object({
  users: z.number(),
  count: z.number(),
  stddev: z.number(),
  mean: z.number(),
});

const metricPowerResponseFromStatsEngineObject = z.object({
  status: z.string(),
  errorMessage: z.string().optional().nullable(),
  firstPeriodPairwiseSampleSize: z.number().optional(),
  targetMDE: z.number(),
  sigmahat2Delta: z.number().optional(),
  priorProper: z.boolean().optional(),
  priorLiftMean: z.number().optional(),
  priorLiftVariance: z.number().optional(),
  upperBoundAchieved: z.boolean().optional(),
  scalingFactor: z.number().optional().nullable(),
});

export type MetricPowerResponseFromStatsEngine = z.infer<
  typeof metricPowerResponseFromStatsEngineObject
>;

const snapshotMetricObject = z.object({
  value: z.number(),
  cr: z.number(),
  users: z.number(),
  denominator: z.number().optional(),
  ci: z.tuple([z.number(), z.number()]).optional(),
  ciAdjusted: z.tuple([z.number(), z.number()]).optional(),
  expected: z.number().optional(),
  risk: z.tuple([z.number(), z.number()]).optional(),
  riskType: z.enum(["relative", "absolute"]).optional(),
  stats: metricStatsObject.optional(),
  pValue: z.number().optional(),
  pValueAdjusted: z.number().optional(),
  uplift: z
    .object({
      dist: z.string(),
      mean: z.number().optional(),
      stddev: z.number().optional(),
    })
    .optional(),
  buckets: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
      })
    )
    .optional(),
  chanceToWin: z.number().optional(),
  errorMessage: z.string().optional().nullable(),
  power: metricPowerResponseFromStatsEngineObject.optional().nullable(),
});

export type SnapshotMetric = z.infer<typeof snapshotMetricObject>;

const snapshotVariationObject = z.object({
  users: z.number(),
  metrics: z.record(z.string(), snapshotMetricObject),
});

const experimentReportResultDimensionObject = z.object({
  name: z.string(),
  srm: z.number(),
  variations: z.array(snapshotVariationObject),
});

const experimentSnapshotAnalysisSettingsValidator = z.object({
  dimensions: z.array(z.string()),
  statsEngine: statsEnginesValidator,
  regressionAdjusted: z.boolean().optional(),
  sequentialTesting: z.boolean().optional(),
  sequentialTestingTuningParameter: z.number().optional(),
  differenceType: z.enum(["absolute", "relative", "scaled"]),
  pValueCorrection: z
    .enum(["holm-bonferroni", "benjamini-hochberg"])
    .nullable()
    .optional(),
  pValueThreshold: z.number().optional(),
  baselineVariationIndex: z.number().optional(),
  numGoalMetrics: z.number(),
});

export type ExperimentSnapshotAnalysisSettings = z.infer<
  typeof experimentSnapshotAnalysisSettingsValidator
>;

const experimentSnapshotAnalysisObject = z.object({
  settings: experimentSnapshotAnalysisSettingsValidator,
  dateCreated: z.date(),
  status: z.enum(["running", "success", "error"]),
  error: z.string().optional(),
  results: z.array(experimentReportResultDimensionObject),
});

export type ExperimentSnapshotAnalysis = z.infer<
  typeof experimentSnapshotAnalysisObject
>;

const dimensionForSnapshotObject = z.object({
  id: z.string(),
  settings: z
    .object({
      datasource: z.string(),
      userIdType: z.string(),
      sql: z.string(),
    })
    .optional(),
});

const metricForSnapshotObject = z.object({
  id: z.string(),
  settings: z
    .object({
      datasource: z.string(),
      aggregation: z.string().optional(),
      sql: z.string().optional(),
      cappingSettings: cappingSettingsValidator,
      denominator: z.string().optional(),
      userIdTypes: z.array(z.string()).optional(),
      type: z.enum(["binomial", "count", "duration", "revenue"]),
    })
    .optional(),
  computedSettings: z
    .object({
      regressionAdjustmentEnabled: z.boolean(),
      regressionAdjustmentAvailable: z.boolean(),
      regressionAdjustmentDays: z.number(),
      regressionAdjustmentReason: z.string(),
      properPrior: z.boolean(),
      properPriorMean: z.number(),
      properPriorStdDev: z.number(),
      windowSettings: windowSettingsValidator,
    })
    .optional(),
});

export type MetricForSnapshot = z.infer<typeof metricForSnapshotObject>;

const snapshotSettingsVariationValidator = z.object({
  id: z.string(),
  weight: z.number(),
});

export type SnapshotSettingsVariation = z.infer<
  typeof snapshotSettingsVariationValidator
>;

const snapshotBanditSettingsValidator = z.object({
  reweight: z.boolean(),
  decisionMetric: z.string(),
  seed: z.number(),
  currentWeights: z.array(z.number()),
  historicalWeights: z.array(
    z.object({
      date: z.date(),
      weights: z.array(z.number()),
      totalUsers: z.number(),
    })
  ),
});

// Settings that control which queries are run
// Used to determine which types of analyses are possible
// Also used to determine when to show "out-of-date" in the UI
const experimentSnapshotSettingsObject = z.object({
  manual: z.boolean(),
  dimensions: z.array(dimensionForSnapshotObject),
  metricSettings: z.array(metricForSnapshotObject),
  goalMetrics: z.array(z.string()),
  secondaryMetrics: z.array(z.string()),
  guardrailMetrics: z.array(z.string()),
  activationMetric: z.string().nullable(),
  defaultMetricPriorSettings: priorSettingsValidator,
  regressionAdjustmentEnabled: z.boolean(),
  attributionModel: z.enum(attributionModel),
  experimentId: z.string(),
  queryFilter: z.string(),
  segment: z.string(),
  skipPartialData: z.boolean(),
  datasourceId: z.string(),
  exposureQueryId: z.string(),
  startDate: z.date(),
  endDate: z.date(),
  variations: z.array(snapshotSettingsVariationValidator),
  coverage: z.number().optional(),
  banditSettings: snapshotBanditSettingsValidator.optional(),
});

export type ExperimentSnapshotSettings = z.infer<
  typeof experimentSnapshotSettingsObject
>;

export const experimentSnapshotSchema = z
  .object({
    // Fields that uniquely define the snapshot
    id: z.string(),
    organization: z.string(),
    experiment: z.string(),
    phase: z.number(),
    dimension: z.string().nullable(),

    // Status and meta info about the snapshot run
    error: z.string().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    runStarted: z.date().nullable(),
    status: z.enum(["running", "success", "error"]),
    settings: experimentSnapshotSettingsObject,
    type: z.enum(["standard", "exploratory", "report"]).optional(),
    triggeredBy: z.enum(["manual", "schedule"]).optional(),
    report: z.string().optional(),

    // List of queries that were run as part of this snapshot
    queries: z.array(queryPointerValidator),

    // Results
    unknownVariations: z.array(z.string()),
    multipleExposures: z.number(),
    analyses: z.array(experimentSnapshotAnalysisObject),
    banditResult: banditResult.optional().nullable(),

    health: experimentSnapshotHealthObject.optional(),
  })
  .strict();

export type ExperimentSnapshotInterface = z.infer<
  typeof experimentSnapshotSchema
>;

const legacyMetricRegressionAdjustmentStatusValidator = z.object({
  metric: z.string(),
  regressionAdjustmentEnabled: z.boolean(),
  regressionAdjustmentAvailable: z.boolean(),
  regressionAdjustmentDays: z.number(),
  reason: z.string(),
});

export const legacyExperimentSnapshotValidator = experimentSnapshotSchema
  .extend({
    query: z.string().optional(),
    queryLanguage: z.enum(["sql", "javascript", "json", "none"]).optional(),
    hasCorrectedStats: z.boolean().optional(),
    results: z.array(experimentReportResultDimensionObject).optional(),
    hasRawQueries: z.boolean().optional(),
    queryFilter: z.string().optional(),
    segment: z.string().optional(),
    activationMetric: z.string().optional(),
    skipPartialData: z.boolean().optional(),
    statsEngine: statsEnginesValidator.optional(),
    regressionAdjustmentEnabled: z.boolean().optional(),
    metricRegressionAdjustmentStatuses: z
      .array(legacyMetricRegressionAdjustmentStatusValidator)
      .optional(),
    sequentialTestingEnabled: z.boolean().optional(),
    sequentialTestingTuningParameter: z.number().optional(),
    manual: z.boolean(),
  })
  .omit({ dateUpdated: true })
  .strict();

export type LegacyExperimentSnapshotInterface = z.infer<
  typeof legacyExperimentSnapshotValidator
>;
