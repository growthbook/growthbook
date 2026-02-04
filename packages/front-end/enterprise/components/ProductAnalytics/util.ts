import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { MetricValue, FactTableValue, SqlValue, ProductAnalyticsValue, DatasetType, ProductAnalyticsDataset } from "shared/validators";

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
        unit: null,
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
    return { type, values: [], factTableId: null }
  }
  else if (type === "sql") {
    return { type, values: [], datasource: "", sql: "", timestampColumn: "", columnTypes: {} };
  } else {
    throw new Error(`Invalid dataset type: ${type}`);
  }
}

export function getCommonColumns(
  dataset: ProductAnalyticsDataset | null,
  getFactTableById: (id: string) => FactTableInterface | null,
  getFactMetricById: (id: string) => FactMetricInterface | null,
): ColumnInterface[] {
  if (!dataset || !dataset.values || dataset.values.length === 0) return [];

  let columns: ColumnInterface[] | null = null;

  if (dataset.type === 'fact_table') {
    const ft = getFactTableById(dataset.factTableId || "");
    columns = ft?.columns || [];
  } else if (dataset.type === 'metric') {
    for (const value of dataset.values) {
      const metricId = value.metricId;
      let valueColumns: ColumnInterface[] = [];

      // if (isFactMetricId(metricId)) {
      const factMetric = getFactMetricById(metricId);
      if (factMetric) {
        const ft = getFactTableById(factMetric.numerator.factTableId);
        console.log("Fact table", ft);
        valueColumns = ft?.columns || [];
      }

      if (columns === null) {
        columns = valueColumns;
      } else {
        // Intersect by column name
        const valueColumnNames = new Set(valueColumns.map(c => c.column));
        columns = columns.filter(c => valueColumnNames.has(c.column));
      }
    }
  }

  // Filter out deleted columns
  return (columns || []).filter(c => !c.deleted).sort((a, b) => (a.name || a.column).localeCompare(b.name || b.column));
}
