import {
  ColumnInterface,
  FactMetricInterface,
  FactTableDefinition,
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
  FunnelStep,
  FunnelDataset,
  ExplorationDateRange,
} from "shared/validators";
import { isEqual } from "lodash";
import { createParser } from "nuqs";
import { canInlineFilterColumn } from "shared/experiments";
import {
  encodeExplorationConfig,
  calculateProductAnalyticsDateRange,
  getDateGranularity,
  mapDatabaseTypeToEnum,
  getMetricMixClass,
} from "shared/enterprise";
export {
  getMetricMixClass,
  getEffectiveShowAs,
  clearInapplicableShowAs,
  getEffectiveMetricValue,
  getSharedUnit,
  showAsAppliesTo,
  getIsRatioByIndex,
  buildExplorationColumns,
  getExplorationCellValue,
  computeDimensionTotals,
  sortExplorationRows,
} from "shared/enterprise";
export type { MetricMixClass, ExplorationColumn } from "shared/enterprise";
export type RenderOpts = import("shared/enterprise").ExplorationRenderOpts;

/** Explorer UI state: exploration config plus optional compare period (not on public API config). */
export type ExplorerDraftConfig = ExplorationConfig & {
  previousTimeFrame?: ExplorationDateRange;
};

export function stripExplorerDraftFields(
  config: ExplorerDraftConfig,
): ExplorationConfig {
  const { previousTimeFrame: _, ...rest } = config;
  return rest;
}
import {
  dateGranularity,
  explorationConfigValidator,
  explorationDateRangeValidator,
} from "shared/validators";
import { operatorLabelMap } from "@/components/FactTables/rowFilterUtils";

export { mapDatabaseTypeToEnum };

export const PA_AI_CHAT_INITIAL_MESSAGE_KEY = "pa-ai-chat-initial-message";
export const PA_AI_CHAT_INITIAL_MODEL_KEY = "pa-ai-chat-initial-model";

// Backoff (ms) for polling a still-running exploration, mirroring the shared
// RunQueriesButton cadence (2s → 20s). Returns 0 to stop after ~10 min.
// Shared by the Explorer (ExplorerContext) and dashboard tiles.
export function explorationPollDelayMs(elapsedSec: number): number {
  if (elapsedSec < 10) return 2000;
  if (elapsedSec < 30) return 3000;
  if (elapsedSec < 60) return 5000;
  if (elapsedSec < 300) return 10000;
  if (elapsedSec < 600) return 20000;
  return 0;
}

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

/** Returns rowFilters with empty placeholder entries appended for every
 *  fact-table column that has `alwaysInlineFilter` enabled and isn't already
 *  represented in the existing filters. Mirrors the behavior used when
 *  authoring fact metrics — keeps the explorer consistent with metrics UX. */
export function getInitialInlineFilters(
  factTable: FactTableDefinition,
  existingRowFilters: RowFilter[] = [],
): RowFilter[] {
  const rowFilters = [...existingRowFilters];
  factTable.columns
    .filter(
      (c) => c.alwaysInlineFilter && canInlineFilterColumn(factTable, c.column),
    )
    .forEach((c) => {
      if (!rowFilters.some((rf) => rf.column === c.column)) {
        rowFilters.push({
          column: c.column,
          operator: "=",
          values: [""],
        });
      }
    });
  return rowFilters;
}

/** Returns true if the row filter has enough info to be meaningful in a
 *  preview (would survive cleanRowFilters at submission). */
function isPreviewableFilter(f: RowFilter): boolean {
  if (f.operator === "sql_expr" || f.operator === "saved_filter") {
    return (f.values ?? []).some((v) => v !== "");
  }
  if (["is_true", "is_false", "is_null", "not_null"].includes(f.operator)) {
    return !!f.column;
  }
  return !!f.column && (f.values ?? []).some((v) => v !== "");
}

/** A stable key for a column-based filter — identifies "the same predicate
 *  shape" across steps (same column + same operator; values may differ).
 *  Returns null for sql_expr / saved_filter, which don't carry an obvious
 *  per-step "context" to factor out. */
function filterCommonKey(f: RowFilter): string | null {
  if (f.operator === "sql_expr" || f.operator === "saved_filter") return null;
  if (!f.column) return null;
  return `${f.column}|${f.operator}`;
}

