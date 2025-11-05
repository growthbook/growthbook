import {
  AreaChart,
  BarChart,
  DataVizConfig,
  LineChart,
  ScatterChart,
  xAxisConfiguration,
} from "back-end/src/validators/saved-queries";
import { requiresXAxis } from "./dataVizTypeGuards";

export function getXAxisConfig(
  config: Partial<DataVizConfig>,
): xAxisConfiguration[] {
  if (config.chartType === "pivot-table") {
    return config.xAxes || [];
  }

  if (!requiresXAxis(config)) {
    return [];
  }
  const nonPivot = config as Partial<
    BarChart | LineChart | AreaChart | ScatterChart
  >;
  if (!nonPivot.xAxis) return [];
  return [nonPivot.xAxis];
}

export function setXAxisConfig(
  config: Partial<DataVizConfig>,
  value: xAxisConfiguration | xAxisConfiguration[],
): Partial<DataVizConfig> {
  const valueArray = Array.isArray(value) ? value : [value];

  // For pivot tables, store as array
  if (config.chartType === "pivot-table") {
    return {
      ...config,
      xAxes: valueArray,
    } as Partial<DataVizConfig>;
  }

  // For other chart types, store as single object (first element)
  // If empty array, set to undefined
  return {
    ...config,
    xAxis: valueArray.length > 0 ? valueArray[0] : undefined,
  };
}

export function updateXAxisConfig(
  config: Partial<DataVizConfig>,
  updates: Partial<xAxisConfiguration>,
): Partial<DataVizConfig> {
  const configs = getXAxisConfig(config);
  const current = configs[0];
  if (!current) {
    // If no current config, create a new one with updates
    // This requires a fieldName to be valid, so we'll need to check
    if (!updates.fieldName) {
      return config;
    }
    return setXAxisConfig(config, {
      fieldName: updates.fieldName,
      type: updates.type || "string",
      sort: updates.sort || "none",
      dateAggregationUnit: updates.dateAggregationUnit,
    });
  }

  // Merge updates into current config
  const updated: xAxisConfiguration = {
    ...current,
    ...updates,
  };

  return setXAxisConfig(config, updated);
}
