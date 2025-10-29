import {
  DataVizConfig,
  xAxisConfiguration,
} from "back-end/src/validators/saved-queries";
import { requiresXAxis } from "./dataVizTypeGuards";

export function getXAxisConfig(
  config: Partial<DataVizConfig>,
): xAxisConfiguration[] {
  if (!requiresXAxis(config) || !config.xAxis) {
    return [];
  }

  // If it's already an array, return it
  if (Array.isArray(config.xAxis)) {
    return config.xAxis;
  }

  // Otherwise, normalize single object to array
  return [config.xAxis as xAxisConfiguration];
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
      xAxis: valueArray,
    } as Partial<DataVizConfig>;
  }

  // For other chart types, store as single object (first element)
  // If empty array, set to undefined
  return {
    ...config,
    xAxis: valueArray.length > 0 ? valueArray[0] : undefined,
  } as Partial<DataVizConfig>;
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
