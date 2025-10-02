import {
  AreaChart,
  BarChart,
  DataVizConfig,
  LineChart,
  PivotTable,
  ScatterChart,
} from "back-end/src/validators/saved-queries";

/**
 * Type guard to check if a DataVizConfig requires an xAxis
 */
export function requiresXAxis(
  config: Partial<DataVizConfig>,
): config is Partial<
  BarChart | LineChart | AreaChart | ScatterChart | PivotTable
> {
  return (
    config.chartType === "bar" ||
    config.chartType === "line" ||
    config.chartType === "area" ||
    config.chartType === "scatter" ||
    config.chartType === "pivot-table"
  );
}

/**
 * Type guard to check if a DataVizConfig supports dimensions
 */
export function supportsDimension(
  config: Partial<DataVizConfig>,
): config is Partial<BarChart | LineChart | AreaChart | ScatterChart> {
  return requiresXAxis(config);
}
