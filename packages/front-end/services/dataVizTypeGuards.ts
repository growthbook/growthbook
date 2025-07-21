import {
  DataVizConfig,
  xAxisConfiguration,
  dimensionAxisConfiguration,
} from "back-end/src/validators/saved-queries";

/**
 * Type guard to check if a DataVizConfig requires an xAxis
 * Only chart types other than "big-value" require an xAxis
 */
export function requiresXAxis(
  config: Partial<DataVizConfig>
): config is Partial<DataVizConfig> & { xAxis?: xAxisConfiguration } {
  return config.chartType !== "big-value";
}

/**
 * Type guard to check if a DataVizConfig requires dimensions
 * Only chart types other than "big-value" support dimensions
 */
export function supportsDimension(
  config: Partial<DataVizConfig>
): config is Partial<DataVizConfig> & {
  dimension?: dimensionAxisConfiguration[];
} {
  return config.chartType !== "big-value";
}
