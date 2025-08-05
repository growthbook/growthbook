import {
  DataVizConfig,
  BarChart,
  LineChart,
  AreaChart,
  ScatterChart,
  requiresXAxis as requiresXAxisForChartType,
  supportsDimensions as supportsDimensionsForChartType,
} from "back-end/src/validators/saved-queries";

/**
 * Type guard to check if a DataVizConfig requires an xAxis
 * Uses schema introspection to determine requirements automatically
 */
export function requiresXAxis(
  config: Partial<DataVizConfig>
): config is Partial<BarChart | LineChart | AreaChart | ScatterChart> {
  return config.chartType ? requiresXAxisForChartType(config.chartType) : false;
}

/**
 * Type guard to check if a DataVizConfig supports dimensions
 * Uses schema introspection to determine support automatically
 */
export function supportsDimension(
  config: Partial<DataVizConfig>
): config is Partial<BarChart | LineChart | AreaChart | ScatterChart> {
  return config.chartType
    ? supportsDimensionsForChartType(config.chartType)
    : false;
}
