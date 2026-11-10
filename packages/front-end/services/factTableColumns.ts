import {
  ColumnInterface,
  FactTableInterface,
  TopValuesSnapshot,
  UpdateColumnProps,
} from "shared/types/fact-table";
import { canInlineFilterColumn } from "shared/experiments";

// The one read of a column's top values for both page views: counts from a
// refresh this session, then stored counts, then the plain list saved before
// counts existed
export function getColumnTopValues(
  column: Pick<
    ColumnInterface,
    "topValues" | "topValueCounts" | "topValuesDate"
  >,
  fresh?: { value: string; count: number }[],
): {
  values: TopValuesSnapshot["values"];
  hasCounts: boolean;
  refreshedAt: Date | null;
} {
  const counts =
    fresh ??
    (column.topValueCounts?.length ? column.topValueCounts : undefined);
  return {
    values: counts ?? (column.topValues || []).map((value) => ({ value })),
    hasCounts: !!counts,
    refreshedAt: column.topValuesDate ?? null,
  };
}

// The one save policy for editing a column, shared by every column editor.
// Returns the request body, and whether the column then needs its top values
// loaded to fill a new string Auto Slice's levels.
export function prepareColumnUpdate(
  factTable: Pick<
    FactTableInterface,
    "userIdTypes" | "userIdColumns" | "columns"
  >,
  column: ColumnInterface,
  changes: UpdateColumnProps,
): { data: UpdateColumnProps; loadTopValues: boolean } {
  const data = { ...changes };
  const datatype = data.datatype ?? column.datatype;

  // Value mappings only apply while filtering
  if (data.alwaysInlineFilter === false) data.conditionalInlineFilters ??= {};
  if (data.alwaysInlineFilter) {
    const updated = {
      ...factTable,
      columns: factTable.columns.map((c) =>
        c.column === column.column ? { ...c, datatype } : c,
      ),
    };
    if (!canInlineFilterColumn(updated, column.column)) {
      data.alwaysInlineFilter = false;
    }
  }

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
