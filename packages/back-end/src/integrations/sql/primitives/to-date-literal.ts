// Date-only SQL literal (e.g. '2025-10-24') for DATE columns; a full timestamp
// literal can't be implicitly cast to DATE in some warehouses (e.g. BigQuery).
export function toDateLiteral(date: Date): string {
  return `'${date.toISOString().substring(0, 10)}'`;
}
