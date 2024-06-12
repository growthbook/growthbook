import { z } from "zod";
import { queryPointerValidator } from "../../validators/queries";

export const metricAnalysisPopulationTypeValidator = z.enum([
  "metric",
  "experimentunits",
  "population",
  "segment",
]);

export const metricAnalysisSettingsValidator = z
  .object({
    dimensions: z.array(z.string()),

    startDate: z.date(),
    endDate: z.date(),

    populationType: metricAnalysisPopulationTypeValidator,
    population: z.string().nullable(),
  })
  .strict();

export const createMetricAnalysisPropsValidator = z
  .object({
    id: z.string(),
    dimensions: z.array(z.string()),
    segment: z.string().optional(),
    startDate: z.string(),
    endDate: z.string(),
    population: z.string().optional(),
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
    // TODO better typing here
    settings: metricAnalysisSettingsValidator,
    queries: z.array(queryPointerValidator),
  })
  .strict();
