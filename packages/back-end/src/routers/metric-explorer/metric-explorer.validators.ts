import { z } from "zod";
import {
  queryPointerValidator,
  queryStatusValidator,
} from "back-end/src/validators/queries";

export const metricExplorerFilterInlineValidator = z
  .object({
    filterType: z.literal("inline"),
    column: z.string(),
    operator: z.enum(["in", "not in", "contains", "gt", "gte", "lt", "lte"]),
    value: z.string(),
    values: z.array(z.string()),
  })
  .strict();

export const metricExplorerFilterSavedValidator = z
  .object({
    filterType: z.literal("saved"),
    id: z.string(),
  })
  .strict();

export const metricExplorerFilterValidator = z.union([
  metricExplorerFilterInlineValidator,
  metricExplorerFilterSavedValidator,
]);

export const metricExplorerMetricValidator = z
  .object({
    id: z.string(),
  })
  .strict();

export const metricExplorerConfigValidator = z
  .object({
    datasource: z.string(),
    factTable: z.string(),
    metrics: z.array(metricExplorerMetricValidator),
    dimension: z.string().nullable(),
    filters: z.array(metricExplorerFilterValidator),
    dateRange: z.enum(["last30d", "last7d", "last24h", "custom"]),
    dateGranularity: z.enum(["1hour", "6hours", "1day"]),
    customDateRange: z.object({ start: z.date(), end: z.date() }).nullable(),
    aggregationType: z.enum(["date", "dimension"]),
    visualizationType: z.enum(["timeseries", "bar"]),
  })
  .strict();

export const metricExplorerCachedResult = z
  .object({
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    id: z.string(),
    datasource: z.string(),
    metricIds: z.array(z.string()),
    aggregationType: z.enum(["date", "dimension"]),
    config: metricExplorerConfigValidator,
    runStarted: z.date().nullable(),
    status: queryStatusValidator,
    error: z.string().optional(),
    queries: z.array(queryPointerValidator),
    result: z.array(z.record(z.unknown())).optional(),
  })
  .strict();
