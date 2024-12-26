import { z } from "zod";
import { queryPointerValidator } from "back-end/src/validators/queries";

export const populationDataSourceTypeValidator = z.enum([
"segment", "experiment", "exposureQuery",
]);

export const populationDataStatusValidator = z.enum([
  "running",  "success", "error"
])

export const populationDataMetricDataValidator = z
.object({
  main_sum: z.number(),
  main_sum_squares: z.number(),
  denominator_sum: z.number().optional(),
  denominator_sum_squares: z.number().optional(),
  main_denominator_sum_product: z.number().optional(),
}).strict()

export const populationDataMetricValidator = z
  .object({
    metric: z.string(),
    data: populationDataMetricDataValidator
  }).strict()

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

    sourceType: populationDataSourceTypeValidator,
    sourceId: z.string(),
    userIdType: z.string(),

    // data
    units: z.array(
      z.object({
        week: z.string(),
        count: z.number(),
      })
    ),
    metrics: z.array(populationDataMetricValidator),
  })
  .strict();
