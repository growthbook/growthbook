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

// "1 event", "2 events"; nouns here are regular, so "s" is enough
export function pluralize(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

// The note under a top values table, shared by the Values panel and the
// Events tab so the two can't drift
export function getTopValuesNote({
  count,
  noun,
  lookbackDays,
  hasCounts,
  countsUnavailable,
  canRefresh,
}: {
  count: number;
  // Singular, for example "value" or "event"
  noun: string;
  lookbackDays: number;
  hasCounts: boolean;
  countsUnavailable: boolean;
  canRefresh: boolean;
}): string {
  const base = `Top ${pluralize(count, noun)}${hasCounts ? " by row count" : ""} over the last ${lookbackDays} days.`;
  if (hasCounts)
    return `${base} Counts may be approximate on some Data Sources.`;
  if (countsUnavailable)
    return `${base} This Data Source can only rank ${noun}s, so row counts aren't shown.`;
  return canRefresh ? `${base} Refresh to load row counts.` : base;
}
