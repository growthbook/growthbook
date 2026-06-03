import { ColumnInterface } from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

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

// Throws if any selected id type isn't one of the fact table's userIdTypes.
export function validateAggregatedFactTableIdTypes(
  aggregatedFactTableIdTypes: string[],
  userIdTypes: string[],
): void {
  for (const idType of aggregatedFactTableIdTypes) {
    if (!userIdTypes.includes(idType)) {
      throw new Error(
        `Invalid aggregatedFactTableIdTypes entry "${idType}": must be one of the fact table's userIdTypes`,
      );
    }
  }
}
