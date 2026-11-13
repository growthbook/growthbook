import {
  ColumnInterface,
  FactTableInterface,
  FactMetricInterface,
  RowFilter,
} from "shared/types/fact-table";

// Column names the new Fact Table flow treats as an event name
export const INLINE_FILTER_CANDIDATES = [
  "event_name",
  "eventName",
  "event_type",
  "eventType",
  "event",
  "se_action",
];

/**
 * Event Columns: string columns whose values name the event each row records.
 * Only event tables have them. The new Fact Table flow saves its "Event name"
 * mapping as alwaysInlineFilter. Tables created before tableType existed count
 * as event tables when one of those columns has a conventional event name.
 */
export function getEventColumns(
  factTable: Pick<FactTableInterface, "columns" | "tableType">,
): ColumnInterface[] {
  const columns = factTable.columns.filter(
    (c) => c.alwaysInlineFilter && c.datatype === "string" && !c.deleted,
  );
  if (factTable.tableType === "event") return columns;
  const legacyEventTable =
    !factTable.tableType &&
    columns.some((c) =>
      INLINE_FILTER_CANDIDATES.some(
        (name) => name.toLowerCase() === c.column.toLowerCase(),
      ),
    );
  return legacyEventTable ? columns : [];
}

/**
 * Events a Fact Metric filters this Fact Table to with `=` or `in` on one of
 * `columns`: one entry per funnel step or compound component, otherwise the numerator's events and
 * then the denominator's.
 */
export function getMetricEvents(
  metric: FactMetricInterface,
  factTableId: string,
  columns: string[],
): string[] {
  const events = (
    ref?: { factTableId: string; rowFilters?: RowFilter[] } | null,
  ) =>
    ref?.factTableId === factTableId
      ? (ref.rowFilters || [])
          .filter(
            (f) =>
              columns.includes(f.column ?? "") &&
              (f.operator === "=" || f.operator === "in"),
          )
          .flatMap((f) => f.values || [])
      : [];
  // Funnel steps and compound components are separate events, so keep each
  if (metric.funnelSettings || metric.compoundSettings) {
    return [
      ...(metric.funnelSettings?.steps || []),
      ...(metric.compoundSettings?.components || []),
    ]
      .map((s) => events(s).join(", "))
      .filter(Boolean);
  }
  return [
    ...new Set([...events(metric.numerator), ...events(metric.denominator)]),
  ];
}

/**
 * Fact Metrics that filter this Fact Table to one event: a numerator,
 * denominator, funnel step, or compound component on the table whose row filters match `event`
 * on the Event Column with `=` or `in`.
 */
export function getMetricsForEvent(
  metrics: FactMetricInterface[],
  factTableId: string,
  column: string,
  event: string,
): FactMetricInterface[] {
  const matches = (factTable: string, rowFilters: RowFilter[] = []) =>
    factTable === factTableId &&
    rowFilters.some(
      (f) =>
        f.column === column &&
        (f.operator === "=" || f.operator === "in") &&
        !!f.values?.includes(event),
    );
  return metrics.filter(
    (m) =>
      (m.numerator &&
        matches(m.numerator.factTableId, m.numerator.rowFilters)) ||
      (m.denominator &&
        matches(m.denominator.factTableId, m.denominator.rowFilters)) ||
      [
        ...(m.funnelSettings?.steps || []),
        ...(m.compoundSettings?.components || []),
      ].some((s) => matches(s.factTableId, s.rowFilters)),
  );
}
