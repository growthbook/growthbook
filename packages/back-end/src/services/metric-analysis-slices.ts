import { getColumnExpression } from "shared/experiments";
import { FactTableInterface } from "back-end/types/fact-table";
import { MetricAnalysisSettings } from "back-end/types/metric-analysis";

/**
 * Represents a slice column that should be included in GROUP BY clauses
 */
export interface SliceColumn {
  column: string;
  name: string;
  datatype: "string" | "boolean";
  isAutoSlice: boolean;
  // For auto slices, we'll group by all values
  // For custom slices, we'll filter to specific values
  filterValues?: string[]; // If provided, only include these values
}

/**
 * Extracts all slice columns from metric analysis settings
 * Combines metricAutoSlices (from the metric) with customMetricSlices (from settings)
 */
export function getSliceColumnsForMetricAnalysis({
  settings,
  factTable,
}: {
  settings: MetricAnalysisSettings;
  factTable: FactTableInterface;
}): SliceColumn[] {
  const sliceColumns: Map<string, SliceColumn> = new Map();

  // 1. Add auto slice columns from metric.metricAutoSlices
  // These are columns that should be grouped by all their auto slice values
  if (settings.metricAutoSlices?.length) {
    settings.metricAutoSlices.forEach((columnName) => {
      const column = factTable.columns.find(
        (col) =>
          col.column === columnName &&
          col.isAutoSliceColumn &&
          !col.deleted &&
          (col.datatype === "string" || col.datatype === "boolean"),
      );

      if (column) {
        sliceColumns.set(columnName, {
          column: columnName,
          name: column.name || columnName,
          datatype: column.datatype === "boolean" ? "boolean" : "string",
          isAutoSlice: true,
        });
      }
    });
  }

  // 2. Add custom slice columns from settings.customMetricSlices
  // These are specific column/value combinations
  if (settings.customMetricSlices?.length) {
    settings.customMetricSlices.forEach((customSliceGroup) => {
      customSliceGroup.slices.forEach((slice) => {
        const column = factTable.columns.find(
          (col) =>
            col.column === slice.column &&
            !col.deleted &&
            (col.datatype === "string" || col.datatype === "boolean") &&
            !factTable.userIdTypes.includes(col.column),
        );

        if (column) {
          const existing = sliceColumns.get(slice.column);
          if (existing) {
            // If this column is already in the map (from auto slices),
            // we need to merge the filter values
            if (!existing.filterValues) {
              existing.filterValues = [];
            }
            // Add the custom slice values to the filter
            slice.levels.forEach((level) => {
              if (!existing.filterValues!.includes(level)) {
                existing.filterValues!.push(level);
              }
            });
          } else {
            // New column from custom slices
            sliceColumns.set(slice.column, {
              column: slice.column,
              name: column.name || slice.column,
              datatype: column.datatype === "boolean" ? "boolean" : "string",
              isAutoSlice: false,
              filterValues: [...slice.levels], // Filter to these specific values
            });
          }
        }
      });
    });
  }

  return Array.from(sliceColumns.values());
}

/**
 * Gets the SQL expression for a slice column
 * Handles JSON extraction and proper column references
 * This mirrors the logic from getColumnExpression in shared/experiments.ts
 */
export function getSliceColumnExpression(
  columnName: string,
  factTable: FactTableInterface,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string,
  alias: string = "f",
): string {
  const column = factTable.columns.find((col) => col.column === columnName);
  if (!column) {
    throw new Error(`Column ${columnName} not found in fact table`);
  }

  return getColumnExpression(columnName, factTable, jsonExtract, alias);
}
