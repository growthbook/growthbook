import {
  ColumnInterface,
  FactTableColumnType,
  FactTableInterface,
  NumberFormat,
  UpdateColumnProps,
} from "shared/types/fact-table";
import {
  canInlineFilterColumn,
  getFactTableIdColumn,
  getFactTableTimestampColumn,
} from "shared/experiments";

// The one column-edit model: every column editor asks it what a column is,
// what it may be, and what a save sends.

export const COLUMN_DATATYPE_OPTIONS: {
  label: string;
  value: FactTableColumnType;
}[] = [
  { label: "Number", value: "number" },
  { label: "String", value: "string" },
  { label: "Date / Datetime", value: "date" },
  { label: "Boolean", value: "boolean" },
  { label: "JSON", value: "json" },
  { label: "Binary", value: "binary" },
  { label: "Other", value: "other" },
];

export const NUMBER_FORMAT_OPTIONS: { label: string; value: NumberFormat }[] = [
  { label: "Plain number", value: "" },
  { label: "Currency", value: "currency" },
  { label: "Time (seconds)", value: "time:seconds" },
  { label: "Time (milliseconds)", value: "time:milliseconds" },
  { label: "Memory (bytes)", value: "memory:bytes" },
  { label: "Memory (kilobytes)", value: "memory:kilobytes" },
];

type FactTableMapping = Pick<
  FactTableInterface,
  "userIdTypes" | "userIdColumns" | "timestampColumn" | "columns"
>;

export type ColumnRole = "identifier" | "timestamp" | null;

// Read from the fact table's mappings, not the column's name
export function getColumnRole(
  factTable: FactTableMapping,
  column: string,
): ColumnRole {
  if (
    factTable.userIdTypes.some(
      (idType) => getFactTableIdColumn(factTable, idType) === column,
    )
  ) {
    return "identifier";
  }
  if (getFactTableTimestampColumn(factTable) === column) return "timestamp";
  return null;
}

// What a column may be, judged on the column as it will be after the edit,
// which may not be saved on the fact table yet
export function getColumnEligibility(
  factTable: FactTableMapping,
  column: ColumnInterface,
): { canFilter: boolean; canAutoSlice: boolean } {
  if (getColumnRole(factTable, column.column)) {
    return { canFilter: false, canAutoSlice: false };
  }
  const withColumn = {
    ...factTable,
    columns: [
      ...factTable.columns.filter((c) => c.column !== column.column),
      column,
    ],
  };
  return {
    canFilter: canInlineFilterColumn(withColumn, column.column),
    canAutoSlice: column.datatype === "string" || column.datatype === "boolean",
  };
}

// The save rules for editing a column. Returns the request body, and whether
// the column then needs its top values loaded to fill a new string Auto
// Slice's levels.
export function prepareColumnUpdate(
  factTable: FactTableMapping,
  column: ColumnInterface,
  changes: UpdateColumnProps,
): { data: UpdateColumnProps; loadTopValues: boolean } {
  const data = { ...changes };
  // The server resets an omitted name to the raw column name
  data.name ??= column.name;
  const datatype = data.datatype ?? column.datatype;
  const { canFilter, canAutoSlice } = getColumnEligibility(factTable, {
    ...column,
    datatype,
  });

  if (data.alwaysInlineFilter && !canFilter) data.alwaysInlineFilter = false;
  // Value mappings only apply while filtering
  if (data.alwaysInlineFilter === false) data.conditionalInlineFilters ??= {};
  if (data.isAutoSliceColumn && !canAutoSlice) data.isAutoSliceColumn = false;

  // The server keeps boolean levels fixed; string levels come from top values
  if (datatype === "boolean" && data.autoSlices) {
    data.autoSlices = ["true", "false"];
  }
  const loadTopValues =
    !!data.isAutoSliceColumn &&
    !column.isAutoSliceColumn &&
    datatype === "string" &&
    !data.autoSlices?.length;

  return { data, loadTopValues };
}

// Secondary filters: a value of this column → another column to prompt for
export function toConditionalInlineFilters(
  mappings: { value: string; column: string }[],
): Record<string, string> {
  return Object.fromEntries(
    mappings.filter((m) => m.value && m.column).map((m) => [m.value, m.column]),
  );
}

// Columns (or string/boolean JSON fields) a Secondary filter can prompt for
export function getSecondaryFilterColumnOptions(
  factTable: Pick<
    FactTableInterface,
    "userIdTypes" | "userIdColumns" | "timestampColumn" | "columns"
  >,
  column: string,
): { label: string; value: string }[] {
  const options: { label: string; value: string }[] = [];
  factTable.columns.forEach((c) => {
    if (c.deleted || c.column === column) return;
    if (c.datatype === "json") {
      Object.entries(c.jsonFields ?? {}).forEach(([field, f]) => {
        if (
          f.datatype === "string" ||
          f.datatype === "boolean" ||
          !f.datatype
        ) {
          options.push({
            label: `${c.name || c.column}.${field}`,
            value: `${c.column}.${field}`,
          });
        }
      });
      return;
    }
    if (canInlineFilterColumn(factTable, c.column)) {
      options.push({ label: c.name || c.column, value: c.column });
    }
  });
  return options;
}
