import type { SqlDialect } from "shared/types/sql";

import { toTimestampWithMs } from "back-end/src/integrations/sql/primitives/to-timestamp-with-ms";
import { logger } from "back-end/src/util/logger";

// An incremental-refresh watermark is MAX(timestamp) over the rows a cache
// already holds. The persisted Date is millisecond precision, but warehouse
// timestamps usually carry more, so the same query also asks the warehouse to
// print the value at full precision (SqlDialect.formatTimestampExact) and that
// string is persisted verbatim and written back into the filter as a literal.

// The shape every formatTimestampExact implementation produces.
const RAW_WATERMARK = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3,9}$/;

// Validates a `max_timestamp_raw` value against the Date parsed from the
// same row. Null when absent, malformed, or not the same millisecond as the
// Date: the two columns disagreeing means one was rendered in another zone,
// and the +1ms fallback is safer than a literal we can't vouch for.
export function rawWatermark(date: Date | null, value: unknown): string | null {
  if (!date || typeof value !== "string" || !RAW_WATERMARK.test(value)) {
    if (date && value) {
      logger.warn({ value }, "Ignoring malformed exact watermark");
    }
    return null;
  }
  const ms = Date.parse(`${value.slice(0, 23).replace(" ", "T")}Z`);
  if (ms !== date.getTime()) {
    logger.warn(
      { value, date },
      "Ignoring exact watermark that disagrees with its Date",
    );
    return null;
  }
  return value;
}

// Predicate selecting rows strictly after a persisted watermark.
//
// With the exact `raw` value this is a plain `>` against that value, written
// back as the dialect's exactTimestampLiteral. Without it we only have the
// millisecond-truncated Date, and a strict `> date` would re-match every row
// inside the watermark's last millisecond on the next refresh (rows at
// 12:00:00.999999 vs a stored 12:00:00.999), so the append-only caches would
// hold those rows twice. Starting from the next millisecond instead trades
// that for skipping a row that arrives late with a timestamp inside that
// sub-millisecond remainder, which the serial-arrival assumption already
// tolerates for anything at or before the watermark.
export function afterWatermark(
  dialect: Pick<SqlDialect, "castToTimestamp" | "exactTimestampLiteral">,
  column: string,
  watermark: Date,
  raw?: string | null,
): string {
  if (raw && RAW_WATERMARK.test(raw)) {
    const quoted = `'${raw}'`;
    const literal = dialect.exactTimestampLiteral
      ? dialect.exactTimestampLiteral(quoted)
      : dialect.castToTimestamp(quoted);
    return `${column} > ${literal}`;
  }
  const nextMillisecond = new Date(watermark.getTime() + 1);
  return `${column} >= ${toTimestampWithMs(nextMillisecond)}`;
}
