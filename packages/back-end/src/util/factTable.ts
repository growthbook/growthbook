import { ColumnInterface } from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

/**
 * Returns the names of all identifier types declared on the datasource.
 *
 * All datasource types (including growthbook_clickhouse, which syncs
 * materializedColumns with type === "identifier" into userIdTypes on every
 * settings save) store their identifier types in datasource.settings.userIdTypes.
 *
 * Use this when validating a user-supplied userIdTypes list.
 */
export function getDatasourceIdentifierTypeNames(
  datasource: DataSourceInterface,
): string[] {
  return (datasource.settings?.userIdTypes || []).map((u) => u.userIdType);
}

/**
 * Derives the userIdTypes for a fact table by intersecting the datasource's
 * declared identifier types with the fact table's active (non-deleted) columns.
 *
 * All datasource types store their identifier types in
 * datasource.settings.userIdTypes (growthbook_clickhouse syncs its
 * materializedColumns with type === "identifier" into this field on every
 * settings save).
 */
export function deriveUserIdTypesFromColumns(
  datasource: DataSourceInterface,
  columns: ColumnInterface[],
): string[] {
  const activeColumns = new Set(
    columns.filter((c) => !c.deleted).map((c) => c.column),
  );

  return (datasource.settings?.userIdTypes || [])
    .map((u) => u.userIdType)
    .filter((id) => activeColumns.has(id));
}
