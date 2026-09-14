import {
  isValidRowFilterDateValue,
  normalizeRowFilterDateValue,
} from "shared/experiments";
import { getValidDate, getValidDateOffsetByUTC } from "shared/dates";
import { truncateString } from "shared/util";
import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import type { GroupedValue, SingleValue } from "@/components/Forms/SelectField";

export const NUMBER_PATTERN = "^-?(\\d+|\\d*\\.\\d+)$";

export const numberRegex = new RegExp(NUMBER_PATTERN);

/**
 * A fact table's `timestamp` column is the event time the whole analysis is
 * built on — the experiment/exploration date range already bounds it. A row
 * filter on it can only narrow that window further, which is what the date
 * range control is for, so the column pickers hide it (see `hideTimeColumn`).
 */
export const FACT_TABLE_TIMESTAMP_COLUMN = "timestamp";

/**
 * Whether a column should be hidden from a row-filter column picker because it
 * is the source's event-time column. An already-selected column is never
 * hidden, so a filter created before this (or through the API) stays editable
 * instead of showing up as invalid.
 */
export function hideTimeColumn({
  column,
  timeColumn,
  selectedColumn,
}: {
  column: string;
  timeColumn: string | undefined;
  selectedColumn: string | undefined;
}): boolean {
  if (!timeColumn || column !== timeColumn) return false;
  return column !== selectedColumn;
}

/**
 * Date operators that compare against a whole calendar day rather than a
 * precise instant. Equality on a date means "on this day", and range bounds are
 * day-level, so these use a date-only picker (no time-of-day). The ordering
 * operators (`< <= > >=`) are cutoffs where a specific time can matter, so they
 * keep the datetime picker.
 *
 * `getRowFilterSQL` implements the matching half: a `yyyy-MM-dd` value becomes
 * the half-open interval `[day, nextDay)` rather than the instant at its
 * midnight, so `=` matches the whole day and a range includes all of its final
 * day.
 */
export function isDateOnlyOperator(operator: string): boolean {
  return (
    operator === "=" || operator === "between" || operator === "not_between"
  );
}

/**
 * Reshape a stored date value between date-only (`yyyy-MM-dd`) and datetime
 * (`yyyy-MM-dd'T'HH:mm`) form when the operator changes which one applies.
 * Purely string-based (no `Date` parsing) so there is no timezone shift: to
 * date-only we keep the `yyyy-MM-dd` prefix; to datetime we append midnight when
 * the value has no time component.
 */
export function reshapeDateValueForOperator(
  value: string,
  dateOnly: boolean,
): string {
  if (!value) return value;
  const datePart = value.slice(0, 10);
  if (dateOnly) return datePart;
  return value.length > 10 ? value : `${datePart}T00:00`;
}

/**
 * Parse a stored date-column filter value into the `Date` the picker should
 * display. Row filter dates are UTC wall-clock text (see `getRowFilterSQL`) and
 * the picker edits that text directly, so the wall-clock has to survive the
 * round trip through `Date` unchanged.
 *
 * `getValidDate` alone doesn't manage that for every accepted spelling. The
 * pickers write `yyyy-MM-dd` / `yyyy-MM-dd'T'HH:mm`, which parse back as local
 * time and re-format identically — but `isValidRowFilterDateValue` also accepts
 * the shapes a REST API or bulk-import caller can send, including a trailing
 * `Z`. `new Date("2026-07-15T14:30:00Z")` is an *instant*, so re-formatting it
 * for the browser renders 07:30 for a UTC-7 user and silently rewrites the
 * filter on save. Normalizing first (which drops the `Z` and any sub-second
 * part) makes every spelling parse as the same wall-clock.
 *
 * Returns undefined for a value the SQL layer would reject, so a malformed
 * filter shows an empty field rather than `getValidDate`'s "today" fallback
 * dressed up as the stored value.
 */
export function parseRowFilterDateValue(
  value: string | undefined,
  dateOnly: boolean,
): Date | undefined {
  if (!value || !isValidRowFilterDateValue(value)) return undefined;

  // `yyyy-MM-dd` parses as UTC midnight, so shift it to local midnight to land
  // the calendar on the day the text names. This is the same shift every other
  // `precision="date"` caller applies, and it isn't a timezone conversion — the
  // value stays UTC, it just has to sit in the `Date` fields `format` and
  // react-day-picker actually read, which are the local ones.
  if (dateOnly) return getValidDateOffsetByUTC(value.slice(0, 10));

  // Minute precision — the picker can't express seconds, so a value carrying
  // them displays (and re-saves) truncated to the minute.
  const wallClock = normalizeRowFilterDateValue(value).replace(" ", "T");
  return getValidDate(
    wallClock.length > 10 ? wallClock : `${wallClock.slice(0, 10)}T00:00`,
  );
}

/** Date operators that select a range (rendered with a date range picker). */
export function isDateRangeOperator(operator: string): boolean {
  return operator === "between" || operator === "not_between";
}

