import { MaterializedColumn } from "shared/types/datasource";
import {
  ColumnRef,
  FactMetricInterface,
  JSONColumnFields,
} from "shared/types/fact-table";
import { MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN } from "shared/util";

/**
 * Map of legacy materialized-column `columnName` -> the JSON-path column expression
 * (`attributes.<sourceField>`) that replaces it once a managed warehouse switches to
 * native JSON columns.
 *
 * Only non-identifier columns that won't survive as real top-level columns are
 * rewritten:
 * - `identifier` columns are re-derived as SELECT-list aliases by the identifier
 *   sync, so references to them keep resolving and need no rewrite.
 * - columns whose name collides with a reserved top-level column (e.g. `geo_country`,
 *   `url_path`) still exist as that real column after migration, so they're left as-is.
 */
export function buildMaterializedColumnRewriteMap(
  materializedColumns: MaterializedColumn[],
  reservedColumnNames: Set<string>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const col of materializedColumns) {
    if (col.type === "identifier") continue;
    if (reservedColumnNames.has(col.columnName.toLowerCase())) continue;
    map[col.columnName] =
      `${MANAGED_WAREHOUSE_ATTRIBUTES_COLUMN}.${col.sourceField}`;
  }
  return map;
}

/**
 * The `attributes` JSON sub-fields (keyed by `sourceField`, the JSON path) for the
 * same rewritten materialized columns, carrying their declared `datatype`. Seeding
 * these onto the `attributes` column during migration preserves the type metadata a
 * rewritten metric ref (`attributes.<sourceField>`) needs to pass the exact same
 * aggregation validation it passed as a real top-level column — otherwise the field's
 * datatype reads as unknown and e.g. `count distinct` is wrongly rejected.
 */
export function buildMaterializedColumnJsonFields(
  materializedColumns: MaterializedColumn[],
  reservedColumnNames: Set<string>,
): JSONColumnFields {
  const fields: JSONColumnFields = {};
  for (const col of materializedColumns) {
    if (col.type === "identifier") continue;
    if (reservedColumnNames.has(col.columnName.toLowerCase())) continue;
    fields[col.sourceField] = { datatype: col.datatype };
  }
  return fields;
}

/**
 * Rewrite the column references in a single ColumnRef (the metric column itself, the
 * aggregate-filter column, and each row-filter column) through the rewrite map.
 * Returns the (possibly unchanged) ColumnRef plus whether anything was rewritten.
 *
 * Only the managed-warehouse events fact table had materialized columns, so refs that
 * point at any other fact table on the same datasource (e.g. a user's custom fact table
 * that happens to share a column name) are left untouched to avoid rewriting them to a
 * JSON path that doesn't exist there.
 */
export function rewriteColumnRef(
  ref: ColumnRef,
  map: Record<string, string>,
  eventsFactTableId: string,
): { columnRef: ColumnRef; changed: boolean } {
  if (ref.factTableId !== eventsFactTableId) {
    return { columnRef: ref, changed: false };
  }

  let changed = false;
  const remap = (column: string): string => {
    const replacement = map[column];
    if (replacement === undefined) return column;
    changed = true;
    return replacement;
  };

  const columnRef: ColumnRef = { ...ref, column: remap(ref.column) };

  if (ref.aggregateFilterColumn !== undefined) {
    columnRef.aggregateFilterColumn = remap(ref.aggregateFilterColumn);
  }

  if (ref.rowFilters) {
    columnRef.rowFilters = ref.rowFilters.map((rf) =>
      rf.column !== undefined && map[rf.column] !== undefined
        ? { ...rf, column: remap(rf.column) }
        : rf,
    );
  }

  return { columnRef, changed };
}

/**
 * Compute the numerator/denominator updates for a fact metric whose columns point at
 * legacy materialized columns. Returns null when nothing needs to change.
 */
export function rewriteFactMetricColumns(
  metric: Pick<FactMetricInterface, "numerator" | "denominator">,
  map: Record<string, string>,
  eventsFactTableId: string,
): { numerator: ColumnRef; denominator: ColumnRef | null } | null {
  const numerator = rewriteColumnRef(metric.numerator, map, eventsFactTableId);
  const denominator = metric.denominator
    ? rewriteColumnRef(metric.denominator, map, eventsFactTableId)
    : null;

  if (!numerator.changed && !(denominator?.changed ?? false)) return null;

  return {
    numerator: numerator.columnRef,
    denominator: denominator ? denominator.columnRef : null,
  };
}
