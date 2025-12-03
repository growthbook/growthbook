import {
  AreaChart,
  BarChart,
  DataVizConfig,
  LineChart,
  ScatterChart,
  dimensionAxisConfiguration,
  xAxisConfiguration,
} from "back-end/src/validators/saved-queries";
import {
  blue,
  teal,
  orange,
  pink,
  amber,
  mint,
  lime,
  cyan,
  red,
  indigo,
  purple,
} from "@radix-ui/colors";
import { requiresXAxis, supportsDimension } from "./dataVizTypeGuards";

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

// Not all chart types support stacked dimensions, so this function ensures only bar and area can have a "stacked" display
export function normalizeDimensionsForChartType(
  config: Partial<DataVizConfig>,
): Partial<DataVizConfig> {
  if (supportsDimension(config)) {
    // No need to normalize if there are no dimensions
    if (!config.dimension) {
      return config;
    }

    // If display is stacked, and chart type isn't bar or area, we need to reset the display to grouped
    const needsNormalization =
      (config.dimension as dimensionAxisConfiguration[]).some(
        (dim) => dim.display === "stacked",
      ) &&
      config.chartType !== "bar" &&
      config.chartType !== "area";

    if (!needsNormalization) {
      return config;
    }

    // Set display to grouped for all dimensions
    const normalizedDimensions = config.dimension.map((dim) => ({
      ...dim,
      display: "grouped" as const,
    }));

    return {
      ...config,
      dimension: normalizedDimensions,
    } as Partial<DataVizConfig>;
  } else {
    return {
      ...config,
      dimension: undefined,
    } as Partial<DataVizConfig>;
  }
}

// Most distinct colors first - these are prioritized when we have fewer dimensions
// to avoid similar colors like green/lime or indigo/purple appearing together
const distinctPalette = [
  blue.blue8,
  teal.teal10,
  orange.orange10,
  pink.pink10,
  amber.amber10,
  red.red10,
];

// Similar/fallback colors - only used when we need more than 6 dimensions
const fallbackPalette = [
  indigo.indigo10,
  purple.purple10,
  cyan.cyan10,
  mint.mint10,
  lime.lime11,
];

// Full palette for when we have more than 6 dimensions
const fullPalette = [...distinctPalette, ...fallbackPalette];

function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // convert to 32-bit
  }
  return Math.abs(hash);
}

//  Assigns unique colors to dimension/slice keys, prioritizing distinct colors
//  when there are fewer items to avoid similar colors appearing together.
export function assignColorsToKeys(keys: string[]): Map<string, string> {
  const colorMap = new Map<string, string>();
  const totalKeys = keys.length;

  // Sort keys deterministically to ensure consistent color assignment
  const sortedKeys = [...keys].sort();

  // Choose which palette to use based on number of keys
  const palette =
    totalKeys <= distinctPalette.length ? distinctPalette : fullPalette;

  // Use hash of first key to determine starting offset for deterministic but varied assignment
  const startOffset =
    sortedKeys.length > 0 ? hashStringToInt(sortedKeys[0]) % palette.length : 0;

  // Assign colors sequentially from the offset, ensuring uniqueness
  sortedKeys.forEach((key, index) => {
    const colorIndex = (startOffset + index) % palette.length;
    colorMap.set(key, palette[colorIndex]);
  });

  return colorMap;
}