/** Set of (column|operator) keys whose filters appear on every step. We use
 *  this to strip universal context from per-step previews — if every step
 *  filters on `event_name=…`, the column+operator becomes redundant noise
 *  and we render just the matching values instead.
 *
 *  Only meaningful when ≥2 steps exist; with a single step "universal" is
 *  trivially true for everything it has, and stripping would just hide
 *  information that the user typed. */
export function getCommonFunnelFilterKeys(steps: FunnelStep[]): Set<string> {
  if (steps.length < 2) return new Set();
  let candidates: Set<string> | null = null;
  for (const step of steps) {
    const stepKeys = new Set<string>();
    for (const f of step.rowFilters) {
      if (!isPreviewableFilter(f)) continue;
      const key = filterCommonKey(f);
      if (key) stepKeys.add(key);
    }
    if (candidates === null) {
      candidates = stepKeys;
    } else {
      candidates = new Set([...candidates].filter((k) => stepKeys.has(k)));
    }
    if (candidates.size === 0) break;
  }
  return candidates ?? new Set();
}

function formatValuesOnly(filter: RowFilter): string {
  const valueRequired = ![
    "is_true",
    "is_false",
    "is_null",
    "not_null",
  ].includes(filter.operator);
  if (!valueRequired) return ""; // value-less universal filters drop out entirely
  const values = (filter.values ?? []).filter((v) => v !== "");
  return values.length ? values.join(", ") : "…";
}

/** One-line, human-readable summary of a single row filter. Symbol operators
 *  (`=`, `!=`, `<`, `<=`, `>`, `>=`) render with no surrounding whitespace
 *  (e.g. `path=/search`); word operators keep the surrounding spaces. */
export function formatFilterPreview(
  filter: RowFilter,
  factTable: FactTableDefinition | null,
): string {
  if (filter.operator === "sql_expr") return "SQL expr";
  if (filter.operator === "saved_filter") {
    const savedId = filter.values?.[0];
    const saved = factTable?.filters?.find((sf) => sf.id === savedId);
    return saved ? saved.name : "Saved Filter";
  }
  const colName =
    factTable?.columns.find((c) => c.column === filter.column)?.name ||
    filter.column ||
    "?";
  const op = operatorLabelMap[filter.operator] ?? filter.operator;
  const valueRequired = ![
    "is_true",
    "is_false",
    "is_null",
    "not_null",
  ].includes(filter.operator);
  // Symbol-style operators (start with a non-letter) read better tight,
  // matching how engineers write the predicate inline.
  const isSymbolOp = !/^[a-zA-Z]/.test(op);
  if (!valueRequired) {
    return `${colName} ${op}`;
  }
  const values = (filter.values ?? []).filter((v) => v !== "");
  const valueStr = values.length ? values.join(", ") : "…";
  return isSymbolOp
    ? `${colName}${op}${valueStr}`
    : `${colName} ${op} ${valueStr}`;
}

/** Compose the collapsed/inline summary used for a funnel step. Joins the
 *  fact-table label (when shown) with up to `maxFilters` filter previews
 *  concatenated with ` AND `; additional filters surface as `+N more`.
 *
 *  When `allSteps` is supplied, filters whose `column+operator` appears on
 *  every step have their `{column}{operator}` prefix stripped — the universal
 *  context is implicit, and showing it on each step adds noise. Step-specific
 *  filters still render with the full `{column}{operator}{value}`. */
