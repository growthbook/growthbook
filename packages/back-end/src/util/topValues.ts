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

// The stored form of a snapshot: one ranked list, each value with its count
// when the query returned one
export function getTopValueFields(snapshot: TopValuesSnapshot): {
  topValueCounts: NonNullable<ColumnInterface["topValueCounts"]>;
  topValuesDate: Date;
} {
  return {
    // A missing count is left off, so the list compares equal to the stored one
    topValueCounts: snapshot.values.map(({ value, count }) =>
      (count ?? null) === null ? { value } : { value, count },
    ),
    topValuesDate: snapshot.refreshedAt,
  };
}

// Only topValueCounts is stored; topValues is always read from it, so the two
// can't disagree. Columns saved before counts existed have only topValues.
export function withDerivedTopValues(column: ColumnInterface): ColumnInterface {
  const topValueCounts = column.topValueCounts?.length
    ? column.topValueCounts
    : column.topValues?.length
      ? column.topValues.map((value) => ({ value }))
      : undefined;
  return {
    ...column,
    topValueCounts,
    topValues: (topValueCounts ?? []).map((v) => v.value),
  };
}

// What a column write stores: everything but the derived topValues
export function toStoredColumn<T extends object>(column: T) {
  return omit(column, "topValues");
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

// Columns a background refresh queries for top values. The writer only needs
// the column to still exist, so on-demand and Auto Slice refreshes of other
// columns (virtual ones, or one whose new type isn't saved yet) persist too.
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
    // Virtual columns get top values on demand (column modal, Auto Slice
    // job), not from a schema refresh.
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
  const topValues = update.snapshot.values.map((v) => v.value);
  const autoSlices = !column.isAutoSliceColumn
    ? undefined
    : update.slices === "fill"
      ? populateAutoSlices(column, topValues, maxSliceLevels)
      : update.slices === "refill"
        ? refillAutoSlices(column, topValues, maxSliceLevels)
        : undefined;
  if (autoSlices) {
    fields.autoSlices = autoSlices;
    fields.dateUpdated = new Date();
  }
  return fields;
}

// The positional write for stored columns: only the updated fields of each
// still-existing column, so concurrent edits to anything else survive.
// Clears a topValues list stored before counts existed. Skips an update with
// no values, since an empty result may be transient: the column keeps its last
// snapshot and Auto Slice levels. Null when nothing applies.
// `changed` is false when only the refresh dates moved. `filter` matches only
// while each column whose Auto Slice levels it rewrites still has the slice
// settings they were built from, so a concurrent slice save isn't undone.
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
  filter: Record<string, unknown>;
  changed: boolean;
} | null {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ""> = {};
  const arrayFilters: Record<string, string>[] = [];
  const guards: Record<string, unknown>[] = [];
  let changed = false;
  updates.forEach((update, i) => {
    const column = current.columns.find((c) => c.column === update.column);
    if (!column || column.deleted || !update.snapshot.values.length) return;
    const id = `c${i}`;
    const fields = getTopValuesUpdateFields(column, update, maxSliceLevels);
    if (fields.autoSlices) {
      guards.push({
        columns: {
          $elemMatch: {
            column: column.column,
            isAutoSliceColumn: true,
            datatype: column.datatype,
            autoSlices: storedArray(column.autoSlices),
            lockedAutoSlices: storedArray(column.lockedAutoSlices),
          },
        },
      });
    }
    $unset[`columns.$[${id}].topValues`] = "";
    Object.entries(fields).forEach(([key, value]) => {
      $set[`columns.$[${id}].${key}`] = value;
      if (key !== "topValuesDate" && key !== "dateUpdated") {
        changed ||= !isEqual(column[key as keyof ColumnInterface], value);
      }
    });
    arrayFilters.push({ [`${id}.column`]: update.column });
  });
  const filter = guards.length ? { $and: guards } : {};
  return arrayFilters.length
    ? { $set, $unset, arrayFilters, filter, changed }
    : null;
}

// Mongoose loads a missing array as [], so an empty one may be stored as
// either
function storedArray(values: string[] | undefined) {
  return values?.length ? values : { $in: [[], null] };
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
