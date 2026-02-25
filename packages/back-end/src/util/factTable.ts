import { ColumnInterface } from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

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
