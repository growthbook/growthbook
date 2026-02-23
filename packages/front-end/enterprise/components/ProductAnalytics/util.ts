import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
  RowFilter,
} from "shared/types/fact-table";
import type {
  MetricValue,
  FactTableValue,
  DatabaseValue,
  ProductAnalyticsValue,
  DatasetType,
  ProductAnalyticsDataset,
  ProductAnalyticsConfig,
} from "shared/validators";
import { isEqual } from "lodash";

export const VALUE_TYPE_OPTIONS: {
  value: "unit_count" | "count" | "sum";
  label: string;
}[] = [
  { value: "count", label: "Row count" },
  { value: "unit_count", label: "Unit count" },
  { value: "sum", label: "Sum" },
];

const COMMON_TIMESTAMP_COLUMNS = new Set([
  "timestamp",
  "created_at",
  "updated_at",
  "event_time",
  "time",
  "datetime",
  "date",
  "event_timestamp",
  "ts",
  "event_date",
]);

export function getValueTypeLabel(
  valueType: "count" | "unit_count" | "sum",
): string {
  return (
    VALUE_TYPE_OPTIONS.find((o) => o.value === valueType)?.label ?? valueType
  );
}

export function createEmptyValue(type: DatasetType): ProductAnalyticsValue {
  const base = {
    name: "",
    rowFilters: [],
  };
  switch (type) {
    case "metric":
      return {
        ...base,
        name: generateUniqueValueName("Metric", []),
        type: "metric",
        metricId: "",
        unit: null,
        denominatorUnit: null,
      } as MetricValue;
    case "fact_table":
      return {
        ...base,
        name: "Count",
        type: "fact_table",
        valueType: "count",
        valueColumn: null,
        unit: null,
      } as FactTableValue;
    case "data_source":
      return {
        ...base,
        name: "Count",
        type: "data_source",
        valueType: "count",
        valueColumn: null,
        unit: null,
      } as DatabaseValue;
    default:
      throw new Error(`Invalid dataset type: ${type}`);
  }
}

export function generateUniqueValueName(
  baseName: string,
  existingValues: ProductAnalyticsValue[],
): string {
  if (!baseName) return "";

  const existingNames = new Set(existingValues.map((v) => v.name));

  // If base name doesn't exist, use it as-is (no number)
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  // If base name exists, start incrementing from 1
  let i = 1;
  while (existingNames.has(`${baseName} ${i}`)) {
    i++;
  }

  return `${baseName} ${i}`;
}

export function createEmptyDataset(
  type: DatasetType,
  datasource?: string,
): ProductAnalyticsDataset {
  if (type === "metric") {
    return { type, values: [] };
  } else if (type === "fact_table") {
    return { type, values: [], factTableId: null };
  } else if (type === "data_source") {
    return {
      type,
      values: [],
      datasource: datasource ?? "",
      table: "",
      path: "",
      timestampColumn: "",
      columnTypes: {},
    };
  } else {
    throw new Error(`Invalid dataset type: ${type}`);
  }
}

export function getCommonColumns(
  dataset: ProductAnalyticsDataset | null,
  getFactTableById: (id: string) => FactTableInterface | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): Pick<ColumnInterface, "column" | "name">[] {
  if (!dataset || !dataset.values || dataset.values.length === 0) return [];

  type SimpleColumn = Pick<ColumnInterface, "column" | "name" | "deleted">;
  let columns: SimpleColumn[] | null = null;

  if (dataset.type === "fact_table") {
    const ft = getFactTableById(dataset.factTableId || "");
    columns = ft?.columns || [];
  } else if (dataset.type === "metric") {
    for (const value of dataset.values) {
      const metricId = value.metricId;
      let valueColumns: SimpleColumn[] = [];

      const factMetric = getFactMetricById(metricId);
      if (factMetric) {
        const ft = getFactTableById(factMetric.numerator.factTableId);
        valueColumns = ft?.columns || [];
      }

      if (columns === null) {
        columns = valueColumns;
      } else {
        // Intersect by column name
        const valueColumnNames = new Set(valueColumns.map((c) => c.column));
        columns = columns.filter((c) => valueColumnNames.has(c.column));
      }
    }
  } else if (dataset.type === "data_source") {
    columns = Object.keys(dataset.columnTypes).map((name) => ({
      column: name,
      name,
      deleted: false,
    }));
  }

  return (columns || [])
    .filter((c) => !c.deleted)
    .sort((a, b) => (a.name || a.column).localeCompare(b.name || b.column))
    .map((c) => ({ column: c.column, name: c.name }));
}

