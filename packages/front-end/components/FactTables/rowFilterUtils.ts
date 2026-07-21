import { FactTableInterface, RowFilter } from "shared/types/fact-table";

export const NUMBER_PATTERN = "^-?(\\d+|\\d*\\.\\d+)$";

export const numberRegex = new RegExp(NUMBER_PATTERN);

// Matches ISO-8601-style dates/datetimes ("2024-01-01", "2024-01-01T09:00",
// "2024-01-01 09:00:00"). Mirrors the backend column-type inference regex in
// back-end/src/util/sql.ts so the "treat as date" toggle is offered on exactly
// the string columns whose sampled values look like dates.
export const isoDateRegex = /^\d{4}-\d{2}-\d{2}($|[ T])/;

/**
 * True when a string column's sampled values all look like ISO dates (and there
 * is at least one non-empty sample). Used to decide whether to offer treating a
 * string column as a date for comparison.
 */
export function valuesLookLikeDates(values: string[]): boolean {
  const nonEmpty = values.filter((v) => v);
  return nonEmpty.length > 0 && nonEmpty.every((v) => isoDateRegex.test(v));
}

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
  if (datatype === "date") {
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
      "<",
      "<=",
      ">",
      ">=",
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

/**
 * `attributes` JSON-field names that are also exposed as a top-level column on
 * the fact table — e.g. managed-warehouse identifiers aliased out of
 * `attributes`, or legacy materialized columns. Column pickers hide these JSON
 * fields so a value isn't offered both as a top-level column and an
 * `attributes.<field>` path. Only the `attributes` column is de-duped; other
 * JSON columns (e.g. `properties`) carry independent data.
 */
export function getAttributeFieldsExposedAsColumns(
  factTable: Pick<FactTableInterface, "columns">,
): Set<string> {
  const attributesCol = factTable.columns.find(
    (c) => c.column === "attributes" && c.datatype === "json" && !c.deleted,
  );
  if (!attributesCol?.jsonFields) return new Set();
  const topLevel = new Set(
    factTable.columns
      .filter((c) => c.datatype !== "json" && !c.deleted)
      .map((c) => c.column),
  );
  return new Set(
    Object.keys(attributesCol.jsonFields).filter((f) => topLevel.has(f)),
  );
}

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
