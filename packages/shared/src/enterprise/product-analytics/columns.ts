import { isEqual } from "lodash";
import {
  FactTableInterface,
  FactMetricInterface,
} from "shared/types/fact-table";
import {
  SqlDataset,
  ExplorationConfig,
  ExplorationDataset,
  ProductAnalyticsDimension,
} from "../../validators/product-analytics";

export interface AvailableDimensionColumn {
  column: string;
  name: string;
  datatype: SqlDataset["columnTypes"][string];
}

// Deliberately excludes `sql`, so callers can pass a full FactTableInterface
// or a sql-less id-scoped fetch.
export type DimensionFactTable = Pick<
  FactTableInterface,
  "columns" | "userIdTypes"
>;

// True if `column` resolves to a real underlying column on `factTable` —
// either a top-level column, or (for a dotted path) a JSON field defined on
// a JSON-typed top-level column. A ratio metric's denominator can live on a
// different fact table than its numerator, and that table may not expose
// the dimension's column at all; callers use this to skip applying a static
// dimension's filter to a group whose table can't actually resolve it,
// rather than injecting a WHERE clause that references a nonexistent
// column and fails at the warehouse.
export function factTableHasResolvableColumn(
  factTable: Pick<FactTableInterface, "columns">,
  column: string,
): boolean {
  const [baseColumn, ...rest] = column.split(".");
  const col = factTable.columns.find((c) => c.column === baseColumn);
  if (!col) return false;
  if (rest.length === 0) return true;
  return col.datatype === "json" && !!col.jsonFields?.[rest.join(".")];
}

export function expandFactTableColumns(
  factTable: DimensionFactTable,
): AvailableDimensionColumn[] {
  const result: AvailableDimensionColumn[] = [];
  (factTable.columns || [])
    .filter((c) => !c.deleted)
    .forEach((c) => {
      if (c.datatype === "string") {
        result.push({
          column: c.column,
          name: c.name || c.column,
          datatype: "string",
        });
      }
      if (c.datatype === "json" && c.jsonFields) {
        Object.entries(c.jsonFields).forEach(([field, info]) => {
          if (info.datatype === "string") {
            result.push({
              column: `${c.column}.${field}`,
              name: `${c.name || c.column}.${field}`,
              datatype: "string",
            });
          }
        });
      }
    });
  return result;
}

