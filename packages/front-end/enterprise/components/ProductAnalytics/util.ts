import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
  RowFilter,
} from "shared/types/fact-table";
import type {
  MetricValue,
  FactTableValue,
  DataSourceValue,
  ProductAnalyticsValue,
  DatasetType,
  ExplorationDataset,
  ExplorationConfig,
  ProductAnalyticsResultRow,
  ShowAs,
} from "shared/validators";
import { isEqual } from "lodash";
import { createParser } from "nuqs";
import {
  encodeExplorationConfig,
  calculateProductAnalyticsDateRange,
  getDateGranularity,
  mapDatabaseTypeToEnum,
  getMetricMixClass,
  getEffectiveMetricValue,
} from "shared/enterprise";
export {
  getMetricMixClass,
  inferShowAs,
  getEffectiveShowAs,
  clearInapplicableShowAs,
  getEffectiveMetricValue,
  getSharedUnit,
  showAsAppliesTo,
  getIsRatioByIndex,
  buildExplorationColumns,
  getExplorationCellValue,
} from "shared/enterprise";
export type { MetricMixClass, ExplorationColumn } from "shared/enterprise";
import { dateGranularity, explorationConfigValidator } from "shared/validators";

export { mapDatabaseTypeToEnum };

export const PA_AI_CHAT_INITIAL_MESSAGE_KEY = "pa-ai-chat-initial-message";
export const PA_AI_CHAT_INITIAL_MODEL_KEY = "pa-ai-chat-initial-model";

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
      } as DataSourceValue;
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

