import { toTimestampWithMs } from "back-end/src/integrations/sql/primitives/to-timestamp-with-ms";

// Predicate selecting rows strictly after a persisted watermark.
//
// Watermarks are read back from the warehouse as MAX(timestamp) and stored
// as a JavaScript Date, which only keeps millisecond precision. Warehouse
// timestamps usually carry microseconds, so a strict `> watermark` filter
// re-matches every row inside the watermark's last millisecond on the next
// refresh (e.g. rows at 12:00:00.999999 vs a stored 12:00:00.999), and the
// append-only caches then hold those rows twice. Treat the whole millisecond
// as already loaded by starting from the next one.
export function afterWatermark(column: string, watermark: Date): string {
  const nextMillisecond = new Date(watermark.getTime() + 1);
  return `${column} >= ${toTimestampWithMs(nextMillisecond)}`;
}
