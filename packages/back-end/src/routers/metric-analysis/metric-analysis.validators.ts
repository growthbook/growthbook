import { z } from "zod";
import { queryPointerValidator } from "back-end/src/validators/queries";

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
    // filters: z.array(z.string()).optional(), // This is where we can pass in adhoc filters (by id)
    // inlineFilters: z.array(z.object({})).optional(), // This is where we can pass in adhoc filters (by object) - we'll need to define this shape
    //MKTODO: Can I add a validator for filterId?
    //MKTODO: What about adhoc filtering - can I add a validator to take in an actual filter obj?
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
    numeratorFilters: z.array(z.string()).optional(),
    denominatorFilters: z.array(z.string()).optional(),
    // inlineFilters: z.array(z.object({})).optional(),
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
