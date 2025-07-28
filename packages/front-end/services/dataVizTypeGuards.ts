import {
  chartTypesThatRequireOnlyYAxis,
  chartTypesThatRequireXAndYAxis,
  ChartWithOnlyYAxis,
  ChartWithXAndYAxis,
  DataVizConfig,
} from "back-end/src/validators/saved-queries";

/**
 * Type guard to check if a DataVizConfig requires an xAxis
 * Uses the discriminated union to provide better type inference
 */
export function requiresXAxis(
  config: Partial<DataVizConfig>
): config is Partial<ChartWithXAndYAxis> {
  return config.chartType
    ? chartTypesThatRequireXAndYAxis.safeParse(config.chartType).success
    : false;
}

/**
 * Type guard to check if a DataVizConfig only requires y-axis (no x-axis)
 * Uses the discriminated union to provide better type inference
 */
export function requiresOnlyYAxis(
  config: Partial<DataVizConfig>
): config is Partial<ChartWithOnlyYAxis> {
  return config.chartType
    ? chartTypesThatRequireOnlyYAxis.safeParse(config.chartType).success
    : false;
}

/**
 * Type guard to check if a DataVizConfig supports dimensions
 * Only chart types with axes support dimensions
 */
export function supportsDimension(
  config: Partial<DataVizConfig>
): config is Partial<ChartWithXAndYAxis> {
  return requiresXAxis(config);
}
