import { z } from "zod";
import { rowFilterValidator } from "./fact-table";

const metricDatasetValidator = z
  .object({
    type: z.literal("metric"),
    values: z.array(
      z.object({
        metricId: z.string(),
        unit: z.string().nullable(),
        denominatorUnit: z.string().nullable(),
        rowFilters: z.array(rowFilterValidator),
      }),
    ),
  })
  .strict();

const valueType = ["unit_count", "count", "sum"] as const;

export const factTableDatasetValidator = z
  .object({
    type: z.literal("fact_table"),
    factTableId: z.string(),
    values: z.array(
      z.object({
        name: z.string(),
        valueType: z.enum(valueType),
        valueColumn: z.string().nullable(),
        unit: z.string().nullable(),
        rowFilters: z.array(rowFilterValidator),
      }),
    ),
  })
  .strict();

export const sqlDatasetValidator = z
  .object({
    type: z.literal("sql"),
    datasource: z.string(),
    sql: z.string(),
    timestampColumn: z.string(),
    columnTypes: z.record(
      z.string(),
      z.enum(["string", "number", "date", "boolean", "other"]),
    ),
    values: z.array(
      z.object({
        name: z.string(),
        valueType: z.enum(valueType),
        valueColumn: z.string().nullable(),
        unit: z.string().nullable(),
        rowFilters: z.array(rowFilterValidator),
      }),
    ),
  })
  .strict();

const datasetValidator = z.discriminatedUnion("type", [
  metricDatasetValidator,
  factTableDatasetValidator,
  sqlDatasetValidator,
]);

const dateGranularity = [
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
  column: z.string(),
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

const chartTypes = ["bar", "line", "area", "table"] as const;

const dateRangePredefined = [
  "today",
  "last7Days",
  "last30Days",
  "last90Days",
  "customLookback",
  "customDateRange",
] as const;

const lookbackUnit = ["hour", "day", "week", "month"] as const;

// The config defined in the UI
export const productAnalyticsConfigValidator = z
  .object({
    dataset: datasetValidator.nullable(),
    dimensions: z.array(dimensionValidator),
    chartType: z.enum(chartTypes),
    dateRange: z.object({
      predefined: z.enum(dateRangePredefined),
      lookbackValue: z.number().nullable(),
      lookbackUnit: z.enum(lookbackUnit).nullable(),
      startDate: z.date().nullable(),
      endDate: z.date().nullable(),
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
  dimensions: z.array(z.string()),
  values: z.array(
    z.object({
      metricId: z.string(),
      value: z.number(),
      denominator: z.number().nullable(),
    }),
  ),
});
export const productAnalyticsResultValidator = z.object({
  rows: z.array(productAnalyticsResultRowValidator),
});

export type ProductAnalyticsConfig = z.infer<
  typeof productAnalyticsConfigValidator
>;
export type FactTableDataset = z.infer<typeof factTableDatasetValidator>;
export type SqlDataset = z.infer<typeof sqlDatasetValidator>;
export type ProductAnalyticsDimension = z.infer<typeof dimensionValidator>;
export type ProductAnalyticsDynamicDimension = z.infer<
  typeof dynamicDimensionValidator
>;

// SQL helper functions interface
export interface SqlHelpers {
  escapeStringLiteral: (s: string) => string;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  evalBoolean: (col: string, value: boolean) => string;
  dateTrunc: (
    column: string,
    granularity: "hour" | "day" | "week" | "month" | "year",
  ) => string;
  percentileApprox: (column: string, percentile: number) => string;
  toTimestamp: (date: Date) => string;
}
