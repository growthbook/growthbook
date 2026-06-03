import { format } from "shared/sql";
import type { AggregatedFactTableMaxTimestampQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

// Reconciles the registry watermark + coverage against the materialized table.
// Returns the event-time high-water mark (`MAX(max_timestamp)`) used to advance
// `lastMaxTimestamp`, plus `MIN/MAX(event_date)` used for `firstEventDate` /
// `lastEventDate`. Mirrors `getMaxTimestampMetricSourceQuery`.
export function getAggregatedFactTableMaxTimestampQuery(
  dialect: SqlDialect,
  params: AggregatedFactTableMaxTimestampQueryParams,
): string {
  return format(
    `
    SELECT
      MAX(max_timestamp) AS max_timestamp
      , MIN(event_date) AS first_event_date
      , MAX(event_date) AS last_event_date
    FROM ${params.tableFullName}
    `,
    dialect.formatDialect,
  );
}