export function getFunnelStepPreview({
  step,
  factTable,
  showFactTable,
  maxFilters = 2,
  allSteps,
}: {
  step: FunnelStep;
  factTable: FactTableDefinition | null;
  showFactTable: boolean;
  maxFilters?: number;
  allSteps?: FunnelStep[];
}): string {
  const factTableLabel = showFactTable
    ? (factTable?.name ?? step.factTable ?? "")
    : "";
  const complete = step.rowFilters.filter(isPreviewableFilter);
  const commonKeys = allSteps
    ? getCommonFunnelFilterKeys(allSteps)
    : new Set<string>();
  const rendered = complete.map((f) => {
    const key = filterCommonKey(f);
    if (key && commonKeys.has(key)) {
      return formatValuesOnly(f);
    }
    return formatFilterPreview(f, factTable);
  });
  // Drop empties produced by value-less universal filters (e.g. every step
  // has `path is_null` — there's nothing left to render for that filter).
  const nonEmpty = rendered.filter((s) => s !== "");
  const previewCount = Math.min(maxFilters, nonEmpty.length);
  const previews = nonEmpty.slice(0, previewCount);
  const remaining = nonEmpty.length - previewCount;
  let filtersText = previews.join(" AND ");
  if (remaining > 0) {
    filtersText += `${previews.length ? " " : ""}+${remaining} more`;
  }
  return [factTableLabel, filtersText].filter(Boolean).join(" · ");
}

const DEFAULT_STEP_NAME_RE = /^Step \d+$/;

/** Returns the human-friendly label for a funnel step. When the step name
 *  still matches the autogenerated `Step N` pattern, we substitute the
 *  filter preview so chart/table labels carry the actual semantics (e.g.
 *  `event_name=Purchase`, or just `Purchase` when `event_name=…` is the
 *  universal context across every step). Falls back to the literal name
 *  when there's nothing to preview. */
export function getFunnelStepDisplayLabel({
  step,
  factTable,
  fallbackIndex,
  allSteps,
}: {
  step: FunnelStep;
  factTable: FactTableDefinition | null;
  /** Zero-based step position; used to back-compute `Step N` when the name
   *  has been edited to something empty/whitespace. */
  fallbackIndex: number;
  /** Pass the full steps array to enable common-prefix stripping. */
  allSteps?: FunnelStep[];
}): string {
  const trimmed = step.name?.trim() ?? "";
  const isAutoName = !trimmed || DEFAULT_STEP_NAME_RE.test(trimmed);
  if (!isAutoName) return trimmed;
  // For an auto-named step we prefer the filter preview; the fact-table
  // segment would just repeat what the chart's funnel context already shows.
  const preview = getFunnelStepPreview({
    step,
    factTable,
    showFactTable: false,
    allSteps,
  });
  return preview || trimmed || `Step ${fallbackIndex + 1}`;
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
    case "funnel":
      // The funnel sidebar manages steps directly; nothing in the codebase
      // should ask for a "value" on a funnel dataset.
      throw new Error("Funnels do not use values");
    default:
      throw new Error(`Invalid dataset type: ${type}`);
  }
}

/** Builds an empty funnel step. `factTable` is optional so the "Add step"
 *  button can prefill from the previous step (the inherited default). */
export function createEmptyFunnelStep({
  name,
  factTable = "",
}: {
  name: string;
  factTable?: string;
}): FunnelStep {
  return {
    name,
    factTable,
    rowFilters: [],
    optional: false,
  };
}

/** Intersection of `userIdTypes` across every step's resolved fact table.
 *  Empty if any step is missing a fact table or a table id cannot be resolved. */
export function getFunnelUnitOptions(
  dataset: FunnelDataset,
  factTables: FactTableDefinition[],
): string[] {
  const factTablesForSteps = dataset.steps
    .map((s) =>
      s.factTable
        ? (factTables.find((ft) => ft.id === s.factTable) ?? null)
        : null,
    )
    .filter((ft): ft is FactTableDefinition => !!ft);
  if (
    !factTablesForSteps.length ||
    factTablesForSteps.length < dataset.steps.length
  ) {
    return [];
  }
  return (
    factTablesForSteps.reduce<string[] | null>((acc, ft) => {
      const ids = ft.userIdTypes ?? [];
      if (acc === null) return [...ids];
      return acc.filter((id) => ids.includes(id));
    }, null) ?? []
  );
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
  } else if (type === "funnel") {
    return {
      type,
      unit: null,
      steps: [createEmptyFunnelStep({ name: "Step 1" })],
    };
  } else {
    throw new Error(`Invalid dataset type: ${type}`);
  }
}

