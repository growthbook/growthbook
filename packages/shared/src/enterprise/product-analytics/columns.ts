import {
  FactTableInterface,
  FactMetricInterface,
} from "shared/types/fact-table";
import {
  ExplorationDataset,
  ProductAnalyticsDimension,
} from "../../validators/product-analytics";
import { factTableHasResolvableColumn } from "./sql";

export interface AvailableDimensionColumn {
  column: string;
  name: string;
}

// Deliberately excludes `sql`, so callers can pass a full FactTableInterface
// or a sql-less id-scoped fetch.
export type DimensionFactTable = Pick<
  FactTableInterface,
  "columns" | "userIdTypes"
>;

function expandFactTableColumns(
  factTable: DimensionFactTable,
): AvailableDimensionColumn[] {
  const result: AvailableDimensionColumn[] = [];
  (factTable.columns || [])
    .filter((c) => !c.deleted)
    .forEach((c) => {
      if (c.datatype === "string") {
        result.push({ column: c.column, name: c.name || c.column });
      }
      if (c.datatype === "json" && c.jsonFields) {
        Object.entries(c.jsonFields).forEach(([field, info]) => {
          if (info.datatype === "string") {
            result.push({
              column: `${c.column}.${field}`,
              name: `${c.name || c.column}.${field}`,
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
      if (dataset.factTableId) ids.add(dataset.factTableId);
      break;
    case "metric":
      dataset.values.forEach((value) => {
        const metric = getFactMetricById(value.metricId);
        if (!metric) return;
        if (metric.numerator?.factTableId) {
          ids.add(metric.numerator.factTableId);
        }
        if (metric.denominator?.factTableId) {
          ids.add(metric.denominator.factTableId);
        }
      });
      break;
    case "funnel": {
      const initialStepFactTableId = dataset.steps[0]?.factTableId;
      if (initialStepFactTableId) ids.add(initialStepFactTableId);
      break;
    }
    case "data_source":
      break;
    default: {
      const _exhaustive: never = dataset;
      return _exhaustive;
    }
  }

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
      for (const value of dataset.values) {
        const factMetric = getFactMetricById(value.metricId);
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
      break;
    }
    case "data_source": {
      if (!dataset.values.length) return [];
      candidates = Object.entries(dataset.columnTypes)
        .filter(([, datatype]) => datatype === "string")
        .map(([name]) => ({ column: name, name }));
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
