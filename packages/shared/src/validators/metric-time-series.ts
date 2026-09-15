import { z } from "zod";
import { DistributiveOmit } from "shared/util";

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

const metricTimeSeriesBaseSchema = z
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

const metricTimeSeriesMainSchema = metricTimeSeriesBaseSchema
  .extend({
    dimensionId: z.undefined().optional(),
    dimensionValue: z.undefined().optional(),
  })
  .strict();

const metricDimensionTimeSeriesSchema = metricTimeSeriesBaseSchema
  .extend({
    dimensionId: z.string().min(1),
    // NB: Empty strings are valid for the dimension value
    dimensionValue: z.string(),
  })
  .strict();

export const metricTimeSeriesSchema = z.union([
  metricTimeSeriesMainSchema,
  metricDimensionTimeSeriesSchema,
]);

export type MetricTimeSeries = z.infer<typeof metricTimeSeriesSchema>;

// BaseModel needs an object schema so it can derive create/update validators
// from `.shape`
export const metricTimeSeriesBaseModelSchema = metricTimeSeriesBaseSchema
  .extend({
    dimensionId: z.string().min(1).optional(),
    dimensionValue: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasDimensionId = value.dimensionId !== undefined;
    const hasDimensionValue = value.dimensionValue !== undefined;

    if (hasDimensionId === hasDimensionValue) return;

    const missingField = hasDimensionId ? "dimensionValue" : "dimensionId";
    ctx.addIssue({
      code: "custom",
      message: "dimensionId and dimensionValue must be provided together",
      path: [missingField],
    });
  });

export type CreateMetricTimeSeries = DistributiveOmit<
  MetricTimeSeries,
  "id" | "organization" | "dateCreated" | "dateUpdated"
>;

export const metricTimeSeriesStripSchema = z.union([
  metricTimeSeriesMainSchema.strip(),
  metricDimensionTimeSeriesSchema.strip(),
]);

export type CreateMetricTimeSeriesSingleDataPoint =
  CreateMetricTimeSeries extends infer T
    ? T extends unknown
      ? Omit<T, "dataPoints"> & {
          singleDataPoint: MetricTimeSeriesDataPoint;
        }
      : never
    : never;
