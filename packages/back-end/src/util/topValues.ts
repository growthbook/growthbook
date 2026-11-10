import { isEqual, omit, pick } from "lodash";
import { canInlineFilterColumn } from "shared/experiments";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/constants";
import {
  ColumnInterface,
  FactTableInterface,
  TopValuesSnapshot,
} from "shared/types/fact-table";

// Only updateColumnsTopValues writes these; every other column write keeps the
// stored ones
const TOP_VALUE_FIELDS = [
  "topValues",
  "topValueCounts",
  "topValuesDate",
] as const;

// The stored form of a snapshot. topValues is derived for Auto Slices and
// filter pickers; counts are kept only when every value has one.
export function getTopValueFields(snapshot: TopValuesSnapshot): {
  topValues: string[];
  topValueCounts: ColumnInterface["topValueCounts"];
  topValuesDate: Date;
} {
  const { values } = snapshot;
  const counts = values.flatMap((v) =>
    v.count === undefined ? [] : [{ value: v.value, count: v.count }],
  );
  return {
    topValues: values.map((v) => v.value),
    topValueCounts: counts.length === values.length ? counts : undefined,
    topValuesDate: snapshot.refreshedAt,
  };
}

export type TopValuesUpdate = {
  column: string;
  snapshot: TopValuesSnapshot;
  // How an Auto Slice column's levels follow the new top values; omitted
  // leaves them alone
  slices?: "fill" | "refill";
};

// Fills Auto Slice levels from top values, keeping any the column already has
export function populateAutoSlices(
  col: ColumnInterface,
  topValues: string[],
  maxValues?: number,
): string[] {
  if (col.datatype === "boolean") return ["true", "false"];
  if (col.autoSlices && col.autoSlices.length > 0) return col.autoSlices;
  return addTopValues([], topValues, maxValues);
}

// Rebuilds Auto Slice levels: locked levels first, then the new top values
export function refillAutoSlices(
  col: ColumnInterface,
  topValues: string[],
  maxValues?: number,
): string[] {
  return addTopValues([...(col.lockedAutoSlices || [])], topValues, maxValues);
}

function addTopValues(
  levels: string[],
  topValues: string[],
  maxValues = DEFAULT_MAX_METRIC_SLICE_LEVELS,
): string[] {
  for (const value of topValues) {
    if (levels.length >= maxValues) break;
    if (!levels.includes(value)) levels.push(value);
  }
  return levels;
}

// Columns whose top values are queried and stored
export function canHaveTopValues(
  factTable: Pick<
    FactTableInterface,
    "columns" | "userIdTypes" | "userIdColumns"
  >,
  col: ColumnInterface,
): boolean {
  return (
    col.datatype === "string" &&
    !col.deleted &&
    // Virtual columns aren't real columns in the SQL, so a top-values query
    // keyed on their name would be invalid.
    !col.isVirtual &&
    canInlineFilterColumn(factTable, col.column)
  );
}

// The fields an update writes onto a column: its top values as a unit, and
// Auto Slice levels when the update says how they follow
function getTopValuesUpdateFields(
  column: ColumnInterface,
  update: TopValuesUpdate,
  maxSliceLevels?: number,
): Partial<ColumnInterface> {
  const fields: Partial<ColumnInterface> = getTopValueFields(update.snapshot);
  const topValues = fields.topValues ?? [];
  const autoSlices = !column.isAutoSliceColumn
    ? undefined
    : update.slices === "fill"
      ? populateAutoSlices(column, topValues, maxSliceLevels)
      : update.slices === "refill" && topValues.length
        ? refillAutoSlices(column, topValues, maxSliceLevels)
        : undefined;
  if (autoSlices) {
    fields.autoSlices = autoSlices;
    fields.dateUpdated = new Date();
  }
  return fields;
}

// The positional write for stored columns: only the updated fields of each
// still-eligible column, so concurrent edits to anything else survive.
// Clears counts the snapshot doesn't have. Null when nothing applies.
// `changed` is false when only the refresh dates moved.
export function buildTopValuesWrite(
  current: Pick<
    FactTableInterface,
    "columns" | "userIdTypes" | "userIdColumns"
  >,
  updates: TopValuesUpdate[],
  maxSliceLevels?: number,
): {
  $set: Record<string, unknown>;
  $unset: Record<string, "">;
  arrayFilters: Record<string, string>[];
  changed: boolean;
} | null {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ""> = {};
  const arrayFilters: Record<string, string>[] = [];
  let changed = false;
  updates.forEach((update, i) => {
    const column = current.columns.find((c) => c.column === update.column);
    if (!column || !canHaveTopValues(current, column)) return;
    const id = `c${i}`;
    const fields = getTopValuesUpdateFields(column, update, maxSliceLevels);
    Object.entries({ topValueCounts: undefined, ...fields }).forEach(
      ([key, value]) => {
        if (value === undefined) $unset[`columns.$[${id}].${key}`] = "";
        else $set[`columns.$[${id}].${key}`] = value;
        if (key !== "topValuesDate" && key !== "dateUpdated") {
          changed ||= !isEqual(column[key as keyof ColumnInterface], value);
        }
      },
    );
    arrayFilters.push({ [`${id}.column`]: update.column });
  });
  return arrayFilters.length ? { $set, $unset, arrayFilters, changed } : null;
}

// A whole-column write carries each column's stored top values, never the
// caller's: a column that isn't stored yet gets none
export function keepStoredTopValues<T extends { column: string }>(
  stored: ColumnInterface[],
  incoming: T[],
): T[] {
  const byColumn = new Map(stored.map((c) => [c.column, c]));
  return incoming.map((column) => {
    const current = byColumn.get(column.column);
    return {
      ...omit(column, TOP_VALUE_FIELDS),
      ...(current && pick(current, TOP_VALUE_FIELDS)),
    } as T;
  });
}

// Matches the document only while every stored column still has the snapshot
// it was read with. Every top-values write sets topValuesDate, so a whole-column
// write filtered on this can't undo one that landed after its read.
export function storedTopValuesFilter(stored: ColumnInterface[]) {
  if (!stored.length) return {};
  return {
    $and: stored.map((c) => ({
      columns: {
        $elemMatch: {
          column: c.column,
          topValuesDate: c.topValuesDate ?? null,
        },
      },
    })),
  };
}
