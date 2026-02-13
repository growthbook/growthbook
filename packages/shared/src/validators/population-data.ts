import { z } from "zod";
import { queryPointerValidator } from "./queries.js";

export const populationDataSourceTypeValidator = z.enum([
  "segment",
  "factTable",
]);

export const populationDataStatusValidator = z.enum([
  "running",
  "success",
  "error",
]);

export const createPopulationDataPropsValidator = z
  .object({
    metricIds: z.array(z.string()),
    datasourceId: z.string(),
    sourceType: populationDataSourceTypeValidator,
    sourceId: z.string(),
    userIdType: z.string(),
    force: z.boolean(),
  })
  .strict();

export const populationDataMetricDataValidator = z
  .object({
    main_sum: z.number(),
    main_sum_squares: z.number(),
    denominator_sum: z.number().optional(),
    denominator_sum_squares: z.number().optional(),
    main_denominator_sum_product: z.number().optional(),
    count: z.number(),
  })
  .strict();

export const populationDataMetricValidator = z
  .object({
    metricId: z.string(),
    type: z.enum(["mean", "ratio", "binomial"]),
    data: populationDataMetricDataValidator,
  })
  .strict();

export const populationDataInterfaceValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    // projects?

    // queries and management
    queries: z.array(queryPointerValidator),
    error: z.string().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    runStarted: z.date().nullable(),
    status: populationDataStatusValidator,

    // settings
    startDate: z.date(),
    endDate: z.date(),

    datasourceId: z.string(),
    sourceType: populationDataSourceTypeValidator,
    sourceId: z.string(),
    userIdType: z.string(),

    // data
    units: z.array(
      z.object({
        week: z.string(),
        count: z.number(),
      }),
    ),
    metrics: z.array(populationDataMetricValidator),
  })
  .strict();