export function getCommonColumns(
  dataset: ExplorationDataset | null,
  getFactTableById: (id: string) => FactTableDefinition | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): Pick<ColumnInterface, "column" | "name">[] {
  if (!dataset) return [];
  // Funnels use first-touch dimensions on the initial step's fact table,
  // so the candidate columns come from that one fact table — even when
  // later steps reference different fact tables.
  if (dataset.type !== "funnel") {
    if (!dataset.values || dataset.values.length === 0) return [];
  } else {
    if (!dataset.steps || dataset.steps.length === 0) return [];
  }

  type SimpleColumn = Pick<
    ColumnInterface,
    "column" | "name" | "deleted" | "datatype"
  >;
  let columns: SimpleColumn[] | null = null;
  const userIdTypes = new Set<string>();

  if (dataset.type === "fact_table") {
    const ft = getFactTableById(dataset.factTableId || "");
    columns = ft?.columns || [];
    ft?.userIdTypes?.forEach((u) => userIdTypes.add(u));
  } else if (dataset.type === "metric") {
    for (const value of dataset.values) {
      const metricId = value.metricId;
      let valueColumns: SimpleColumn[] = [];

      const factMetric = getFactMetricById(metricId);
      if (factMetric) {
        const ft = getFactTableById(factMetric.numerator.factTableId);
        valueColumns = ft?.columns || [];
        ft?.userIdTypes?.forEach((u) => userIdTypes.add(u));
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
    columns = Object.entries(dataset.columnTypes).map(([name, datatype]) => ({
      column: name,
      name,
      deleted: false,
      datatype,
    }));
  } else if (dataset.type === "funnel") {
    const initialStep = dataset.steps[0];
    const ft = initialStep?.factTable
      ? getFactTableById(initialStep.factTable)
      : null;
    columns = ft?.columns || [];
  }

  return (columns || [])
    .filter((c) => !c.deleted)
    .filter((c) => c.datatype === "string")
    .filter((c) => !userIdTypes.has(c.column))
    .sort((a, b) => (a.name || a.column).localeCompare(b.name || b.column))
    .map((c) => ({ column: c.column, name: c.name }));
}

export function getMaxDimensions(dataset: ExplorationDataset): number {
  // Phase 1 funnels are capped at a single dimension.
  if (dataset.type === "funnel") return 1;
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
  getFactTableById: (id: string) => FactTableDefinition | null,
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
  getFactTableById: (id: string) => FactTableDefinition | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ExplorationConfig {
  if (!config.dataset) return config;

  if (config.dataset.type === "funnel") {
    // Funnels store unit at the dataset level (not per-step). Default to the
    // first userIdType that exists on every step's fact table.
    if (config.dataset.unit) return config;
    const steps = config.dataset.steps;
    if (!steps.length) return config;
    const factTables = steps
      .map((s) => (s.factTable ? getFactTableById(s.factTable) : null))
      .filter((ft): ft is FactTableDefinition => !!ft);
    if (factTables.length !== steps.length) return config;
    const intersection = factTables.reduce<string[] | null>((acc, ft) => {
      const ids = ft.userIdTypes ?? [];
      if (acc === null) return [...ids];
      return acc.filter((id) => ids.includes(id));
    }, null);
    const defaultUnit = intersection?.[0];
    if (!defaultUnit) return config;
    return {
      ...config,
      dataset: { ...config.dataset, unit: defaultUnit },
    } as ExplorationConfig;
  }

  if (config.dataset.type !== "metric") return config;

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
function cleanRowFilters<T extends { rowFilters: RowFilter[] }>(value: T): T {
  return {
    ...value,
    rowFilters: value.rowFilters.filter(isCompleteFilter),
  };
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
  } else if (dataset.type === "funnel") {
    return {
      ...dataset,
      steps: dataset.steps.filter((s) => !!s.factTable).map(cleanRowFilters),
    };
  }
  return dataset;
}

/** Prepares a config for submission by removing incomplete inputs (values, filters) from the dataset. */
export function cleanConfigForSubmission(
  config: ExplorerDraftConfig,
): ExplorationConfig {
  const { previousTimeFrame: _, ...configWithoutPrevious } = config;
  const cleanedDataset = removeIncompleteInputs(configWithoutPrevious.dataset);
  const cleanedDimensions = configWithoutPrevious.dimensions.filter((d) => {
    if (d.dimensionType === "date" || d.dimensionType === "slice") return true;
    return "column" in d && d.column !== null;
  });
  return {
    ...configWithoutPrevious,
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
function toFetchKey(config: ExplorationConfig | ExplorerDraftConfig): unknown {
  const base =
    "previousTimeFrame" in config ? stripExplorerDraftFields(config) : config;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { showAs, ...rest } = base;
  if (base.dataset.type === "funnel") {
    // yAxisScale only affects how counts are rendered (percent vs raw);
    // same rows as chart-type-only changes — omit from the fetch identity.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { yAxisScale, ...funnelDatasetSansYAxis } = base.dataset;
    return {
      ...rest,
      chartType: getChartCategory(base.chartType),
      dataset: {
        ...funnelDatasetSansYAxis,
        steps: base.dataset.steps.map(
          ({ name: _name, ...stepRest }) => stepRest,
        ),
      },
    };
  }
  return {
    ...rest,
    chartType: getChartCategory(base.chartType),
    dataset: {
      ...base.dataset,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      values: base.dataset.values.map(({ name, ...rest }) => rest),
    },
  };
}

/** Returns true if any value/step targets a fact table whose `alwaysInlineFilter`
 *  columns are auto-seeded into rowFilters but still left at an empty value.
 *  We operate on the *raw* (uncleaned) config so we can see the placeholder
 *  filter that cleanRowFilters would otherwise strip before submission. */
export function hasUnsatisfiedInlineFilters(
  rawConfig: ExplorationConfig,
  getFactTableById: (id: string) => FactTableDefinition | null,
): boolean {
  const dataset = rawConfig?.dataset;
  if (!dataset) return false;

  const stepHasUnsatisfied = (
    factTableId: string | null,
    rowFilters: RowFilter[],
  ): boolean => {
    if (!factTableId) return false;
    const ft = getFactTableById(factTableId);
    if (!ft) return false;
    const inlineColumns = new Set(
      ft.columns
        .filter(
          (c) => c.alwaysInlineFilter && canInlineFilterColumn(ft, c.column),
        )
        .map((c) => c.column),
    );
    if (inlineColumns.size === 0) return false;
    return rowFilters.some(
      (rf) =>
        !!rf.column && inlineColumns.has(rf.column) && !isCompleteFilter(rf),
    );
  };

  if (dataset.type === "fact_table") {
    return dataset.values.some((v) =>
      stepHasUnsatisfied(dataset.factTableId, v.rowFilters),
    );
  }
  if (dataset.type === "funnel") {
    return dataset.steps.some((s) =>
      stepHasUnsatisfied(s.factTable || null, s.rowFilters),
    );
  }
  return false;
}

/** Checks if a config is minimally complete in order to be submitted.
 *  - metric/fact_table/data_source: need at least 1 value
 *  - fact_table: also needs a fact table id
 *  - data_source: also needs a table + timestamp column
 *  - funnel: needs ≥2 steps with fact tables, a `unit`, and the unit must
 *    exist as a userIdType on every step's fact table.
 */
export function isSubmittableConfig(
  cleanedConfig: ExplorationConfig,
  getFactTableById?: (id: string) => FactTableDefinition | null,
): boolean {
  if (!cleanedConfig?.dataset) return false;

  if (cleanedConfig.dataset.type === "funnel") {
    const { unit, steps } = cleanedConfig.dataset;
    if (!unit) return false;
    if (!Array.isArray(steps) || steps.length < 2) return false;
    if (!steps.every((s) => !!s.factTable)) return false;
    if (getFactTableById) {
      // Every step's fact table must expose the funnel-level unit as a
      // userIdType — otherwise per-user joins across steps are impossible.
      // We block submission rather than silently returning empty results.
      for (const step of steps) {
        const ft = getFactTableById(step.factTable);
        if (!ft) return false;
        if (!ft.userIdTypes?.includes(unit)) return false;
      }
    }
  } else {
    if (!Array.isArray(cleanedConfig.dataset.values)) return false;
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
  }

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
  lastSubmittedConfig: ExplorerDraftConfig | null,
  newConfig: ExplorationConfig,
  previousWindows?: {
    lastPreviousTimeFrame: ExplorationDateRange | null;
    newPreviousTimeFrame: ExplorationDateRange | null;
  },
): { needsFetch: boolean; needsUpdate: boolean } {
  const lastPrev = previousWindows?.lastPreviousTimeFrame ?? null;
  const newPrev = previousWindows?.newPreviousTimeFrame ?? null;

  if (!lastSubmittedConfig) {
    const hasInputs =
      newConfig.dataset.type === "funnel"
        ? newConfig.dataset.steps.length > 0
        : newConfig.dataset.values.length > 0;
    return { needsFetch: hasInputs, needsUpdate: hasInputs };
  }

  const lastComparable = stripExplorerDraftFields(lastSubmittedConfig);

  if (isEqual(lastComparable, newConfig) && isEqual(lastPrev, newPrev)) {
    return { needsFetch: false, needsUpdate: false };
  }

  const needsFetch =
    !isEqual(toFetchKey(lastComparable), toFetchKey(newConfig)) ||
    !isEqual(lastPrev, newPrev);
  return { needsFetch, needsUpdate: true };
}

export type ResolvedGranularity = "hour" | "day" | "week" | "month" | "year";

export function formatDateByGranularity(
  date: Date,
  granularity: ResolvedGranularity,
): string {
  switch (granularity) {
    case "year":
      return date.toLocaleDateString(undefined, { year: "numeric" });
    case "month":
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
      });
    case "week":
      return `Week of ${date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}`;
    case "hour":
      return `${date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })} ${date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    case "day":
    default:
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
  }
}

/** Formats a millisecond duration as a compact "1m 23s" style string. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) {
    return sec ? `${totalMin}m ${sec}s` : `${totalMin}m`;
  }
  const totalHr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (totalHr < 24) {
    return min ? `${totalHr}h ${min}m` : `${totalHr}h`;
  }
  const days = Math.floor(totalHr / 24);
  const hr = totalHr % 24;
  return hr ? `${days}d ${hr}h` : `${days}d`;
}

export function getRefreshInterval(elapsedSeconds: number): number {
  if (elapsedSeconds < 60) return 10_000; // 0-59s: update every 10s
  if (elapsedSeconds < 3600) return 60_000; // 1-59m: update every 60s
  if (elapsedSeconds < 86400) return 300_000; // 1-23h: update every 5m
  return 900_000; // 24h+: update every 15m
}

/**
 * True when a submitted state has enough inputs to render results. Used by
 * the main section's empty-state guard. Funnels need ≥2 steps; other dataset
 * types need ≥1 value. `cleanConfigForSubmission` is expected to have run
 * already (we don't re-check completeness here). Acts as a type predicate
 * so callers can pass the narrowed `ExplorationConfig` straight to children
 * that require a non-null config.
 */
export function hasSubmittablePayload(
  config: ExplorationConfig | null,
): config is ExplorationConfig {
  if (!config?.dataset) return false;
  if (config.dataset.type === "funnel") {
    return (config.dataset.steps?.length ?? 0) >= 2;
  }
  return (config.dataset.values?.length ?? 0) > 0;
}

export function shouldChartSectionShow(params: {
  loading: boolean;
  error: string | null;
  submittedExploreState: ExplorerDraftConfig | null;
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

type DecodePreviousTimeFrameResult =
  | { previousTimeFrame: ExplorationDateRange; error: null }
  | { previousTimeFrame: null; error: string };

function decodePreviousTimeFrameParam(
  encoded: string,
): DecodePreviousTimeFrameResult {
  try {
    const parsed = JSON.parse(decodeURIComponent(atob(encoded)));
    const previousTimeFrame = explorationDateRangeValidator.parse(parsed);
    return { previousTimeFrame, error: null };
  } catch {
    return {
      previousTimeFrame: null,
      error: "The URL contains an invalid comparison date range.",
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

function encodePreviousTimeFrameParam(value: ExplorationDateRange): string {
  return btoa(encodeURIComponent(JSON.stringify(value)));
}

export const previousTimeFrameQueryParser =
  createParser<ExplorationDateRange | null>({
    parse: (raw) => {
      if (!raw) return null;
      const result = decodePreviousTimeFrameParam(raw);
      return result.previousTimeFrame;
    },
    serialize: (value) => (value ? encodePreviousTimeFrameParam(value) : ""),
  });
