import { z } from "zod";

const metricTimeSeriesValue = z
  .object({
    value: z.number(),
    denominator: z.number().optional(),
    expected: z.number().optional(),
    ci: z
      .tuple([
        z.number().or(z.literal(-Infinity)),
        z.number().or(z.literal(Infinity)),
      ])
      .optional(),
    pValue: z.number().optional(),
    pValueAdjusted: z.number().optional(),
    chanceToWin: z.number().optional(),
  })
  .strict();
export type MetricTimeSeriesValue = z.infer<typeof metricTimeSeriesValue>;

const metricTimeSeriesVariation = z.object({
  id: z.string(),
  name: z.string(),
  // Moved higher in the tree as it is the same for all analysis types
  stats: z
    .object({
      users: z.number(),
      mean: z.number(),
      stddev: z.number(),
    })
    .optional(),
  relative: metricTimeSeriesValue.optional(),
  absolute: metricTimeSeriesValue.optional(),
  scaled: metricTimeSeriesValue.optional(),
});
export type MetricTimeSeriesVariation = z.infer<
  typeof metricTimeSeriesVariation
>;

const metricTimeSeriesDataPointTag = z.enum([
  "triggered-alert",
  "metric-settings-changed",
  "experiment-settings-changed",
]);
export type MetricTimeSeriesDataPointTag = z.infer<
  typeof metricTimeSeriesDataPointTag
>;

const metricTimeSeriesDataPoint = z.object({
  date: z.date(),
  variations: z.array(metricTimeSeriesVariation),
  tags: z.array(metricTimeSeriesDataPointTag).optional(),
});
export type MetricTimeSeriesDataPoint = z.infer<
  typeof metricTimeSeriesDataPoint
>;

export const metricTimeSeriesSchema = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),

    metricId: z.string(),
    source: z.enum(["experiment", "safe-rollout"]),
    sourceId: z.string(),
    sourcePhase: z.number().optional(),

    lastExperimentSettingsHash: z.string(),
    lastMetricSettingsHash: z.string(),
    dataPoints: z.array(metricTimeSeriesDataPoint),
  })
  .strict();
export type MetricTimeSeries = z.infer<typeof metricTimeSeriesSchema>;

const createMetricTimeSeries = metricTimeSeriesSchema.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});
export type CreateMetricTimeSeries = z.infer<typeof createMetricTimeSeries>;

const createMetricTimeSeriesSingleDataPoint = createMetricTimeSeries
  .omit({
    dataPoints: true,
  })
  .extend({
    singleDataPoint: metricTimeSeriesDataPoint,
  });
export type CreateMetricTimeSeriesSingleDataPoint = z.infer<
  typeof createMetricTimeSeriesSingleDataPoint
>;