export function createEmptyDataset(type: DatasetType): ExplorationDataset {
  if (type === "metric") {
    return { type, values: [] };
  } else if (type === "fact_table") {
    return { type, values: [], factTableId: null };
  } else if (type === "data_source") {
    return {
      type,
      values: [],
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
  dataset: ExplorationDataset | null,
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

export function getMaxDimensions(dataset: ExplorationDataset): number {
  let maxDimensions = 2;
  if (dataset.values.length > 1) {
    maxDimensions -= 1;
  }
  return maxDimensions;
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

/** Date range shape with resolved start/end dates. */
export interface ResolvedDateRange {
  startDate: Date;
  endDate: Date;
}

/** Get valid date granularities for a date range (for filtering dropdown options).
 * A granularity is valid if getDateGranularity returns it unchanged (or for "auto", always valid). */
export function getValidDateGranularities(
  dateRange: ResolvedDateRange,
): (typeof dateGranularity)[number][] {
  return dateGranularity.filter(
    (g) => g === "auto" || getDateGranularity(g, dateRange) === g,
  );
}

/** Ensures that dimensions are valid and within the allowed number of dimensions for the dataset type.
 *  Returns a new config with the allowed dimensions (same config object if no changes were made). */
export function validateDimensions(
  config: ExplorationConfig,
  getFactTableById: (id: string) => FactTableInterface | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ExplorationConfig {
  const columns = getCommonColumns(
    config.dataset,
    getFactTableById,
    getFactMetricById,
  );
  const maxDims = getMaxDimensions(config.dataset);

  let validDimensions = config.dimensions.filter((d) => {
    if (d.dimensionType !== "dynamic") return true;
    if (columns.length === 0) return true;
    return columns.some((c) => c.column === d.column || d.column === null);
  });
  if (validDimensions.length > maxDims) {
    validDimensions = validDimensions.slice(0, maxDims);
  }

  // Reset date granularity to "auto" when invalid for the selected date range
  const dateRange = calculateProductAnalyticsDateRange(config.dateRange);
  const validGranularities = getValidDateGranularities(dateRange);
  validDimensions = validDimensions.map((d) => {
    if (d.dimensionType !== "date") return d;
    if (validGranularities.includes(d.dateGranularity)) return d;
    return { ...d, dateGranularity: "auto" as const };
  });

  return !isEqual(validDimensions, config.dimensions)
    ? { ...config, dimensions: validDimensions }
    : config;
}

/**
 * Fills in a default `unit` for metric values that have a resolved metric but
 * no unit selected. Defaults to the numerator fact table's first userIdType.
 *
 * Without a unit, the SQL layer doesn't emit a denominator column, which breaks
 * the per_unit branch of the showAs toggle and silently degrades ratio-like
 * metrics. Applied when loading a config from any source (URL, AI agent, saved
 * exploration) so users don't end up in that state.
 *
 * Skips:
 * - fact_table / data_source datasets (their unit semantics are user-driven).
 * - Metric values whose unit is already set.
 * - Metric values whose metricId is empty or can't be resolved.
 * - Metrics whose fact table has no userIdTypes (nothing to default to).
 */
export function fillMissingUnits(
  config: ExplorationConfig,
  getFactTableById: (id: string) => FactTableInterface | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ExplorationConfig {
  if (!config.dataset || config.dataset.type !== "metric") return config;

  let changed = false;
  const newValues = config.dataset.values.map((v) => {
    if (v.unit || !v.metricId) return v;
    const metric = getFactMetricById(v.metricId);
    if (!metric) return v;
    const factTable = getFactTableById(metric.numerator.factTableId);
    const defaultUnit = factTable?.userIdTypes?.[0];
    if (!defaultUnit) return v;
    changed = true;
    return { ...v, unit: defaultUnit };
  });

  if (!changed) return config;
  return {
    ...config,
    dataset: { ...config.dataset, values: newValues },
  } as ExplorationConfig;
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
  dataset: ExplorationDataset,
): ExplorationDataset {
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
  config: ExplorationConfig,
): ExplorationConfig {
  const cleanedDataset = removeIncompleteInputs(config.dataset);
  const cleanedDimensions = config.dimensions.filter((d) => {
    if (d.dimensionType === "date" || d.dimensionType === "slice") return true;
    return "column" in d && d.column !== null;
  });
  return {
    ...config,
    dataset: cleanedDataset,
    dimensions: cleanedDimensions,
  } as ExplorationConfig;
}

const TIMESERIES_CHART_TYPES: Set<string> = new Set([
  "line",
  "area",
  "timeseries-table",
]);
const CUMULATIVE_CHART_TYPES: Set<string> = new Set([
  "bar",
  "stackedBar",
  "stackedHorizontalBar",
  "horizontalBar",
  "bigNumber",
  "table",
]);

/** Returns the category of a chart type (timeseries or cumulative).
 *  Used to determine if a fetch or local update is needed. */
function getChartCategory(chartType: ExplorationConfig["chartType"]): string {
  if (CUMULATIVE_CHART_TYPES.has(chartType)) return "cumulative";
  if (TIMESERIES_CHART_TYPES.has(chartType)) return "timeseries";
  throw new Error(`Invalid chart type: ${chartType}`);
}

/** Strips fields that only affect rendering, not data fetching. */
function toFetchKey(config: ExplorationConfig): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { showAs, ...rest } = config;
  return {
    ...rest,
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
export function isSubmittableConfig(cleanedConfig: ExplorationConfig): boolean {
  if (!cleanedConfig?.dataset || !Array.isArray(cleanedConfig.dataset.values)) {
    return false;
  }

  if (cleanedConfig.dataset.values.length === 0) return false;
  if (
    cleanedConfig.dataset.type == "fact_table" &&
    cleanedConfig.dataset.factTableId === null
  )
    return false;

  if (
    cleanedConfig.dataset.type === "data_source" &&
    (!cleanedConfig.dataset.table || !cleanedConfig.dataset.timestampColumn)
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
  lastSubmittedConfig: ExplorationConfig | null,
  newConfig: ExplorationConfig,
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

export function getRefreshInterval(elapsedSeconds: number): number {
  if (elapsedSeconds < 60) return 10_000; // 0-59s: update every 10s
  if (elapsedSeconds < 3600) return 60_000; // 1-59m: update every 60s
  if (elapsedSeconds < 86400) return 300_000; // 1-23h: update every 5m
  return 900_000; // 24h+: update every 15m
}

export function shouldChartSectionShow(params: {
  loading: boolean;
  error: string | null;
  submittedExploreState: ExplorationConfig | null;
}): boolean {
  const { loading, error, submittedExploreState } = params;

  // Chart returns null when there's an error and we have SQL (error shown elsewhere)
  if (!loading && error) return false;

  // Chart renders empty box for table-only types; table view handles display
  if (
    submittedExploreState &&
    ["table", "timeseries-table"].includes(
      submittedExploreState.chartType ?? "",
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Given the other already-selected metrics in the dataset (excluding the slot
 * being edited), return the class any newly selected metric must match — or
 * null if any class is allowed.
 *
 * Unknown/unselected slots are ignored.
 */
export function getLockedMixClass(
  otherMetricTypes: (string | null | undefined)[],
): "ratio" | "quantile" | "standard" | null {
  for (const t of otherMetricTypes) {
    const c = getMetricMixClass(t);
    if (c !== "unknown") return c;
  }
  return null;
}

export interface RenderOpts {
  showAs: ShowAs;
  // Indexed by the metric value's position in the dataset.values array.
  // Ratio metrics always render as numerator/denominator regardless of showAs.
  isRatioByIndex: boolean[];
}

function getRowTotal(row: ProductAnalyticsResultRow, opts: RenderOpts): number {
  return row.values.reduce(
    (sum, v, i) =>
      sum +
      getEffectiveMetricValue(v, {
        showAs: opts.showAs,
        isRatio: opts.isRatioByIndex[i] ?? false,
      }),
    0,
  );
}

/** Compute the sum of all metric values grouped by a specific dimension index. */
export function computeDimensionTotals(
  rows: ProductAnalyticsResultRow[],
  dimIndex: number,
  opts: RenderOpts,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const key = row.dimensions[dimIndex] ?? "";
    totals[key] = (totals[key] ?? 0) + getRowTotal(row, opts);
  }
  return totals;
}

/** Compute the sum of all metric values grouped by the "group key" (all dimensions after the first). */
export function computeGroupTotals(
  rows: ProductAnalyticsResultRow[],
  opts: RenderOpts,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const key = row.dimensions.slice(1).join(" - ");
    totals[key] = (totals[key] ?? 0) + getRowTotal(row, opts);
  }
  return totals;
}

export type DecodeConfigResult =
  | { config: ExplorationConfig; error: null }
  | { config: null; error: string };

export function decodeExplorationConfig(encoded: string): DecodeConfigResult {
  try {
    const parsed = JSON.parse(decodeURIComponent(atob(encoded)));
    const config = explorationConfigValidator.parse(parsed);
    return { config, error: null };
  } catch {
    return {
      config: null,
      error: "The URL contains an invalid or outdated explorer configuration.",
    };
  }
}

export const explorationConfigParser = createParser<ExplorationConfig>({
  parse: (raw) => {
    const result = decodeExplorationConfig(raw);
    return result.config;
  },
  serialize: (config) => encodeExplorationConfig(config),
});

/**
 * Sort exploration result rows to match the visual ordering of the chart.
 * - Timeseries: chronological by first dimension (date), then by group total descending.
 * - Bar/cumulative: by first-dimension total descending, then by group total descending.
 */
export function sortExplorationRows(
  rows: ProductAnalyticsResultRow[],
  isTimeseries: boolean,
  opts: RenderOpts,
): ProductAnalyticsResultRow[] {
  if (rows.length === 0) return rows;

  const dim0Totals = computeDimensionTotals(rows, 0, opts);
  const groupTotals = computeGroupTotals(rows, opts);

  return [...rows].sort((a, b) => {
    const dim0A = a.dimensions[0] ?? "";
    const dim0B = b.dimensions[0] ?? "";

    if (dim0A !== dim0B) {
      if (isTimeseries) {
        return new Date(dim0A).getTime() - new Date(dim0B).getTime();
      }
      return (dim0Totals[dim0B] ?? 0) - (dim0Totals[dim0A] ?? 0);
    }

    const groupA = a.dimensions.slice(1).join(" - ");
    const groupB = b.dimensions.slice(1).join(" - ");
    return (groupTotals[groupB] ?? 0) - (groupTotals[groupA] ?? 0);
  });
}
