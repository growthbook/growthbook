import { z } from "zod";
import { rowFilterValidator } from "./fact-table";
import { withExtendedDimensions, withXAxes } from "./saved-queries";

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

const chartTypes = ["bar", "line", "area", "table"] as const;

const dateRangePredefined = [
  "today",
  "last7Days",
  "last30Days",
  "last90Days",
  "custom",
] as const;

const productAnalyticsExplorerValidator = z
  .object({
    dataset: datasetValidator.nullable(),
    ...withExtendedDimensions.shape,
    ...withXAxes.shape,
    chartType: z.enum(chartTypes),
    dateRange: z.object({
      predefined: z.enum(dateRangePredefined),
      startDate: z.date().nullable(),
      endDate: z.date().nullable(),
    }),
  })
  .strict();