export function getMaxDimensions(dataset: ProductAnalyticsDataset): number {
  let maxDimensions = 2;
  if (dataset.values.length > 1) {
    maxDimensions -= 1;
  }
  return maxDimensions;
}

export function mapDatabaseTypeToEnum(
  dbType: string,
): "string" | "number" | "date" | "boolean" | "other" {
  const lowerType = dbType.toLowerCase();

  // Numbers
  if (
    lowerType.includes("int") ||
    lowerType.includes("numeric") ||
    lowerType.includes("decimal") ||
    lowerType.includes("float") ||
    lowerType.includes("double") ||
    lowerType.includes("real")
  ) {
    return "number";
  }

  // Dates
  if (lowerType.includes("date") || lowerType.includes("time")) {
    return "date";
  }

  // Booleans
  if (lowerType.includes("bool")) {
    return "boolean";
  }

  // Strings (varchar, char, text, etc.)
  if (
    lowerType.includes("char") ||
    lowerType.includes("text") ||
    lowerType.includes("string")
  ) {
    return "string";
  }

  // Default to other
  return "other";
}

export function getInferredTimestampColumn(
  columnTypes: Record<string, string>,
): string | null {
  // First priority: Find column with type "date"
  const dateTypedColumn = Object.keys(columnTypes).find(
    (key) => columnTypes[key] === "date",
  );

  if (dateTypedColumn) {
    return dateTypedColumn;
  }

  // Second priority: Check common timestamp column names (case-insensitive)
  const commonNameColumn = Object.keys(columnTypes).find((key) =>
    COMMON_TIMESTAMP_COLUMNS.has(key.toLowerCase()),
  );

  return commonNameColumn || null;
}

/** Ensures that dimensions are valid and within the allowed number of dimensions for the dataset type.
 *  Returns a new config with the allowed dimensions (same config object if no changes were made). */
