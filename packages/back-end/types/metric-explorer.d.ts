import { z } from "zod";
import {
  metricExplorerConfigValidator,
  metricExplorerFilterInlineValidator,
  metricExplorerFilterSavedValidator,
  metricExplorerFilterValidator,
  metricExplorerMetricValidator,
  metricExplorerCachedResult,
} from "back-end/src/routers/metric-explorer/metric-explorer.validators";

export type MetricExplorerConfig = z.infer<
  typeof metricExplorerConfigValidator
>;
export type MetricExplorerMetric = z.infer<
  typeof metricExplorerMetricValidator
>;
export type MetricExplorerFilter = z.infer<
  typeof metricExplorerFilterValidator
>;
export type MetricExplorerFilterInline = z.infer<
  typeof metricExplorerFilterInlineValidator
>;
export type MetricExplorerFilterSaved = z.infer<
  typeof metricExplorerFilterSavedValidator
>;
export type MetricExplorerCachedResult = z.infer<
  typeof metricExplorerCachedResult
>;
