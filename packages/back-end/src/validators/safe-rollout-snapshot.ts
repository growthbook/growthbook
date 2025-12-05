import { z } from "zod";
import { MidExperimentPowerCalculationResultValidator } from "shared/enterprise";
import { queryPointerValidator } from "shared/src/validators/queries";
import {
  cappingSettingsValidator,
  priorSettingsValidator,
  windowSettingsValidator,
} from "back-end/src/routers/fact-table/fact-table.validators";
import { statsEnginesValidator } from "back-end/src/models/ProjectModel";

const metricStatsObject = z.object({
  users: z.number(),
  count: z.number(),
  stddev: z.number(),
  mean: z.number(),
});

// Keep in sync with gbstats PowerResponse
const metricPowerResponseFromStatsEngineObject = z.object({
  status: z.string(),
  errorMessage: z.string().optional(),
  firstPeriodPairwiseSampleSize: z.number().optional(),
  targetMDE: z.number(),
  sigmahat2Delta: z.number().optional(),
  priorProper: z.boolean().optional(),
  priorLiftMean: z.number().optional(),
  priorLiftVariance: z.number().optional(),
  upperBoundAchieved: z.boolean().optional(),
  scalingFactor: z.number().optional(),
});

export const safeRolloutSnapshotMetricObject = z.object({
  value: z.number(),
  cr: z.number(),
  users: z.number(),
  denominator: z.number().optional(),
  ci: z
    .tuple([
      z.number().or(z.literal(-Infinity)),
      z.number().or(z.literal(Infinity)),
    ])
    .optional(),
  ciAdjusted: z
    .tuple([
      z.number().or(z.literal(-Infinity)),
      z.number().or(z.literal(Infinity)),
    ])
    .optional(),
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
      }),
    )
    .optional(),
  chanceToWin: z.number().optional(),
  errorMessage: z.string().optional(),
  power: metricPowerResponseFromStatsEngineObject.optional(),
});
export type SafeRolloutSnapshotMetricInterface = z.infer<
  typeof safeRolloutSnapshotMetricObject
>;

const safeRolloutSnapshotTrafficDimensionObject = z.object({
  name: z.string(),
  srm: z.number(),
  variationUnits: z.array(z.number()),
});

export type SafeRolloutSnapshotTrafficDimension = z.infer<
  typeof safeRolloutSnapshotTrafficDimensionObject
>;

const safeRolloutSnapshotTrafficObject = z.object({
  overall: safeRolloutSnapshotTrafficDimensionObject,
  dimension: z.record(
    z.string(),
    z.array(safeRolloutSnapshotTrafficDimensionObject),
  ),
  error: z
    .enum(["NO_ROWS_IN_UNIT_QUERY", "TOO_MANY_ROWS"])
    .or(z.string())
    .optional(),
});

const safeRolloutSnapshotHealthObject = z.object({
  traffic: safeRolloutSnapshotTrafficObject,
  power: MidExperimentPowerCalculationResultValidator.optional(),
});

export type SafeRolloutSnapshotHealth = z.infer<
  typeof safeRolloutSnapshotHealthObject
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
      targetMDE: z.number().optional(),
    })
    .optional(),
});

export type MetricForSafeRolloutSnapshot = z.infer<
  typeof metricForSnapshotObject
>;

const snapshotSettingsVariationValidator = z.object({
  id: z.string(),
  weight: z.number(),
});

const safeRolloutSnapshotSettings = z.object({
  experimentId: z.string(),
  dimensions: z.array(dimensionForSnapshotObject),
  metricSettings: z.array(metricForSnapshotObject),
  guardrailMetrics: z.array(z.string()),
  defaultMetricPriorSettings: priorSettingsValidator,
  regressionAdjustmentEnabled: z.boolean(),
  queryFilter: z.string(),
  datasourceId: z.string(),
  exposureQueryId: z.string(),
  startDate: z.date(),
  endDate: z.date(),
  variations: z.array(snapshotSettingsVariationValidator),
  coverage: z.number().optional(),
  phase: z.object({ index: z.string() }).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export type SafeRolloutSnapshotSettings = z.infer<
  typeof safeRolloutSnapshotSettings
>;

const safeRolloutSnapshotVariationObject = z.object({
  users: z.number(),
  metrics: z.record(z.string(), safeRolloutSnapshotMetricObject),
});

const safeRolloutReportResultDimensionObject = z.object({
  name: z.string(),
  srm: z.number(),
  variations: z.array(safeRolloutSnapshotVariationObject),
});
export type SafeRolloutReportResultDimension = z.infer<
  typeof safeRolloutReportResultDimensionObject
>;

const safeRolloutSnapshotAnalysisSettingsValidator = z.object({
  statsEngine: statsEnginesValidator,
  regressionAdjusted: z.boolean().optional(),
  postStratificationEnabled: z.boolean().optional(),
  sequentialTesting: z.boolean().optional(),
  sequentialTestingTuningParameter: z.number().optional(),
  pValueCorrection: z
    .enum(["holm-bonferroni", "benjamini-hochberg"])
    .nullable()
    .optional(),
  pValueThreshold: z.number().optional(),
});

export type SafeRolloutSnapshotAnalysisSettings = z.infer<
  typeof safeRolloutSnapshotAnalysisSettingsValidator
>;

const safeRolloutSnapshotAnalysisObject = z.object({
  settings: safeRolloutSnapshotAnalysisSettingsValidator,
  dateCreated: z.date(),
  status: z.enum(["running", "success", "error"]),
  error: z.string().optional(),
  results: z.array(safeRolloutReportResultDimensionObject),
});

export type SafeRolloutSnapshotAnalysis = z.infer<
  typeof safeRolloutSnapshotAnalysisObject
>;

export const safeRolloutSnapshotInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),

    safeRolloutId: z.string(),
    runStarted: z.date(),
    dimension: z.string().optional(),
    error: z.string().optional(),
    status: z.enum(["running", "success", "error"]),
    settings: safeRolloutSnapshotSettings,
    triggeredBy: z.enum(["manual", "schedule"]),
    queries: z.array(queryPointerValidator),
    multipleExposures: z.number(),
    analyses: z.array(safeRolloutSnapshotAnalysisObject),
    health: safeRolloutSnapshotHealthObject.optional(),
  })
  .strict();

export type SafeRolloutSnapshotInterface = z.infer<
  typeof safeRolloutSnapshotInterface
>;