export function validateDimensions(
  config: ProductAnalyticsConfig,
  getFactTableById: (id: string) => FactTableInterface | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ProductAnalyticsConfig {
  // Validate dimensions against commonColumns
  const columns = getCommonColumns(
    config.dataset,
    getFactTableById,
    getFactMetricById,
  );
  const maxDims = getMaxDimensions(config.dataset);

  let validDimensions = config.dimensions.filter((d) => {
    if (d.dimensionType !== "dynamic") return true;
    return columns.some((c) => c.column === d.column);
  });
  if (validDimensions.length > maxDims) {
    validDimensions = validDimensions.slice(0, maxDims);
  }

  const validatedState =
    validDimensions.length !== config.dimensions.length
      ? { ...config, dimensions: validDimensions }
      : config;

  return validatedState;
}

function hasNonEmptyValues(values: string[] | undefined): boolean {
  return (values ?? []).some((v) => v !== "");
}

/** Checks if a filter is complete (has a column and values). */
function isCompleteFilter(filter: RowFilter): boolean {
  if (filter.operator === "sql_expr" || filter.operator === "saved_filter") {
    return hasNonEmptyValues(filter.values);
  }
  if (
    ["is_true", "is_false", "is_null", "not_null"].includes(filter.operator)
  ) {
    return !!filter.column;
  }
  return !!filter.column && hasNonEmptyValues(filter.values);
}

/** Removes incomplete (partially configured) row filters from a value. */
function cleanRowFilters<T extends ProductAnalyticsValue>(value: T): T {
  return {
    ...value,
    rowFilters: value.rowFilters.filter(isCompleteFilter),
  } as T;
}

/** Removes incomplete (partially configured) inputs (values, filters) from a dataset. (e.g. sum values without a value column) */
export function removeIncompleteInputs(
  dataset: ProductAnalyticsDataset,
): ProductAnalyticsDataset {
  if (dataset.type === "metric") {
    return {
      ...dataset,
      values: dataset.values.filter((v) => v.metricId).map(cleanRowFilters),
    };
  } else if (dataset.type === "fact_table") {
    return {
      ...dataset,
      values: dataset.values
        .filter((v) => {
          if (v.valueType === "count" || v.valueType === "unit_count") {
            return true;
          }
          return !!v.valueColumn;
        })
        .map(cleanRowFilters),
    };
  } else if (dataset.type === "data_source") {
    return {
      ...dataset,
      values: dataset.values
        .filter((v) => {
          if (v.valueType === "count" || v.valueType === "unit_count") {
            return true;
          }
          return !!v.valueColumn;
        })
        .map(cleanRowFilters),
    };
  }
  return dataset;
}

/** Prepares a config for submission by removing incomplete inputs (values, filters) from the dataset. */
export function cleanConfigForSubmission(
  config: ProductAnalyticsConfig,
): ProductAnalyticsConfig {
  const cleanedDataset = removeIncompleteInputs(config.dataset);
  return {
    ...config,
    dataset: cleanedDataset,
  };
}

const TIMESERIES_CHART_TYPES: Set<string> = new Set([
  "line",
  "area",
  "timeseries-table",
]);
const CUMULATIVE_CHART_TYPES: Set<string> = new Set([
  "bar",
  "horizontalBar",
  "bigNumber",
  "table",
]);

/** Returns the category of a chart type (timeseries or cumulative).
 *  Used to determine if a fetch or local update is needed. */
function getChartCategory(
  chartType: ProductAnalyticsConfig["chartType"],
): string {
  if (CUMULATIVE_CHART_TYPES.has(chartType)) return "cumulative";
  if (TIMESERIES_CHART_TYPES.has(chartType)) return "timeseries";
  throw new Error(`Invalid chart type: ${chartType}`);
}

/** Strips fields that only affect rendering, not data fetching. */
function toFetchKey(config: ProductAnalyticsConfig): unknown {
  return {
    ...config,
    chartType: getChartCategory(config.chartType),
    dataset: {
      ...config.dataset,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      values: config.dataset.values.map(({ name, ...rest }) => rest),
    },
  };
}

/** Checks if a config is minimally complete in order to be submitted
 *  metrics just need at least 1 value
 *  fact tables just need a fact table id
 *  data sources just need a datasource, table, and timestamp column
 */
export function isSubmittableConfig(
  cleanedConfig: ProductAnalyticsConfig,
): boolean {
  if (cleanedConfig.dataset.values.length === 0) return false;
  if (
    cleanedConfig.dataset.type == "fact_table" &&
    cleanedConfig.dataset.factTableId === null
  )
    return false;

  if (
    cleanedConfig.dataset.type === "data_source" &&
    (!cleanedConfig.dataset.datasource ||
      !cleanedConfig.dataset.table ||
      !cleanedConfig.dataset.timestampColumn)
  )
    return false;

  if (
    cleanedConfig.dateRange.predefined === "customDateRange" &&
    (!cleanedConfig.dateRange.startDate || !cleanedConfig.dateRange.endDate)
  ) {
    return false;
  }

  return true;
}

/** Compares two configs and determines if a fetch or local update is needed. */
export function compareConfig(
  lastSubmittedConfig: ProductAnalyticsConfig | null,
  newConfig: ProductAnalyticsConfig,
): { needsFetch: boolean; needsUpdate: boolean } {
  if (!lastSubmittedConfig) {
    const hasValues = newConfig.dataset.values.length > 0;
    return { needsFetch: hasValues, needsUpdate: hasValues };
  }

  if (isEqual(lastSubmittedConfig, newConfig)) {
    return { needsFetch: false, needsUpdate: false };
  }

  const needsFetch = !isEqual(
    toFetchKey(lastSubmittedConfig),
    toFetchKey(newConfig),
  );
  return { needsFetch, needsUpdate: true };
}
