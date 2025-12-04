import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";

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

const baseDimensionAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  display: z.enum(["grouped"]),
  maxValues: z.number().optional(),
});
export type baseDimensionAxisConfiguration = z.infer<
  typeof baseDimensionAxisConfigurationValidator
>;

const extendedDimensionAxisConfigurationValidator =
  baseDimensionAxisConfigurationValidator.extend({
    display: z.enum(["stacked", "grouped"]),
  });
export type extendedDimensionAxisConfiguration = z.infer<
  typeof extendedDimensionAxisConfigurationValidator
>;

// Union type for all dimension axis configurations
export type dimensionAxisConfiguration =
  | baseDimensionAxisConfiguration
  | extendedDimensionAxisConfiguration;

const filterConfigurationValidator = z.union([
  // Date filters
  z.object({
    column: z.string(),
    columnType: z.literal("date"),
    filterMethod: z.literal("dateRange"),
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
    columnType: z.literal("date"),
    filterMethod: z.enum(["today", "last7Days", "last30Days"]),
    config: z.object({}).optional(), // No config needed
  }),

  // Number filters
  z.object({
    column: z.string(),
    columnType: z.literal("number"),
    filterMethod: z.literal("numberRange"),
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
    columnType: z.literal("number"),
    filterMethod: z.enum([
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
    columnType: z.literal("string"),
    filterMethod: z.literal("contains"),
    config: z.object({
      value: z.string(),
    }),
  }),
  z.object({
    column: z.string(),
    columnType: z.literal("string"),
    filterMethod: z.literal("includes"),
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
  id: z.string().optional(), // UUID for referencing in blockConfig - optional as this was added after the initial release
  title: z.string().optional(),
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  filters: z.array(filterConfigurationValidator).optional(),
});

const withXAxis = z.object({
  xAxis: xAxisConfigurationValidator,
});

const withXAxes = z.object({
  xAxes: z.array(xAxisConfigurationValidator).nonempty(),
});

const withBaseDimensions = z.object({
  dimension: z
    .array(baseDimensionAxisConfigurationValidator)
    .nonempty()
    .optional(),
});

const withExtendedDimensions = z.object({
  dimension: z
    .array(extendedDimensionAxisConfigurationValidator)
    .nonempty()
    .optional(),
});

const withFormat = z.object({
  format: formatEnum,
});

// Chart type definitions using composition
const barChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("bar") }))
  .merge(withXAxis)
  .merge(withExtendedDimensions);

const lineChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("line") }))
  .merge(withXAxis)
  .merge(withBaseDimensions);

const areaChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("area") }))
  .merge(withXAxis)
  .merge(withExtendedDimensions);

const scatterChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("scatter") }))
  .merge(withXAxis)
  .merge(withBaseDimensions);

const bigValueChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("big-value") }))
  .merge(withFormat);

const pivotTableValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("pivot-table") }))
  .merge(withXAxes)
  .merge(withBaseDimensions);

// Union of all chart type validators
export const dataVizConfigValidator = z.discriminatedUnion("chartType", [
  barChartValidator,
  lineChartValidator,
  areaChartValidator,
  scatterChartValidator,
  bigValueChartValidator,
  pivotTableValidator,
]);

// Type helpers for better TypeScript inference
export type BarChart = z.infer<typeof barChartValidator>;
export type LineChart = z.infer<typeof lineChartValidator>;
export type AreaChart = z.infer<typeof areaChartValidator>;
export type ScatterChart = z.infer<typeof scatterChartValidator>;
export type BigValueChart = z.infer<typeof bigValueChartValidator>;
export type BigValueFormat = z.infer<typeof formatEnum>;
export type PivotTable = z.infer<typeof pivotTableValidator>;

export const testQueryRowSchema = z.record(z.string(), z.any());

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
