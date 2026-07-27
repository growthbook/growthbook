import { format } from "shared/sql";
import type { AggregatedFactTableMaxTimestampQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { toDateLiteral } from "back-end/src/integrations/sql/primitives/to-date-literal";

export function getAggregatedFactTableMaxTimestampQuery(
  dialect: SqlDialect,
  params: AggregatedFactTableMaxTimestampQueryParams,
): string {
  return format(
    `
    SELECT
      MAX(max_timestamp) AS max_timestamp
      -- Only returns a meaningful event_date on full-restate runs.
      , MIN(event_date) AS first_event_date
      , MAX(event_date) AS last_event_date
    FROM ${params.tableFullName}
    WHERE event_date >= ${dialect.castToDate(toDateLiteral(params.scanStartDate))}
    `,
    dialect.formatDialect,
  );
}
