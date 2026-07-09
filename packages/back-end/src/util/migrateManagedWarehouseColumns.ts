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

/**
 * Settings patch to leave behind once a migration run settles, given whether the per-org
 * tables were recreated as JSON (`recreated`) and whether the warehouse is still awaiting
 * migration afterward (`stillAwaiting` — `materializedColumns` not yet cleared, i.e. the
 * run didn't finish). Returns `null` to stay in the `migrating` state.
 *
 *   recreated │ stillAwaiting │ result
 *   ──────────┼───────────────┼──────────────────────────────────────────────────────
 *    true     │ false         │ { migrating: false }       full success → unblock
 *    true     │ true          │ null                       tables JSON but rewrite
 *             │               │                            unfinished → keep blocked so
 *             │               │                            the next query re-triggers
 *             │               │                            (queries would otherwise hit
 *             │               │                            "Unknown identifier")
 *    false    │ (any)         │ { migrating: false,        recreate never ran; tables
 *             │               │   useJsonColumns: false }   still legacy → revert the flag
 */
export function resolveMigrationFinalState(opts: {
  recreated: boolean;
  stillAwaiting: boolean;
}): { migrating: false; useJsonColumns?: false } | null {
  if (opts.recreated) {
    return opts.stillAwaiting ? null : { migrating: false };
  }
  return { migrating: false, useJsonColumns: false };
}
