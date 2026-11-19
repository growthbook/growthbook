import { ColumnInterface, TopValuesSnapshot } from "shared/types/fact-table";

// The one read of a column's top values for both page views: counts from a
// refresh this session, unless the stored ones are newer (a later column
// refresh or SQL edit), then stored counts, then the plain list saved before
// counts existed
// Warehouses that can only rank values return them without counts
function hasAnyCount(values: { count?: number }[]): boolean {
  return values.some((v) => v.count !== undefined);
}

export function getColumnTopValues(
  column: Pick<
    ColumnInterface,
    "topValues" | "topValueCounts" | "topValuesDate"
  >,
  fresh?: { values: TopValuesSnapshot["values"]; refreshedAt: Date },
): {
  values: TopValuesSnapshot["values"];
  hasCounts: boolean;
  // A refresh this session returned no counts, so the Data Source can only
  // rank values. Stored lists can't tell: older columns also lack counts.
  countsUnavailable: boolean;
  refreshedAt: Date | null;
} {
  // Dates arrive from JSON as strings, so normalize before comparing
  const storedAt = column.topValuesDate ? new Date(column.topValuesDate) : null;
  if (fresh && (!storedAt || storedAt <= fresh.refreshedAt)) {
    return {
      values: fresh.values,
      hasCounts: hasAnyCount(fresh.values),
      countsUnavailable: !hasAnyCount(fresh.values),
      refreshedAt: fresh.refreshedAt,
    };
  }
  const counts = column.topValueCounts?.length
    ? column.topValueCounts
    : undefined;
  return {
    values: counts ?? (column.topValues || []).map((value) => ({ value })),
    hasCounts: !!counts && hasAnyCount(counts),
    countsUnavailable: false,
    refreshedAt: storedAt,
  };
}
