import { z } from "zod";
import { CreateProps, UpdateProps } from "back-end/types/models";

export const dataVizConfigValidator = z.object({
  chartType: z.enum(["bar", "line", "pie", "scatter", "area", "donut"]),
  xAxis: z.string(),
  yAxis: z.string(),
  // TODO: Make specific types depending on chart type
  aggregation: z.enum(["stacked", "grouped"]).optional(),
  aggregationAxis: z.string().optional(),
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
