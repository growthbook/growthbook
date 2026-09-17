import { format } from "shared/sql";
import type { EventLogSummaryQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

export interface EventLogTableConfig {
  eventsTable: string;
  experimentViewsTable: string;
  featureUsageTable: string;
}

/**
 * Dialect-agnostic summary query. Returns per-(event_name, day) rows for the
 * top N event names (by total count). The caller aggregates daily_counts arrays
 * from the flat rows.
 *
 * Pagination (limit/offset) applies to distinct event names, not to raw rows.
 * The query uses a CTE to rank event names by total_count, then joins back to
 * get per-day breakdowns only for the page's event names.
 */
export function getEventLogSummaryQuery(
  dialect: SqlDialect,
  params: EventLogSummaryQueryParams,
  tableConfig: EventLogTableConfig,
): string {
  const escapedKeys = params.clientKeys
    .map((k) => `'${dialect.escapeStringLiteral(k)}'`)
    .join(", ");
  const dateFrom = params.dateFrom;
  const dateTo = params.dateTo;

  const limit = Math.max(1, Math.min(100, Math.floor(params.limit)));
  const offset = Math.max(0, Math.floor(params.offset));

  const searchFilter = params.search
    ? `AND ${dialect.stringMatch("event_name", "contains", params.search)}`
    : "";

  const timeAndKeyFilter = `client_key IN (${escapedKeys})
      AND timestamp >= ${dialect.toTimestamp(dateFrom)}
      AND timestamp < ${dialect.toTimestamp(dateTo)}`;

  return format(
    `-- Event Log Summary
    WITH __daily AS (
      SELECT event_name, ${dialect.dateTrunc("timestamp", "day")} AS day,
        COUNT(*) AS day_count, COUNT(DISTINCT user_id) AS day_dau
      FROM ${tableConfig.eventsTable}
      WHERE ${timeAndKeyFilter}
      GROUP BY event_name, ${dialect.dateTrunc("timestamp", "day")}

      UNION ALL

      SELECT 'Experiment Viewed' AS event_name, ${dialect.dateTrunc("timestamp", "day")} AS day,
        COUNT(*) AS day_count, COUNT(DISTINCT user_id) AS day_dau
      FROM ${tableConfig.experimentViewsTable}
      WHERE ${timeAndKeyFilter}
      GROUP BY ${dialect.dateTrunc("timestamp", "day")}

      UNION ALL

      SELECT 'Feature Evaluated' AS event_name, ${dialect.dateTrunc("timestamp", "day")} AS day,
        COUNT(*) AS day_count, 0 AS day_dau
      FROM ${tableConfig.featureUsageTable}
      WHERE ${timeAndKeyFilter}
      GROUP BY ${dialect.dateTrunc("timestamp", "day")}
    ),
    __top_events AS (
      SELECT event_name, SUM(day_count) AS total_count
      FROM __daily
      WHERE 1=1 ${searchFilter}
      GROUP BY event_name
      ORDER BY total_count DESC
      LIMIT ${limit}
      OFFSET ${offset}
    )
    SELECT d.event_name, ${dialect.formatDate("d.day")} AS day,
      d.day_count, d.day_dau
    FROM __daily d
    JOIN __top_events t ON d.event_name = t.event_name
    ORDER BY t.total_count DESC, d.event_name, d.day
    `,
    dialect.formatDialect,
  );
}
