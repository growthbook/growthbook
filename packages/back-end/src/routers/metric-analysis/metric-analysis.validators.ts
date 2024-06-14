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
    endDate: z.date().nullable(),

    populationType: metricAnalysisPopulationTypeValidator,
    populationId: z.string().nullable(),
  })
  .strict();

export const createMetricAnalysisPropsValidator = z
  .object({
    id: z.string(),
    userIdType: z.string(),
    dimensions: z.array(z.string()),
    startDate: z.string(),
    endDate: z.string(),
    populationType: metricAnalysisPopulationTypeValidator,
    populationId: z.string().optional(),
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
    result: z
      .object({
        count: z.number(),
        mean: z.number(),
        stddev: z.number(),
        dates: z
          .array(
            z.object({
              date: z.date(),
              count: z.number(),
              mean: z.number(),
              stddev: z.number(),
            })
          )
          .optional(),
        histogram: z
          .array(
            z.object({
              start: z.number(),
              end: z.number(),
              count: z.number(),
            })
          )
          .optional(),
      })
      .optional(),
    // TODO better typing here
    settings: metricAnalysisSettingsValidator,
    queries: z.array(queryPointerValidator),
  })
  .strict();
