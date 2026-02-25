import { z } from "zod";
import { queryPointerValidator } from "./queries";
import { rowFilterValidator } from "./fact-table";

const baseValueValidator = z.object({
  name: z.string(),
  rowFilters: z.array(rowFilterValidator),
});

// Metrics
const metricValueValidator = baseValueValidator.extend({
  type: z.literal("metric"),
  metricId: z.string(),
  unit: z.string().nullable(),
  denominatorUnit: z.string().nullable(),
});
export type MetricValue = z.infer<typeof metricValueValidator>;

export type DatasetType = "metric" | "fact_table" | "data_source";

const metricDatasetValidator = z
  .object({
    type: z.literal("metric"),
    values: z.array(metricValueValidator),
  })
  .strict();

// Fact Tables
const valueType = ["unit_count", "count", "sum"] as const;

const factTableValueValidator = baseValueValidator.extend({
  type: z.literal("fact_table"),
  valueType: z.enum(valueType),
  valueColumn: z.string().nullable(),
  unit: z.string().nullable(),
});
export type FactTableValue = z.infer<typeof factTableValueValidator>;

const factTableDatasetValidator = z
  .object({
    type: z.literal("fact_table"),
    factTableId: z.string().nullable(),
    values: z.array(factTableValueValidator),
  })
  .strict();

// Database
const databaseValueValidator = baseValueValidator.extend({
  type: z.literal("data_source"),
  valueType: z.enum(valueType),
  valueColumn: z.string().nullable(),
  unit: z.string().nullable(),
});
export type DatabaseValue = z.infer<typeof databaseValueValidator>;

const databaseDatasetValidator = z
  .object({
    type: z.literal("data_source"),
    table: z.string(),
    path: z.string(),
    timestampColumn: z.string(),
    columnTypes: z.record(
      z.string(),
      z.enum(["string", "number", "date", "boolean", "other"]),
    ),
    values: z.array(databaseValueValidator),
  })
  .strict();

const datasetValidator = z.discriminatedUnion("type", [
  metricDatasetValidator,
  factTableDatasetValidator,
  databaseDatasetValidator,
]);
export type ProductAnalyticsDataset = z.infer<typeof datasetValidator>;

const _valueValidator = z.discriminatedUnion("type", [
  metricValueValidator,
  factTableValueValidator,
  databaseValueValidator,
]);
export type ProductAnalyticsValue = z.infer<typeof _valueValidator>;

export const dateGranularity = [
  "auto",
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;

export const dateDimensionValidator = z.object({
  dimensionType: z.literal("date"),
  column: z.string().nullable(),
  dateGranularity: z.enum(dateGranularity),
});

export const dynamicDimensionValidator = z.object({
  dimensionType: z.literal("dynamic"),
  column: z.string().nullable(),
  maxValues: z.number(),
});

export const staticDimensionValidator = z.object({
  dimensionType: z.literal("static"),
  column: z.string(),
  values: z.array(z.string()),
});

export const sliceDimensionValidator = z.object({
  dimensionType: z.literal("slice"),
  slices: z.array(
    z.object({
      name: z.string(),
      filters: z.array(rowFilterValidator),
    }),
  ),
});

export const dimensionValidator = z.discriminatedUnion("dimensionType", [
  dateDimensionValidator,
  dynamicDimensionValidator,
  staticDimensionValidator,
  sliceDimensionValidator,
]);

export const chartTypes = [
  "line",
  "area",
  "timeseries-table",
  "table",
  "bar",
  "horizontalBar",
  "bigNumber",
] as const;

export const dateRangePredefined = [
  "today",
  "last7Days",
  "last30Days",
  "last90Days",
  "customLookback",
  "customDateRange",
] as const;

export const lookbackUnit = ["hour", "day", "week", "month"] as const;

// The config defined in the UI
export const productAnalyticsConfigValidator = z
  .object({
    datasource: z.string(),
    dataset: datasetValidator,
    dimensions: z.array(dimensionValidator),
    chartType: z.enum(chartTypes),
    dateRange: z.object({
      predefined: z.enum(dateRangePredefined),
      lookbackValue: z.number().nullable(),
      lookbackUnit: z.enum(lookbackUnit).nullable(),
      startDate: z.coerce.date().nullable(),
      endDate: z.coerce.date().nullable(),
    }),
  })
  .strict();

// For SQL datasets, we need to know the column types
// This is the shape of the response from the warehouse / API
const columnType = ["string", "number", "date", "boolean", "other"] as const;
export const sqlDatasetColumnResponseRowValidator = z.object({
  column: z.string(),
  type: z.enum(columnType),
});
export const sqlDatasetColumnResponseValidator = z.object({
  columns: z.array(sqlDatasetColumnResponseRowValidator),
});

// The shape of the final result data from the warehouse / API
export const productAnalyticsResultRowValidator = z.object({
  dimensions: z.array(z.string().nullable()),
  values: z.array(
    z.object({
      metricId: z.string(),
      numerator: z.number().nullable(),
      denominator: z.number().nullable(),
    }),
  ),
});
export const productAnalyticsResultValidator = z.object({
  rows: z.array(productAnalyticsResultRowValidator),
  statistics: z.record(z.string(), z.unknown()).optional(),
  sql: z.string().optional(),
  error: z.string().nullable().optional(),
});

export const productAnalyticsExplorationValidator = z.object({
  id: z.string(),
  organization: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  datasource: z.string(),
  configHash: z.string(),
  valueHashes: z.array(z.string()),
  config: productAnalyticsConfigValidator,
  result: productAnalyticsResultValidator,
  dateStart: z.date(),
  dateEnd: z.date(),
  runStarted: z.date().nullable(),
  status: z.enum(["running", "success", "error"]),
  error: z.string().nullable().optional(),
  queries: z.array(queryPointerValidator),
});

export type ProductAnalyticsConfig = z.infer<
  typeof productAnalyticsConfigValidator
>;
export type FactTableDataset = z.infer<typeof factTableDatasetValidator>;
export type DatabaseDataset = z.infer<typeof databaseDatasetValidator>;
export type ProductAnalyticsDimension = z.infer<typeof dimensionValidator>;
export type ProductAnalyticsDynamicDimension = z.infer<
  typeof dynamicDimensionValidator
>;
export type ProductAnalyticsResult = z.infer<
  typeof productAnalyticsResultValidator
>;
export type ProductAnalyticsResultRow = z.infer<
  typeof productAnalyticsResultRowValidator
>;
export type ProductAnalyticsExploration = z.infer<
  typeof productAnalyticsExplorationValidator
>;
