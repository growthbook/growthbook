import { z } from "zod";

const metricTimeSeriesTag = z.enum([
  "triggered-alert",
  "metric-settings-changed",
  "experiment-settings-changed",
]);
export type MetricTimeSeriesTag = z.infer<typeof metricTimeSeriesTag>;

export const metricTimeSeriesDataPoint = z
  .object({
    value: z.number(),
    denominator: z.number().optional(),
    expected: z.number().optional(),
    ci: z.tuple([z.number(), z.number()]).optional(),
    stats: z
      .object({
        users: z.number(),
        mean: z.number(),
        stddev: z.number(),
      })
      .optional(),
    pValue: z.number().optional(),
    pValueAdjusted: z.number().optional(),
    chanceToWin: z.number().optional(),
  })
  .strict();
export type MetricTimeSeriesDataPoint = z.infer<
  typeof metricTimeSeriesDataPoint
>;

const metricTimeSeriesVariation = z.object({
  name: z.string(),
  relative: metricTimeSeriesDataPoint.optional(),
  absolute: metricTimeSeriesDataPoint.optional(),
  scaled: metricTimeSeriesDataPoint.optional(),
});
export type MetricTimeSeriesVariation = z.infer<
  typeof metricTimeSeriesVariation
>;

export const metricTimeSeries = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),

    metricId: z.string(),
    source: z.enum(["experiment"]),
    sourceId: z.string(),

    lastSettingsHash: z.string(),

    dataPoints: z.array(
      z.object({
        date: z.date(),
        variations: z.array(metricTimeSeriesVariation),
        tags: z.array(metricTimeSeriesTag).optional(),
      })
    ),
  })
  .strict();
export type MetricTimeSeries = z.infer<typeof metricTimeSeries>;

export const createMetricTimeSeries = metricTimeSeries.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});
export type CreateMetricTimeSeries = z.infer<typeof createMetricTimeSeries>;
