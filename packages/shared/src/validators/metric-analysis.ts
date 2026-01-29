import { z } from "zod";
import { queryPointerValidator } from "./queries";

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
    granularity: z.enum(["day", "week", "month", "year"]).default("day"),
    groupBy: z.array(z.string()).optional(),

    populationType: metricAnalysisPopulationTypeValidator,
    populationId: z.string().nullable(),
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
        }),
      )
      .optional(),
    histogram: metricAnalysisHistogramValidator.optional(),
    groups: z
      .array(
        z.object({
          group: z.string(),
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
              }),
            )
            .optional(),
        }),
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
