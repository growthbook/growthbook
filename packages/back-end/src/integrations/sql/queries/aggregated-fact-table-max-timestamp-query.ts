import { format } from "shared/sql";
import type { AggregatedFactTableMaxTimestampQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

// Returns the event-time high-water mark and event_date range, used to advance
// the registry watermark and coverage after a run.
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
