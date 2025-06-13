import { z } from "zod";
import { CreateProps, UpdateProps } from "back-end/types/models";

const xAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  type: z.enum(["string", "number", "date"]),
  sort: z.enum(["none", "asc", "desc"]),
});
export type xAxisConfiguration = z.infer<typeof xAxisConfigurationValidator>;

const yAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  aggregation: z.enum(["none", "sum", "count", "average"]),
});
export type yAxisConfiguration = z.infer<typeof yAxisConfigurationValidator>;

const dimensionAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  display: z.enum(["grouped", "stacked"]),
  sort: z.enum(["none", "asc", "desc"]),
});
export type dimensionAxisConfiguration = z.infer<
  typeof dimensionAxisConfigurationValidator
>;

export const dataVizConfigValidator = z.object({
  chartType: z.enum(["bar", "line", "area", "scatter"]),
  xAxis: xAxisConfigurationValidator,
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  dimension: z.array(dimensionAxisConfigurationValidator).nonempty().optional(),
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
