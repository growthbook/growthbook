import { z } from "zod";
import { CreateProps, UpdateProps } from "back-end/types/models";

const axisConfigurationValidator = z.object({
  fieldName: z.string(),
  type: z.enum(["string", "number", "date"]),
  aggregation: z.enum(["none", "sum", "count", "average"]),
  sort: z.enum(["none", "asc", "desc"]),
});
export type AxisConfiguration = z.infer<typeof axisConfigurationValidator>;

export const dataVizConfigValidator = z.object({
  xAxis: axisConfigurationValidator,
  yAxis: z.array(axisConfigurationValidator).nonempty(),
  chartType: z.enum(["bar", "line", "area", "scatter"]),
  dimension: z
    .array(
      axisConfigurationValidator.extend({
        display: z.enum(["grouped", "stacked"]),
      })
    )
    .nonempty()
    .optional(),
});

export const testQueryRowSchema = z.record(z.any());

export const queryExecutionResultValidator = z.object({
  results: z.array(testQueryRowSchema),
  error: z.string().optional(),
  duration: z.number().optional(),
  sql: z.string().optional(),
});

export const savedQueryValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    datasourceId: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    dateLastRan: z.date(),
    sql: z.string(),
    dataVizConfig: z.array(dataVizConfigValidator).optional(),
    results: queryExecutionResultValidator,
  })
  .strict();
export type SavedQuery = z.infer<typeof savedQueryValidator>;
export type SavedQueryCreateProps = CreateProps<SavedQuery>;
export type SavedQueryUpdateProps = UpdateProps<SavedQuery>;
export type DataVizConfig = z.infer<typeof dataVizConfigValidator>;
export type QueryExecutionResult = z.infer<
  typeof queryExecutionResultValidator
>;
