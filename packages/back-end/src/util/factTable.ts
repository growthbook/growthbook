import { ColumnInterface } from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

/**
 * Returns the names of all identifier types declared on the datasource.
 *
 * For growthbook_clickhouse, these come from materializedColumns with
 * type === "identifier". For all other datasources they come from
 * datasource.settings.userIdTypes.
 *
 * Use this when validating a user-supplied userIdTypes list.
 */
export function getDatasourceIdentifierTypeNames(
  datasource: DataSourceInterface,
): string[] {
  if (datasource.type === "growthbook_clickhouse") {
    return (datasource.settings.materializedColumns || [])
      .filter((c) => c.type === "identifier")
      .map((c) => c.columnName);
  }
  return (datasource.settings?.userIdTypes || []).map((u) => u.userIdType);
}

/**
 * Derives the userIdTypes for a fact table by intersecting the datasource's
 * declared identifier types with the fact table's active (non-deleted) columns.
 *
 * For growthbook_clickhouse datasources, identifier types come from
 * materializedColumns with type === "identifier" (ClickHouse-specific concept).
 * For all other datasources, they come from datasource.settings.userIdTypes.
 */
export function deriveUserIdTypesFromColumns(
  datasource: DataSourceInterface,
  columns: ColumnInterface[],
): string[] {
  const activeColumns = new Set(
    columns.filter((c) => !c.deleted).map((c) => c.column),
  );

  if (datasource.type === "growthbook_clickhouse") {
    return (datasource.settings.materializedColumns || [])
      .filter((c) => c.type === "identifier")
      .map((c) => c.columnName)
      .filter((id) => activeColumns.has(id));
  }

  return (datasource.settings?.userIdTypes || [])
    .map((u) => u.userIdType)
    .filter((id) => activeColumns.has(id));
}
