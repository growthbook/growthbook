import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type {
  MetricValue,
  FactTableValue,
  SqlValue,
  ProductAnalyticsValue,
  DatasetType,
  ProductAnalyticsDataset,
} from "shared/validators";

export function createEmptyValue(type: DatasetType): ProductAnalyticsValue {
  const base = {
    name: "",
    rowFilters: [],
  };
  switch (type) {
    case "metric":
      return {
        ...base,
        type: "metric",
        metricId: "",
        unit: null,
        denominatorUnit: null,
      } as MetricValue;
    case "fact_table":
      return {
        ...base,
        type: "fact_table",
        valueType: "count",
        valueColumn: null,
        unit: "user_id",
      } as FactTableValue;
    case "sql":
      return {
        ...base,
        type: "sql",
        valueType: "count",
        valueColumn: null,
        unit: null,
      } as SqlValue;
    default:
      throw new Error(`Invalid dataset type: ${type}`);
  }
}

export function createEmptyDataset(type: DatasetType): ProductAnalyticsDataset {
  if (type === "metric") {
    return { type, values: [] };
  } else if (type === "fact_table") {
    return { type, values: [], factTableId: null };
  } else if (type === "sql") {
    return {
      type,
      values: [],
      datasource: "",
      sql: "",
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
  } else if (dataset.type === "sql") {
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
