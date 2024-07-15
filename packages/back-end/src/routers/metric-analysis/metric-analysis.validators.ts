import { count } from "console";
import { start } from "repl";
import { z } from "zod";
import { queryPointerValidator } from "../../validators/queries";

export const metricAnalysisPopulationTypeValidator = z.enum([
  "metric",
  "factTable",
  "exposureQuery",
  "population",
  "segment",
]);

export const metricAnalysisSettingsValidator = z
  .object({
    userIdType: z.string(),
    dimensions: z.array(z.string()),

    startDate: z.date(),
    endDate: z.date(),
    lookbackDays: z.number(),

    populationType: metricAnalysisPopulationTypeValidator,
    populationId: z.string().nullable(),
  })
  .strict();

export const createMetricAnalysisPropsValidator = z
  .object({
    id: z.string(),
    userIdType: z.string(),
    dimensions: z.array(z.string()),
    lookbackDays: z.number(),
    startDate: z.string(),
    endDate: z.string(),
    populationType: metricAnalysisPopulationTypeValidator,
    populationId: z.string().optional(),
  })
  .strict();

export const metricAnalysisHistogramValidator = z.array(
  z
    .object({
      start: z.number(),
      end: z.number(),
      units: z.number(),
    })
    .strict()
);

export const metricAnalysisResultValidator = z
  .object({
    units: z.number(),
    mean: z.number(),
    stddev: z.number().optional(),
    numerator: z.number().optional(),
    denominator: z.number().optional(),
    cappingData: z
      .object({
        cappingValue: z.boolean(),
        unitsCapped: z.number(),
        uncappedHistogram: metricAnalysisHistogramValidator.optional(),
      })
      .optional(),
    dates: z
      .array(
        z.object({
          date: z.date(),
          units: z.number(),
          mean: z.number(),
          stddev: z.number().optional(),
          numerator: z.number().optional(),
          denominator: z.number().optional(),
        })
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
    // TODO better typing here
    settings: metricAnalysisSettingsValidator,
    queries: z.array(queryPointerValidator),
  })
  .strict();
