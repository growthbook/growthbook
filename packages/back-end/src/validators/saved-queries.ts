import { z } from "zod";
import { CreateProps, UpdateProps } from "back-end/types/models";

const dateAggregationEnum = z.enum([
  "none",
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
]);

const xAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  type: z.enum(["string", "number", "date"]),
  sort: z.enum(["none", "asc", "desc", "valueAsc", "valueDesc"]),
  dateAggregationUnit: dateAggregationEnum.optional(),
});
export type xAxisDateAggregationUnit = z.infer<typeof dateAggregationEnum>;
export type xAxisConfiguration = z.infer<typeof xAxisConfigurationValidator>;

const aggregationEnum = z.enum([
  "none",
  "min",
  "max",
  "first",
  "last",
  "sum",
  "count",
  "countDistinct",
  "average",
]);

const yAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  type: z.enum(["string", "number", "date"]),
  aggregation: aggregationEnum,
});
export type yAxisConfiguration = z.infer<typeof yAxisConfigurationValidator>;
export type yAxisAggregationType = z.infer<typeof aggregationEnum>;

const dimensionAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  display: z.enum(["grouped", "stacked"]),
  maxValues: z.number().optional(),
});
export type dimensionAxisConfiguration = z.infer<
  typeof dimensionAxisConfigurationValidator
>;

const filterConfigurationValidator = z.object({
  column: z.string(),
  type: z.enum(["number", "date"]),
  operator: z.enum(["between"]),
  value: z.any(),
});

export type FilterConfiguration = z.infer<typeof filterConfigurationValidator>;

export const dataVizConfigValidator = z.object({
  title: z.string().optional(),
  chartType: z.enum(["bar", "line", "area", "scatter"]),
  xAxis: xAxisConfigurationValidator,
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  dimension: z.array(dimensionAxisConfigurationValidator).nonempty().optional(),
  // I think we should support multiple filters, but for now, just supporting one
  filter: z.array(filterConfigurationValidator).optional(),
  // filter: z.object({
  //   fieldName: z.string(),
  //   operator: z.enum(["=", "!=", ">", "<", ">=", "<=", "between"]),
  // }),
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
    linkedDashboardIds: z.array(z.string()).optional(),
  })
  .strict();

export type SavedQuery = z.infer<typeof savedQueryValidator>;
export type SavedQueryCreateProps = CreateProps<SavedQuery>;
export type SavedQueryUpdateProps = UpdateProps<SavedQuery>;
export type DataVizConfig = z.infer<typeof dataVizConfigValidator>;
export type QueryExecutionResult = z.infer<
  typeof queryExecutionResultValidator
>;
