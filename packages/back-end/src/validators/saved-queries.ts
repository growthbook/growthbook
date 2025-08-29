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

const filterConfigurationValidator = z.union([
  // Date filters
  z.object({
    column: z.string(),
    type: z.literal("date"),
    filterType: z.literal("dateRange"),
    config: z
      .object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .refine((data) => data.startDate || data.endDate, {
        message: "At least one of startDate or endDate is required",
      }),
  }),
  z.object({
    column: z.string(),
    type: z.literal("date"),
    filterType: z.enum(["today", "last7Days", "last30Days"]),
    config: z.object({}).optional(), // No config needed
  }),

  // Number filters
  z.object({
    column: z.string(),
    type: z.literal("number"),
    filterType: z.literal("numberRange"),
    config: z
      .object({
        min: z.union([z.string(), z.number()]).optional(),
        max: z.union([z.string(), z.number()]).optional(),
      })
      .refine((data) => data.min !== undefined || data.max !== undefined, {
        message: "At least one of min or max is required",
      }),
  }),
  z.object({
    column: z.string(),
    type: z.literal("number"),
    filterType: z.enum([
      "greaterThan",
      "lessThan",
      "equalTo",
      "greaterThanOrEqualTo",
      "lessThanOrEqualTo",
    ]),
    config: z.object({
      value: z.union([z.string(), z.number()]),
    }),
  }),

  // String filters
  z.object({
    column: z.string(),
    type: z.literal("string"),
    filterType: z.literal("contains"),
    config: z.object({
      value: z.string(),
    }),
  }),
  z.object({
    column: z.string(),
    type: z.literal("string"),
    filterType: z.literal("includes"),
    config: z.object({
      values: z.array(z.string()),
    }),
  }),
]);

export type FilterConfiguration = z.infer<typeof filterConfigurationValidator>;

const formatEnum = z.enum([
  "shortNumber",
  "longNumber",
  "currency",
  "percentage",
  "accounting",
]);

// Base chart components for composition
const baseChartConfig = z.object({
  title: z.string().optional(),
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  filters: z.array(filterConfigurationValidator).optional(),
});

const withXAxis = z.object({
  xAxis: xAxisConfigurationValidator,
});

const withDimensions = z.object({
  dimension: z.array(dimensionAxisConfigurationValidator).nonempty().optional(),
});

const withFormat = z.object({
  format: formatEnum,
});

// Chart type definitions using composition
const barChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("bar") }))
  .merge(withXAxis)
  .merge(withDimensions);

const lineChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("line") }))
  .merge(withXAxis)
  .merge(withDimensions);

const areaChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("area") }))
  .merge(withXAxis)
  .merge(withDimensions);

const scatterChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("scatter") }))
  .merge(withXAxis)
  .merge(withDimensions);

const bigValueChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("big-value") }))
  .merge(withFormat);

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
