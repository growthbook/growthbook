import { ColumnInterface, TopValuesSnapshot } from "shared/types/fact-table";

// The one read of a column's top values for both page views: counts from a
// refresh this session, then stored counts, then the plain list saved before
// counts existed
export function getColumnTopValues(
  column: Pick<
    ColumnInterface,
    "topValues" | "topValueCounts" | "topValuesDate"
  >,
  fresh?: { value: string; count: number }[],
): {
  values: TopValuesSnapshot["values"];
  hasCounts: boolean;
  refreshedAt: Date | null;
} {
  const counts =
    fresh ??
    (column.topValueCounts?.length ? column.topValueCounts : undefined);
  return {
    values: counts ?? (column.topValues || []).map((value) => ({ value })),
    hasCounts: !!counts,
    refreshedAt: column.topValuesDate ?? null,
  };
}
