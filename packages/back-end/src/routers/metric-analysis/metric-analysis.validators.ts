import { z } from "zod";
import { queryPointerValidator } from "back-end/src/validators/queries";
import { customMetricSlice } from "back-end/src/validators/experiments";

export const metricAnalysisPopulationTypeValidator = z.enum([
  "metric",
  "factTable",
  "exposureQuery",
  "population",
  "segment",
]);

export const metricAnalysisSourceValidator = z.enum(["metric", "northstar"]);

export const metricAnalysisSettingsValidator = z
  .object({
    userIdType: z.string(),

    startDate: z.date(),
    endDate: z.date(),
    lookbackDays: z.number(),

    populationType: metricAnalysisPopulationTypeValidator,
    populationId: z.string().nullable(),
    metricAutoSlices: z.array(z.string()).optional(),
    customMetricSlices: z.array(customMetricSlice).optional(),
    // pinnedMetricSlices: z.array(z.string()).nullable(), - This is the shape of the data for exp analysis
    //MKTODO: Add metricSliceIds: z.array(z.string()).optional(),
    //MKTODO: Add customMetricSlices: z.array(z.string()).optional(), - this needs to be a custom type, an array of key value pairs (e.g. column: "country", value: "US", column: "product_type", value: "apparel")
    additionalNumeratorFilters: z.array(z.string()).optional(), // We can pass in adhoc filters for an analysis that don't live on the metric itself
    additionalDenominatorFilters: z.array(z.string()).optional(), // We can pass in adhoc filters for an analysis that don't live on the metric itself
  })
  .strict();
export const metricAnalysisSettingsStringDatesValidator =
  metricAnalysisSettingsValidator
    .omit({ startDate: true, endDate: true })
    .extend({ startDate: z.string(), endDate: z.string() })
    .strict();

export const createMetricAnalysisPropsValidator = z
  .object({
    id: z.string(),
    userIdType: z.string(),
    lookbackDays: z.number(),
    startDate: z.string(),
    endDate: z.string(),
    populationType: metricAnalysisPopulationTypeValidator,
    populationId: z.string().nullable(),
    source: metricAnalysisSourceValidator,
    force: z.boolean().optional(),
    additionalNumeratorFilters: z.array(z.string()).optional(),
    additionalDenominatorFilters: z.array(z.string()).optional(),
    metricAutoSlices: z.array(z.string()).optional(),
    customMetricSlices: z.array(customMetricSlice).optional(),
  })
  .strict();

export const metricAnalysisHistogramValidator = z.array(
  z
    .object({
      start: z.number(),
      end: z.number(),
      units: z.number(),
    })
    .strict(),
);

export const metricAnalysisResultValidator = z
  .object({
    units: z.number(),
    mean: z.number(),
    stddev: z.number().optional(),
    numerator: z.number().optional(),
    denominator: z.number().optional(),
    dates: z
      .array(
        z.object({
          date: z.date(),
          units: z.number(),
          mean: z.number(),
          stddev: z.number().optional(),
          numerator: z.number().optional(),
          denominator: z.number().optional(),
          // Per-slice metrics for this date (supports multi-dimension slices)
          slices: z
            .array(
              z
                .object({
                  slice: z.record(z.string(), z.string().nullable()).optional(), // Map of column -> value for slices
                  units: z.number(),
                  mean: z.number(),
                  stddev: z.number().optional(),
                  numerator: z.number().optional(),
                  denominator: z.number().optional(),
                })
                .strict(),
            )
            .optional(),
        }),
      )
      .optional(),
    histogram: metricAnalysisHistogramValidator.optional(),
    // Overall per-slice aggregates (including their own date series and histogram)
    slices: z
      .array(
        z
          .object({
            slice: z.record(z.string(), z.string().nullable()), // Map of column -> value
            units: z.number(),
            mean: z.number(),
            stddev: z.number().optional(),
            numerator: z.number().optional(),
            denominator: z.number().optional(),
            dates: z
              .array(
                z
                  .object({
                    date: z.date(),
                    units: z.number(),
                    mean: z.number(),
                    stddev: z.number().optional(),
                    numerator: z.number().optional(),
                    denominator: z.number().optional(),
                  })
                  .strict(),
              )
              .optional(),
            histogram: metricAnalysisHistogramValidator.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const metricAnalysisInterfaceValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    metric: z.string(),
    error: z.string().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    runStarted: z.date().nullable(),
    status: z.string(),
    result: metricAnalysisResultValidator.optional(),
    settings: metricAnalysisSettingsValidator,
    queries: z.array(queryPointerValidator),
    source: metricAnalysisSourceValidator.optional(),
  })
  .strict();