function excludeUserIdTypes(
  columns: AvailableDimensionColumn[],
  userIdTypes: Set<string>,
): AvailableDimensionColumn[] {
  return columns
    .filter((c) => !userIdTypes.has(c.column))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fact table ids whose full column data (including `jsonFields`) is needed
 * to compute `getAvailableDimensionColumns` for this dataset.
 */
export function getRelevantFactTableIds(
  dataset: ExplorationDataset | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): string[] {
  if (!dataset) return [];
  const ids = new Set<string>();

  switch (dataset.type) {
    case "fact_table":
    case "journey":
      if (dataset.factTableId) ids.add(dataset.factTableId);
      break;
    case "metric":
      getRelevantFactTableIdsForMetrics(
        dataset.values.map((v) => v.metricId),
        getFactMetricById,
      ).forEach((id) => ids.add(id));
      break;
    case "funnel": {
      const initialStepFactTableId = dataset.steps[0]?.factTableId;
      if (initialStepFactTableId) ids.add(initialStepFactTableId);
      break;
    }
    case "data_source":
    case "sql":
      break;
    default: {
      const _exhaustive: never = dataset;
      return _exhaustive;
    }
  }

  return Array.from(ids);
}

/**
 * Fact table ids referenced by a set of metric ids (numerator + denominator),
 * without needing to fake up an `ExplorationDataset` around them. Shared by
 * `getRelevantFactTableIds`'s "metric" case and callers (e.g. the AI agent's
 * column tools) that only have metric ids on hand.
 */
export function getRelevantFactTableIdsForMetrics(
  metricIds: string[],
  getFactMetricById: (id: string) => FactMetricInterface | null,
): string[] {
  const ids = new Set<string>();
  metricIds.forEach((metricId) => {
    const metric = getFactMetricById(metricId);
    if (!metric) return;
    if (metric.numerator?.factTableId) ids.add(metric.numerator.factTableId);
    if (metric.denominator?.factTableId)
      ids.add(metric.denominator.factTableId);
  });
  return Array.from(ids);
}

/**
 * Columns (including dotted JSON sub-paths) valid to group by for a given
 * dataset. Shared by the Explorer picker and agent validation.
 *
 * Callers must pass FULL fact table data (real `jsonFields`) — a slim/
 * definitions-only fact table silently under-reports nested JSON columns.
 */
export function getAvailableDimensionColumns(
  dataset: ExplorationDataset | null,
  getFactTableById: (id: string) => DimensionFactTable | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): AvailableDimensionColumn[] {
  if (!dataset) return [];

  const userIdTypes = new Set<string>();
  let candidates: AvailableDimensionColumn[] | null = null;

  switch (dataset.type) {
    case "fact_table": {
      if (!dataset.values.length) return [];
      const ft = getFactTableById(dataset.factTableId || "");
      if (!ft) return [];
      ft.userIdTypes?.forEach((u) => userIdTypes.add(u));
      candidates = expandFactTableColumns(ft);
      break;
    }
    case "metric": {
      if (!dataset.values.length) return [];
      return getAvailableDimensionColumnsForMetrics(
        dataset.values.map((v) => v.metricId),
        getFactTableById,
        getFactMetricById,
      );
    }
    case "data_source":
    case "sql": {
      if (!dataset.values.length) return [];
      candidates = Object.entries(dataset.columnTypes)
        .filter(([, datatype]) =>
          dataset.type === "sql" ? datatype !== "other" : datatype === "string",
        )
        .map(([name, datatype]) => ({ column: name, name, datatype }));
      break;
    }
    case "journey": {
      const ft = getFactTableById(dataset.factTableId || "");
      if (!ft) return [];
      ft.userIdTypes?.forEach((u) => userIdTypes.add(u));
      candidates = expandFactTableColumns(ft);
      break;
    }
    case "funnel": {
      if (!dataset.steps.length) return [];
      const initialStep = dataset.steps[0];
      const ft = initialStep?.factTableId
        ? getFactTableById(initialStep.factTableId)
        : null;
      if (!ft) return [];
      ft.userIdTypes?.forEach((u) => userIdTypes.add(u));
      candidates = expandFactTableColumns(ft);
      break;
    }
    default: {
      const _exhaustive: never = dataset;
      return _exhaustive;
    }
  }

  return excludeUserIdTypes(candidates || [], userIdTypes);
}

/**
 * Columns valid to group by for a set of metric ids directly — the "metric"
 * case of `getAvailableDimensionColumns`, factored out so callers that only
 * have metric ids on hand (e.g. the AI agent's column tools) don't need to
 * fake up an `ExplorationDataset` just to call it.
 */
export function getAvailableDimensionColumnsForMetrics(
  metricIds: string[],
  getFactTableById: (id: string) => DimensionFactTable | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): AvailableDimensionColumn[] {
  if (!metricIds.length) return [];

  const userIdTypes = new Set<string>();
  let candidates: AvailableDimensionColumn[] | null = null;

  for (const metricId of metricIds) {
    const factMetric = getFactMetricById(metricId);
    if (!factMetric) continue;
    const ft = getFactTableById(factMetric.numerator?.factTableId || "");
    let valueCandidates: AvailableDimensionColumn[] = [];
    if (ft) {
      ft.userIdTypes?.forEach((u) => userIdTypes.add(u));
      valueCandidates = expandFactTableColumns(ft);

      if (factMetric.denominator?.factTableId) {
        const denominatorFt = getFactTableById(
          factMetric.denominator.factTableId,
        );
        denominatorFt?.userIdTypes?.forEach((u) => userIdTypes.add(u));
        valueCandidates = denominatorFt
          ? valueCandidates.filter((c) =>
              factTableHasResolvableColumn(denominatorFt, c.column),
            )
          : [];
      }
    }

    if (candidates === null) {
      candidates = valueCandidates;
    } else {
      const names = new Set(valueCandidates.map((c) => c.column));
      candidates = candidates.filter((c) => names.has(c.column));
    }
  }

  return excludeUserIdTypes(candidates || [], userIdTypes);
}

export function dimensionColumnIsAvailable(
  dimension: ProductAnalyticsDimension,
  columns: AvailableDimensionColumn[],
): boolean {
  switch (dimension.dimensionType) {
    case "date":
    case "slice":
      return true;
    case "dynamic":
    case "static":
      return (
        dimension.column === null ||
        columns.some((c) => c.column === dimension.column)
      );
    default: {
      const _exhaustive: never = dimension;
      return _exhaustive;
    }
  }
}

export function getMaxDimensions(dataset: ExplorationDataset): number {
  // Phase 1 funnels and journeys are capped at a single dimension.
  if (dataset.type === "funnel" || dataset.type === "journey") return 1;
  let maxDimensions = 2;
  if (dataset.values.length > 1) {
    maxDimensions -= 1;
  }
  return maxDimensions;
}

export interface DimensionSanitizeResult {
  config: ExplorationConfig;
  warnings: string[];
}

/**
 * Single source of truth for the dimension-list policy applied whenever a
 * config's dimensions might be stale relative to its dataset or date range:
 * drop dimensions whose column no longer resolves, cap the list at the
 * dataset's dimension limit, and reset an invalid date granularity to "auto".
 * Shared by the Explorer (silently applied) and the AI agent (which surfaces
 * `warnings` back to the user).
 *
 * `validGranularities` is the set of `dateGranularity` values valid for the
 * config's resolved date range — computed by the caller via
 * `getValidDateGranularities`/`calculateProductAnalyticsDateRange` so this
 * module doesn't need to depend on the SQL-generation module.
 */
export function sanitizeDimensions(
  config: ExplorationConfig,
  getFactTableById: (id: string) => DimensionFactTable | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
  validGranularities: readonly string[],
): DimensionSanitizeResult {
  const warnings: string[] = [];
  const columns = getAvailableDimensionColumns(
    config.dataset,
    getFactTableById,
    getFactMetricById,
  );

  let dims = config.dimensions;

  const invalidDims = dims.filter(
    (d) => !dimensionColumnIsAvailable(d, columns),
  );
  if (invalidDims.length) {
    const invalidSet = new Set(invalidDims);
    dims = dims.filter((d) => !invalidSet.has(d));
    warnings.push(
      `Removed ${invalidDims.length} dimension(s) referencing a column that isn't valid for this dataset (unknown, deleted, or — for a ratio metric — not shared between the numerator and denominator fact tables): ${invalidDims
        .map((d) => `"${"column" in d ? d.column : ""}"`)
        .join(", ")}.`,
    );
  }

  const maxDims = getMaxDimensions(config.dataset);
  if (dims.length > maxDims) {
    const removed = dims.length - maxDims;
    dims = dims.slice(0, maxDims);
    warnings.push(
      `Removed ${removed} dimension(s) to stay within the limit of ${maxDims} (max 2, or 1 when multiple values, or 1 for funnels).`,
    );
  }

  let granularityWasReset = false;
  dims = dims.map((d) => {
    if (d.dimensionType !== "date") return d;
    if (validGranularities.includes(d.dateGranularity)) return d;
    granularityWasReset = true;
    return { ...d, dateGranularity: "auto" as const };
  });
  if (granularityWasReset) {
    warnings.push(
      `Reset date dimension granularity to "auto" — the previous granularity isn't valid for the selected date range.`,
    );
  }

  if (isEqual(dims, config.dimensions)) {
    return { config, warnings: [] };
  }
  return { config: { ...config, dimensions: dims }, warnings };
}
