import { MaterializedColumn } from "shared/types/datasource";

/**
 * The non-identifier materialized columns (dimensions) a managed warehouse should
 * preserve when it switches to native JSON columns. Each is re-exposed as a top-level
 * SELECT alias out of the `attributes` JSON column (see managedWarehouse.ts), so bare
 * references to it keep resolving without rewriting any stored SQL.
 *
 * Excluded:
 * - `identifier` columns — handled separately as join-key aliases / `migratedIdentifiers`.
 * - columns whose name collides with a reserved top-level column (e.g. `geo_country`,
 *   `url_path`) — they still exist as that real column after migration.
 */
export function getMigratedDimensionColumns(
  materializedColumns: MaterializedColumn[],
  reservedColumnNames: Set<string>,
): MaterializedColumn[] {
  return materializedColumns.filter(
    (col) =>
      col.type !== "identifier" &&
      !reservedColumnNames.has(col.columnName.toLowerCase()),
  );
}