/**
 * Drop date values the SQL layer (`getRowFilterSQL`) would reject, using the
 * same strict validator rather than the browser's permissive `new Date()`.
 * Run when a filter's column becomes a date column so the UI never shows an
 * "active" filter whose value the query silently omits.
 */
export function cleanupDateColumnValues(values: string[]): string[] {
  return values.filter((v) => isValidRowFilterDateValue(v));
}

/**
 * Keep the stored date values in the format the new operator expects when it
 * changes which picker applies (e.g. `>` → `=` drops the time; `=` → `>` gives
 * the datetime picker a parseable value rather than shifting the day). No-op
 * for non-date columns or switches that stay on the same side of the
 * date-only/datetime boundary.
 */
export function reshapeDateValuesOnOperatorChange(
  values: string[],
  fromOperator: string,
  toOperator: string,
  isDateColumn: boolean,
): string[] {
  if (!isDateColumn) return values;
  if (isDateOnlyOperator(toOperator) === isDateOnlyOperator(fromOperator)) {
    return values;
  }
  return values.map((v) =>
    reshapeDateValueForOperator(v, isDateOnlyOperator(toOperator)),
  );
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
    // `!=` and `is_null` are intentionally absent: an exact-inequality against a
    // timestamp is almost never what someone means, and a date column with no
    // value isn't a useful thing to select rows by.
    return ["=", "<", "<=", ">", ">=", "between", "not_between", "not_null"];
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
  between: "between",
  not_between: "not between",
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

/**
 * Saved filters share the row-filter column picker with columns, so their
 * option values are prefixed to keep the two namespaces apart. Picking one sets
 * the operator and the filter id in a single step.
 */
export const SAVED_FILTER_VALUE_PREFIX = "$$saved_filter:";

/**
 * A handful of saved filter names run past 100 characters and blow out the
 * dropdown; ~95% fit in 40.
 */
export const SAVED_FILTER_LABEL_MAX_CHARS = 40;

/** The column picker's current value for a row filter. */
export function getRowFilterSelectValue(filter: RowFilter): string {
  if (filter.operator === "saved_filter") {
    return filter.values?.[0]
      ? SAVED_FILTER_VALUE_PREFIX + filter.values[0]
      : "";
  }
  return filter.column || "";
}

/** Saved filters first, then columns. */
export function getRowFilterSelectOptions({
  columnOptions,
  savedFilters,
  selectedSavedFilterId,
}: {
  columnOptions: SingleValue[];
  savedFilters: { id: string; name: string }[];
  selectedSavedFilterId?: string;
}): GroupedValue[] {
  const savedFilterOptions: SingleValue[] = savedFilters.map((f) => ({
    label: truncateString(f.name, SAVED_FILTER_LABEL_MAX_CHARS),
    value: SAVED_FILTER_VALUE_PREFIX + f.id,
  }));

  if (
    selectedSavedFilterId &&
    !savedFilters.some((f) => f.id === selectedSavedFilterId)
  ) {
    savedFilterOptions.push({
      label: `${selectedSavedFilterId} (Deleted)`,
      value: SAVED_FILTER_VALUE_PREFIX + selectedSavedFilterId,
    });
  }

  return [
    ...(savedFilterOptions.length
      ? [{ label: "Saved Filters", options: savedFilterOptions }]
      : []),
    { label: "Columns", options: columnOptions },
  ];
}

/**
 * Row filter changes when a new column (or saved filter) is picked. Operators
 * and values that don't apply to the new datatype are reset rather than left
 * behind to generate invalid SQL.
 */
export function getRowFilterColumnChange(
  selected: string,
  filter: RowFilter,
  datatype: string,
): Partial<RowFilter> {
  if (selected.startsWith(SAVED_FILTER_VALUE_PREFIX)) {
    return {
      operator: "saved_filter",
      values: [selected.slice(SAVED_FILTER_VALUE_PREFIX.length)],
    };
  }

  let operator = filter.operator;
  let values = filter.values || [];

  const allowedOperators = getAllowedOperators(datatype);
  if (!allowedOperators.includes(operator)) {
    operator = allowedOperators[0];
    values = [];
  }

  if (datatype === "number") {
    values = values.filter((v) => numberRegex.test(v));
  }

  if (datatype === "date") {
    values = cleanupDateColumnValues(values);
  }

  return { operator, column: selected, values };
}

/** True when a row filter has everything it needs to generate SQL. */
export function isRowFilterComplete(filter: RowFilter): boolean {
  const hasValues = (filter.values ?? []).some((v) => v !== "");

  if (filter.operator === "sql_expr" || filter.operator === "saved_filter") {
    return hasValues;
  }
  if (
    ["is_true", "is_false", "is_null", "not_null"].includes(filter.operator)
  ) {
    return !!filter.column;
  }
  return !!filter.column && hasValues;
}

/**
 * Normalised column source so a row filter form works for both fact tables and
 * raw data sources (the Product Analytics explorer filters datasets that have
 * no fact table behind them).
 */
export interface FilterColumnSource {
  columns: SingleValue[];
  savedFilters: { id: string; name: string }[];
  getColumnInfo: (column: string | undefined) => {
    datatype: string;
    topValues: string[];
  };
  /** The source's event-time column, hidden from the column picker. */
  timeColumn?: string;
}

export function factTableToColumnSource(
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">,
): FilterColumnSource {
  const columns: SingleValue[] = [];
  const hiddenAttributeFields = getAttributeFieldsExposedAsColumns(factTable);
  factTable.columns.forEach((col) => {
    if (factTable.userIdTypes?.includes(col.column)) return;
    if (col.deleted) return;

    columns.push({ label: col.name || col.column, value: col.column });

    // JSON sub-fields are selectable as their own columns
    if (col.jsonFields) {
      Object.keys(col.jsonFields).forEach((field) => {
        if (col.column === "attributes" && hiddenAttributeFields.has(field))
          return;
        columns.push({
          label: `${col.name || col.column}.${field}`,
          value: `${col.column}.${field}`,
        });
      });
    }
  });

  return {
    columns,
    savedFilters: factTable.filters.map((f) => ({ id: f.id, name: f.name })),
    getColumnInfo: (column) => getColumnInfo(factTable, column),
    timeColumn: FACT_TABLE_TIMESTAMP_COLUMN,
  };
}

export function columnTypesToColumnSource(
  columnTypes: Record<
    string,
    "string" | "number" | "date" | "boolean" | "other"
  >,
  timestampColumn?: string,
): FilterColumnSource {
  const columns = Object.keys(columnTypes).map((col) => ({
    label: col,
    value: col,
  }));

  return {
    columns,
    savedFilters: [],
    timeColumn: timestampColumn,
    getColumnInfo: (column) => {
      if (!column || !(column in columnTypes))
        return { datatype: "", topValues: [] };
      return { datatype: columnTypes[column], topValues: [] };
    },
  };
}

/** Operators that carry no value of their own. */
const VALUELESS_OPERATORS = [
  "is_true",
  "is_false",
  "is_null",
  "not_null",
  "saved_filter",
];

/**
 * Partially-typed numbers ("-", ".", "-1.") that a finished-number pattern
 * rejects but which have to be typeable on the way to one.
 */
export const NUMBER_PARTIAL_PATTERN = /^-?\.?$|^-?\d*\.?\d*$/;

/**
 * Everything a row filter's operator and value inputs are derived from. Shared
 * so the metric editor and the explorer sidebar can't drift on which operators
 * are offered or which input a datatype gets.
 */
export function getRowFilterInputState({
  operator,
  values,
  datatype,
  topValues,
}: {
  operator: RowFilter["operator"];
  values: string[] | undefined;
  datatype: string;
  topValues: string[] | undefined;
}) {
  const operatorInputRequired =
    operator !== "sql_expr" && operator !== "saved_filter";

  const operatorOptions: SingleValue[] = [];
  const valueOptions: SingleValue[] = [];
  let inputType: "text" | "number" = "text";
  let isDateColumn = false;
  let displayOperator = operator;

  if (operatorInputRequired) {
    if (datatype === "number") inputType = "number";
    if (datatype === "date") isDateColumn = true;

    topValues?.forEach((v) => {
      if (v) valueOptions.push({ label: v, value: v });
    });

    // Booleans are stored as `= true`/`= false` but read better as
    // is_true/is_false. Derived for display only — writing it back onto the
    // filter during render would mutate the caller's state in place.
    if (datatype === "boolean" && operator === "=") {
      displayOperator = values?.[0] === "true" ? "is_true" : "is_false";
    }

    // An operator that no longer suits the column (or arrived via the API)
    // still has to be listed, or the select would show an empty value.
    const allowed = getAllowedOperators(datatype);
    const operatorsToShow = allowed.includes(displayOperator)
      ? allowed
      : [...allowed, displayOperator];

    operatorOptions.push(
      ...operatorsToShow.map((op) => ({
        label: operatorLabelMap[op],
        value: op,
      })),
    );
  }

  const valueInputRequired = !VALUELESS_OPERATORS.includes(operator);
  const multiValueInput = operator === "in" || operator === "not_in";
  const useValueOptions =
    valueOptions.length > 0 && ["in", "not_in", "=", "!="].includes(operator);

  // Keep already-chosen values selectable even when they aren't top values
  if (useValueOptions) {
    values?.forEach((v) => {
      if (v && !valueOptions.find((o) => o.value === v)) {
        valueOptions.push({ label: v, value: v });
      }
    });
  }

  return {
    operatorInputRequired,
    inputType,
    isDateColumn,
    displayOperator,
    operatorOptions,
    valueOptions,
    valueInputRequired,
    multiValueInput,
    useValueOptions,
  };
}

export type RowFilterInputState = ReturnType<typeof getRowFilterInputState>;
