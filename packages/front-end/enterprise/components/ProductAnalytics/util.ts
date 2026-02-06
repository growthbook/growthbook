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

export const VALUE_TYPE_OPTIONS: {
  value: "unit_count" | "count" | "sum";
  label: string;
}[] = [
  { value: "count", label: "Count" },
  { value: "unit_count", label: "Unit count" },
  { value: "sum", label: "Sum" },
];

export function getValueTypeLabel(
  valueType: "count" | "unit_count" | "sum",
): string {
  return (
    VALUE_TYPE_OPTIONS.find((o) => o.value === valueType)?.label ?? valueType
  );
}

export function createEmptyValue(type: DatasetType, factTable: FactTableInterface | null, factMetric: FactMetricInterface | null): ProductAnalyticsValue {
  const base = {
    name: "",
    rowFilters: [],
  };
  switch (type) {
    case "metric":
      return {
        ...base,
        name: factMetric?.name ?? "",
        type: "metric",
        metricId: factMetric?.id ?? "",
        unit: factTable?.userIdTypes[0] ?? null,
        denominatorUnit: null,
      } as MetricValue;
    case "fact_table":
      return {
        ...base,
        name: "Count",
        type: "fact_table",
        valueType: "count",
        valueColumn: null,
        unit: "user_id",
      } as FactTableValue;
    case "sql":
      return {
        ...base,
        name: "Count",
        type: "sql",
        valueType: "count",
        valueColumn: null,
        unit: null,
      } as SqlValue;
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

export function createEmptyDataset(type: DatasetType, factTable?: FactTableInterface): ProductAnalyticsDataset {
  if (type === "metric") {
    return { type, values: [] };
  } else if (type === "fact_table") {
    return { type, values: [], factTableId: factTable?.id ?? null };
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

export function removeIncompleteValues(dataset: ProductAnalyticsDataset): ProductAnalyticsDataset {
  if (dataset.type === "metric") {
    return { ...dataset, values: dataset.values.filter((v) => v.metricId) };
  } else if (dataset.type === "fact_table") {
    return { ...dataset, values: dataset.values.filter((v) => v.unit && v.valueType) };
  } else if (dataset.type === "sql") {
    return { ...dataset, values: dataset.values.filter((v) => v.valueColumn) };
  }
  return dataset;
}