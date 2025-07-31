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

const chartTypesThatRequireXAndYAxis = z.enum([
  "bar",
  "line",
  "area",
  "scatter",
]);
const chartTypesThatRequireOnlyYAxis = z.enum(["big-value"]);

export { chartTypesThatRequireXAndYAxis };
export { chartTypesThatRequireOnlyYAxis };

export type ChartsWithXAndYAxis = z.infer<
  typeof chartTypesThatRequireXAndYAxis
>;
export type ChartsWithOnlyYAxis = z.infer<
  typeof chartTypesThatRequireOnlyYAxis
>;

// Charts that require both x and y axes
const chartWithXAndYAxisValidator = z.object({
  title: z.string().optional(),
  chartType: chartTypesThatRequireXAndYAxis,
  xAxis: xAxisConfigurationValidator,
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  dimension: z.array(dimensionAxisConfigurationValidator).nonempty().optional(),
});

// Charts that only require y-axis (like big-value)
const chartWithOnlyYAxisValidator = z.object({
  title: z.string().optional(),
  chartType: chartTypesThatRequireOnlyYAxis,
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
});

export const dataVizConfigValidator = z.discriminatedUnion("chartType", [
  chartWithXAndYAxisValidator,
  chartWithOnlyYAxisValidator,
]);

// Type helpers for better TypeScript inference
export type ChartWithXAndYAxis = z.infer<typeof chartWithXAndYAxisValidator>;
export type ChartWithOnlyYAxis = z.infer<typeof chartWithOnlyYAxisValidator>;

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
