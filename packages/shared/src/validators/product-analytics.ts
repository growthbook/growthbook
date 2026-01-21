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

const factTableDatasetValidator = z
  .object({
    type: z.literal("fact_table"),
    factTableId: z.string(),
    values: z.array(
      z.object({
        valueType: z.enum(valueType),
        valueColumn: z.string().nullable(),
        unit: z.string().nullable(),
        rowFilters: z.array(rowFilterValidator),
      }),
    ),
  })
  .strict();

const sqlDatasetValidator = z
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

const dynamicDimensionValidator = z.object({
  dimensionType: z.literal("dynamic"),
  column: z.string(),
  maxValues: z.number(),
});

const staticDimensionValidator = z.object({
  dimensionType: z.literal("static"),
  column: z.string(),
  values: z.array(z.string()),
});

const sliceDimensionValidator = z.object({
  dimensionType: z.literal("slice"),
  slices: z.array(
    z.object({
      name: z.string(),
      filters: z.array(rowFilterValidator),
    }),
  ),
});

const dimensionValidator = z.discriminatedUnion("dimensionType", [
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

const dateGranularity = [
  "auto",
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;

const lookbackUnit = ["hour", "day", "week", "month"] as const;

export const productAnalyticsExplorerValidator = z
  .object({
    dataset: datasetValidator.nullable(),
    xAxis: z.object({
      column: z.string(),
      dateGranularity: z.enum(dateGranularity).nullable(),
    }),
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
