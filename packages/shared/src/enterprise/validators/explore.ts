// packages/shared/src/enterprise/validators/explore.ts
import { z } from "zod";
import { rowFilterValidator } from "../../validators/fact-table";

// ============================================================================
// Enum Validators & Types
// ============================================================================

export const exploreMetricTypeValidator = z.enum([
  "proportion",
  "quantile",
  "ratio",
  "mean",
]);
export type ExploreMetricType = z.infer<typeof exploreMetricTypeValidator>;

export const exploreValueTypeValidator = z.enum(["unit_count", "count", "sum"]);
export type ExploreValueType = z.infer<typeof exploreValueTypeValidator>;

export const exploreSeriesTypeValidator = z.enum(["metric", "factTable", "sql"]);
export type ExploreSeriesType = z.infer<typeof exploreSeriesTypeValidator>;

export const exploreVisualizationTypeValidator = z.enum([
  "timeseries",
  "bar",
  "bigNumber",
]);
export type ExploreVisualizationType = z.infer<
  typeof exploreVisualizationTypeValidator
>;

export const exploreGranularityValidator = z.enum([
  "day",
  "week",
  "month",
  "year",
]);
export type ExploreGranularity = z.infer<typeof exploreGranularityValidator>;

// ============================================================================
// Series Types
// ============================================================================

export const metricSeriesConfigValidator = z.object({
  factMetricId: z.string(),
  metricType: exploreMetricTypeValidator,
  unit: z.string().optional(),
});

export type MetricSeriesConfig = z.infer<typeof metricSeriesConfigValidator>;

export const factTableSeriesConfigValidator = z.object({
  factTableId: z.string(),
  valueType: exploreValueTypeValidator,
  unit: z.string().optional(),
  valueColumn: z.string().optional(),
});

export type FactTableSeriesConfig = z.infer<typeof factTableSeriesConfigValidator>;

export const sqlSeriesConfigValidator = z.object({
  datasourceId: z.string(),
  sql: z.string(),
});

export type SqlSeriesConfig = z.infer<typeof sqlSeriesConfigValidator>;

// common to all series types
export const exploreSeriesValidator = z.object({
  id: z.string(),
  type: exploreSeriesTypeValidator,
  name: z.string(),
  color: z.string().optional(),
  config: z.union([
    metricSeriesConfigValidator,
    factTableSeriesConfigValidator,
    sqlSeriesConfigValidator,
  ]),
  rowFilters: z.array(rowFilterValidator).optional(),
  groupBy: z.array(z.string()).optional(),
});

export type ExploreSeries = z.infer<typeof exploreSeriesValidator>;

// ============================================================================
// Explore State (what the frontend manages)
// ============================================================================

export const exploreStateValidator = z.object({
  series: z.array(exploreSeriesValidator),
  // timeseries = series
  // bar, bigNumber = cumulative over entire time range
  visualizationType: exploreVisualizationTypeValidator,
  //   startDate: z.date().optional(),
  //   endDate: z.date().optional(),
  lookbackDays: z.number(),
  granularity: exploreGranularityValidator.optional(),
  // global filters and group by
  globalRowFilters: z.array(rowFilterValidator).optional(),
  groupBy: z.array(z.string()).optional(),
});

export type ExploreState = z.infer<typeof exploreStateValidator>;

// ============================================================================
// API Request/Response (what gets sent to backend)
// ============================================================================

// export const exploreQueryRequestValidator = exploreStateValidator.extend({
//   // Backend might need additional context
//   datasourceId: z.string().optional(),
// });

export type ExploreQueryRequest = z.infer<typeof exploreSeriesValidator>;