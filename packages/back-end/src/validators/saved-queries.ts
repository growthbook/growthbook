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

const formatEnum = z.enum([
  "shortNumber",
  "longNumber",
  "currency",
  "percentage",
  "accounting",
]);

// Individual chart type validators
const barChartValidator = z.object({
  title: z.string().optional(),
  chartType: z.literal("bar"),
  xAxis: xAxisConfigurationValidator,
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  dimension: z.array(dimensionAxisConfigurationValidator).nonempty().optional(),
});

const lineChartValidator = z.object({
  title: z.string().optional(),
  chartType: z.literal("line"),
  xAxis: xAxisConfigurationValidator,
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  dimension: z.array(dimensionAxisConfigurationValidator).nonempty().optional(),
});

const areaChartValidator = z.object({
  title: z.string().optional(),
  chartType: z.literal("area"),
  xAxis: xAxisConfigurationValidator,
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  dimension: z.array(dimensionAxisConfigurationValidator).nonempty().optional(),
});

const scatterChartValidator = z.object({
  title: z.string().optional(),
  chartType: z.literal("scatter"),
  xAxis: xAxisConfigurationValidator,
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  dimension: z.array(dimensionAxisConfigurationValidator).nonempty().optional(),
});

const bigValueChartValidator = z.object({
  title: z.string().optional(),
  chartType: z.literal("big-value"),
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  format: formatEnum,
});

// Union of all chart type validators
export const dataVizConfigValidator = z.discriminatedUnion("chartType", [
  barChartValidator,
  lineChartValidator,
  areaChartValidator,
  scatterChartValidator,
  bigValueChartValidator,
]);

// Type helpers for better TypeScript inference
export type BarChart = z.infer<typeof barChartValidator>;
export type LineChart = z.infer<typeof lineChartValidator>;
export type AreaChart = z.infer<typeof areaChartValidator>;
export type ScatterChart = z.infer<typeof scatterChartValidator>;
export type BigValueChart = z.infer<typeof bigValueChartValidator>;
export type BigValueFormat = z.infer<typeof formatEnum>;

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
