import { z } from "zod";
import {
  cappingSettingsValidator,
  windowSettingsValidator,
} from "back-end/src/routers/fact-table/fact-table.validators";
import { queryPointerValidator } from "back-end/src/validators/queries";
import { baseSchema } from "back-end/src/models/BaseModel";
// Schema for SnapshotSettingsVariation, based on the type in experiment-snapshot.d.ts
const snapshotSettingsVariationSchema = z.object({
  id: z.string(),
  name: z.string(),
  weight: z.number(),
});

const metricForSnapshotSchema = z.object({
  id: z.string(),
  settings: z
    .object({
      datasource: z.string(),
      aggregation: z.string().optional(),
      sql: z.string().optional(),
      cappingSettings: cappingSettingsValidator,
      denominator: z.string().optional(),
      userIdTypes: z.array(z.string()).optional(),
      type: z.enum(["count", "binomial", "duration", "revenue"]),
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

// Main configuration schema for an interaction snapshot
const interactionSnapshotConfigSchema = z.object({
  goalMetrics: z.array(z.string()),
  metricSettings: z.array(metricForSnapshotSchema),
  startDate: z.date(),
  endDate: z.date(),
  variationNames: z.array(z.string()),
  experiment1Params: z.object({
    activationMetricId: z.string().nullable(),
    variations: z.array(snapshotSettingsVariationSchema),
    exposureQueryId: z.string(),
    trackingKey: z.string(),
  }),
  experiment2Params: z.object({
    activationMetricId: z.string().nullable(),
    variations: z.array(snapshotSettingsVariationSchema),
    exposureQueryId: z.string(),
    trackingKey: z.string(),
  }),
});

// Zod schema for MetricStats
const metricStatsSchema = z.object({
  users: z.number(),
  count: z.number(),
  stddev: z.number(),
  mean: z.number(),
});

// Zod schema for SnapshotMetric
const snapshotMetricSchema = z.object({
  value: z.number(),
  cr: z.number(),
  users: z.number(),
  denominator: z.number().optional(),
  ci: z.tuple([z.number(), z.number()]).optional(),
  ciAdjusted: z.tuple([z.number(), z.number()]).optional(),
  expected: z.number().optional(),
  risk: z.tuple([z.number(), z.number()]).optional(),
  riskType: z.enum(["relative", "absolute"]).optional(),
  stats: metricStatsSchema.optional(),
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
  errorMessage: z.string().nullable().optional(),
});

// Zod schema for SnapshotVariation
const snapshotVariationSchema = z.object({
  users: z.number(),
  metrics: z.record(snapshotMetricSchema),
});

// Zod schema for ExperimentReportResultDimension (updated)
const experimentReportResultDimensionSchema = z.object({
  name: z.string(),
  srm: z.number(),
  variations: z.array(snapshotVariationSchema),
});

// Zod schema for ExperimentSnapshotAnalysisSettings
const experimentSnapshotAnalysisSettingsSchema = z.object({
  dimensions: z.array(z.string()),
  statsEngine: z.enum(["bayesian", "frequentist"]),
  regressionAdjusted: z.boolean().optional(),
  sequentialTesting: z.boolean().optional(),
  sequentialTestingTuningParameter: z.number().optional(),
  differenceType: z.enum(["relative", "absolute", "scaled"]),
  pValueCorrection: z
    .union([z.null(), z.enum(["holm-bonferroni", "benjamini-hochberg"])])
    .optional(),
  pValueThreshold: z.number().optional(),
  baselineVariationIndex: z.number().optional(),
  numGoalMetrics: z.number(),
  oneSidedIntervals: z.boolean().optional(),
  interactionDimensions: z.array(z.object({
    dimension: z.string(),
    variationNames: z.array(z.string()),
    varationWeights: z.array(z.number()),
  })).optional(),
});

// Zod schema for ExperimentSnapshotAnalysis
const experimentSnapshotAnalysisSchema = z.object({
  settings: experimentSnapshotAnalysisSettingsSchema,
  dateCreated: z.date(),
  status: z.enum(["running", "success", "error"]),
  error: z.string().optional(),
  results: z.array(experimentReportResultDimensionSchema),
  experimentNumber: z.number().optional(),
});

export const interactionSnapshotInterfaceValidator = baseSchema
  .extend({
    experimentId1: z.string(),
    experimentId2: z.string(),
    datasourceId: z.string(),

    config: interactionSnapshotConfigSchema,

    queries: z.array(queryPointerValidator),
    status: z.enum(["queued", "running", "success", "error"]).default("queued"),
    error: z.string().optional(),
    runStarted: z.date().nullable(),

    jointAnalyses: z.array(experimentSnapshotAnalysisSchema),
    mainAnalyses: z.array(experimentSnapshotAnalysisSchema),
    unknownVariations: z.array(z.string()).optional(),
    multipleExposures: z.number().optional(),
  })
  .strict();