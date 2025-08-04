import {
  DataVizConfig,
  BarChart,
  LineChart,
  AreaChart,
  ScatterChart,
  BigValueChart,
} from "back-end/src/validators/saved-queries";

/**
 * Type guard to check if a DataVizConfig requires an xAxis
 */
export function requiresXAxis(
  config: Partial<DataVizConfig>
): config is Partial<BarChart | LineChart | AreaChart | ScatterChart> {
  return (
    config.chartType === "bar" ||
    config.chartType === "line" ||
    config.chartType === "area" ||
    config.chartType === "scatter"
  );
}

/**
 * Type guard to check if a DataVizConfig requires a yAxis
 */
export function requiresYAxis(config: Partial<DataVizConfig>): boolean {
  return !!config.chartType; // All chart types require yAxis
}

/**
 * Type guard to check if a DataVizConfig supports dimensions
 */
export function supportsDimension(
  config: Partial<DataVizConfig>
): config is Partial<BarChart | LineChart | AreaChart | ScatterChart> {
  return requiresXAxis(config);
}

/**
 * Type guard to check if a DataVizConfig only requires y-axis (no x-axis)
 */
export function requiresOnlyYAxis(
  config: Partial<DataVizConfig>
): config is Partial<BigValueChart> {
  return config.chartType === "big-value";
}
