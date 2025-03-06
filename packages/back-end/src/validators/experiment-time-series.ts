import { z } from "zod";

// NB: Intentionally not strict to allow zod to strip away the extra fields that come from SnapshotMetric
const experimentTimeSeriesMetric = z.object({
  value: z.number(),
  denominator: z.number().optional(),
  ci: z.tuple([z.number(), z.number()]).optional(),
  ciAdjusted: z.tuple([z.number(), z.number()]).optional(),
  expected: z.number().optional(),
  risk: z.tuple([z.number(), z.number()]).optional(),
  riskType: z.enum(["relative", "absolute"]).optional(),
  stats: z
    .object({
      users: z.number(),
      count: z.number(),
      stddev: z.number(),
      mean: z.number(),
    })
    .optional(),
  pValue: z.number().optional(),
  pValueAdjusted: z.number().optional(),
  uplift: z
    .object({
      dist: z.string(),
      mean: z.number().optional(),
      stddev: z.number().optional(),
    })
    .optional(),
  chanceToWin: z.number().optional(),
  errorMessage: z.string().nullish(),
});
export type ExperimentTimeSeriesMetric = z.infer<
  typeof experimentTimeSeriesMetric
>;

const experimentTimeSeriesVariation = z.object({
  id: z.string(),
  name: z.string(),
  absoluteData: experimentTimeSeriesMetric.optional(),
  relativeData: experimentTimeSeriesMetric.optional(),
  scaledData: experimentTimeSeriesMetric.optional(),
});
export type ExperimentTimeSeriesVariation = z.infer<
  typeof experimentTimeSeriesVariation
>;

export const experimentTimeSeries = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),

    experiment: z.string(),
    phase: z.number(),

    results: z.array(
      z.object({
        snapshotId: z.string(),
        analysisDate: z.date(),
        settingsHash: z.string(),

        // Keyed by metricId
        metrics: z.record(
          z.string(),
          z.object({
            metricSettingsHash: z.string(),
            variations: z.array(experimentTimeSeriesVariation),
          })
        ),
      })
    ),
  })
  .strict();
export type ExperimentTimeSeries = z.infer<typeof experimentTimeSeries>;

export const createExperimentTimeSeries = experimentTimeSeries.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});
export type CreateExperimentTimeSeries = z.infer<
  typeof createExperimentTimeSeries
>;
