import { FactTableInterface, RowFilter } from "shared/types/fact-table";

export const NUMBER_PATTERN = "^-?(\\d+|\\d*\\.\\d+)$";

export const numberRegex = new RegExp(NUMBER_PATTERN);

export function getAllowedOperators(datatype: string): RowFilter["operator"][] {
  if (datatype === "boolean") {
    return ["is_true", "is_false", "is_null", "not_null"];
  }
  if (datatype === "number") {
    return [
      "=",
      "!=",
      "<",
      "<=",
      ">",
      ">=",
      "in",
      "not_in",
      "is_null",
      "not_null",
    ];
  }
  if (datatype === "string") {
    return [
      "=",
      "!=",
      "in",
      "not_in",
      "starts_with",
      "ends_with",
      "contains",
      "not_contains",
      "is_null",
      "not_null",
    ];
  }
  return ["=", "!=", "in", "not_in", "is_null", "not_null"];
}

export const operatorLabelMap: Record<RowFilter["operator"], string> = {
  "=": "=",
  "!=": "!=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  in: "in",
  not_in: "not in",
  is_true: "is true",
  is_false: "is false",
  is_null: "is null",
  not_null: "is not null",
  sql_expr: "SQL Expression",
  saved_filter: "Saved Filter",
  contains: "contains",
  not_contains: "not contains",
  starts_with: "starts with",
  ends_with: "ends with",
};

export function getColumnInfo(
  factTable: Pick<FactTableInterface, "columns">,
  column: string | undefined,
) {
  if (!column) {
    return { datatype: "" as const, topValues: [] as string[] };
  }

  // First, look for exact match
  const exactMatch = factTable.columns.find((c) => c.column === column);
  if (exactMatch) {
    return {
      datatype: exactMatch.datatype,
      topValues: exactMatch.topValues || [],
    };
  }

  // Next, look for JSON field match
  const [baseColumnName, jsonField] = column.split(".", 2);
  const baseColumnMatch = factTable.columns.find(
    (c) => c.column === baseColumnName,
  );
  if (
    baseColumnMatch &&
    baseColumnMatch.jsonFields &&
    jsonField &&
    baseColumnMatch.jsonFields[jsonField]
  ) {
    return {
      datatype: baseColumnMatch.jsonFields[jsonField].datatype,
      topValues: [],
    };
  }

  return { datatype: "" as const, topValues: [] as string[] };
}
