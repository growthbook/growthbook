import { ColumnInterface } from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

/**
 * Derives the userIdTypes for a fact table by intersecting the datasource's
 * declared identifier types with the fact table's active (non-deleted) columns.
 *
 * All datasource types store their identifier types in
 * `datasource.settings.userIdTypes`. For `growthbook_clickhouse`, the license
 * server regenerates that list from the org's attributeSchema on every
 * sync.
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
