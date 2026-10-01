import {
  FEATURE_USAGE_BUCKET_SECONDS,
  getFeatureUsageWindowStart,
} from "shared/featureUsageBuckets";
import { createClient, ResponseJSON } from "@clickhouse/client";
import {
  FeatureEvalDiagnosticsQueryParams,
  FeatureUsageMarginalRow,
  FeatureUsageLookback,
  QueryResponse,
} from "shared/types/integrations";
import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";
import {
  isManagedWarehouse,
  isManagedWarehouseAwaitingProvisioning,
  isManagedWarehouseMigrating,
  ManagedWarehousePendingError,
} from "shared/util";
import { SqlDialect } from "shared/types/sql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { getHost } from "back-end/src/util/sql";
import { logger } from "back-end/src/util/logger";
import { LAST_RECEIVED_LOOKBACK_DAYS } from "back-end/src/util/warehouseLookback";

/**
 * Safety valve on the per-dimension marginal scan.
 *
 * Marginals are far smaller than a cross product — four sums of
 * (buckets x distinct values) rather than their product — so this is a guard
 * against a pathological flag (thousands of rule ids) rather than a bound that
 * engages routinely. Ordered by volume, so if it ever does engage it drops the
 * least significant groups first.
 */
/**
 * Caps the marginal scan's RESULT SET, not its read.
 *
 * It sits after GROUP BY / ORDER BY, so ClickHouse scans the same granules and
 * runs the same aggregation whatever this is set to — bytes scanned, which is
 * what the customer is billed on, do not move. What it bounds is the rows
 * transferred, the top-N heap ClickHouse keeps while ranking, and the parse
 * cost here. All three are cheap at this scale.
 *
 * Raised 5000 -> 15000 alongside the 2-hour week buckets. Finer buckets split
 * the same evaluations across ~3x more rows, so at 5000 the truncation bit
 * roughly three times deeper on a high-cardinality flag — the window would have
 * gained resolution by losing coverage. This keeps 7 days at 2 hours as
 * truthful as it was at 6.
 */
export const FEATURE_USAGE_MARGINAL_LIMIT = 15000;
import {
  getFeatureEvalDiagnosticsNarrowingSql,
  resolveFeatureEvalDiagnosticsWindow,
} from "back-end/src/integrations/sql/queries/feature-eval-diagnostics-window";
import SqlIntegration from "./SqlIntegration";
import { clickHouseDialect } from "./dialects/clickhouse";

// Matches ClickHouse DateTime/DateTime64 column types with no explicit
// timezone argument (e.g. "DateTime", "DateTime64(3)", "Nullable(DateTime64(3))").
// Types with an explicit timezone (e.g. "DateTime('UTC')") contain a quote
// and are intentionally excluded, since their naive-string rendering already
// reflects that declared zone rather than needing this override.
const NAIVE_CLICKHOUSE_DATETIME_TYPE =
  /^Nullable\(DateTime(64\(\d+\))?\)$|^DateTime(64\(\d+\))?$/;

// Managed warehouse DateTime/DateTime64 columns carry no explicit timezone,
// so ClickHouse renders them as bare "YYYY-MM-DD HH:mm:ss[.ffffff]" strings
// (no "Z"/offset) in UTC, GrowthBook's convention for that schema. JS's
// `new Date(...)` parses that shape as local time on whatever host runs the
// app server, silently shifting it. Append "Z" so it's parsed as UTC instead.
function normalizeManagedWarehouseDatetimes(
  // eslint-disable-next-line
  rows: Record<string, any>[],
  meta: Array<{ name: string; type: string }> | undefined,
): void {
  const dateCols = (meta ?? [])
    .filter((col) => NAIVE_CLICKHOUSE_DATETIME_TYPE.test(col.type))
    .map((col) => col.name);
  if (!dateCols.length) return;

  for (const row of rows) {
    for (const col of dateCols) {
      const value = row[col];
      if (typeof value === "string") {
        row[col] = value.replace(" ", "T") + "Z";
      }
    }
  }
}

export default class ClickHouse extends SqlIntegration {
  params!: ClickHouseConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<ClickHouseConnectionParams>(encryptedParams);

    if (this.params.user) {
      this.params.username = this.params.user;
      delete this.params.user;
    }
    if (this.params.host) {
      this.params.url = this.params.host;
      delete this.params.host;
    }
  }
  getSqlDialect(): SqlDialect {
    return clickHouseDialect;
  }

  async testConnection(): Promise<boolean> {
    if (isManagedWarehouseAwaitingProvisioning(this.datasource)) {
      return true;
    }
    return super.testConnection();
  }

  async runQuery(sql: string): Promise<QueryResponse> {
    // Block queries while never-provisioned OR mid-migration (tables being recreated).
    // Reuse the pending error so existing UI surfaces show the managed-warehouse callout;
    // the callout distinguishes the migrating case for honest "upgrading" copy.
    if (
      isManagedWarehouseAwaitingProvisioning(this.datasource) ||
      isManagedWarehouseMigrating(this.datasource)
    ) {
      throw new ManagedWarehousePendingError();
    }
    const client = createClient({
      url: getHost(this.params.url, this.params.port),
      username: this.params.username,
      password: this.params.password,
      database: this.params.database,
      application: "GrowthBook",
      request_timeout: 3620_000,
      clickhouse_settings: {
        max_execution_time: Math.min(
          this.params.maxExecutionTime ?? 1800,
          3600,
        ),
        // Managed warehouse only: allow bare Dynamic JSON paths
        // (`attributes.x` / `properties.x`) in GROUP BY / ORDER BY. Generated
        // SQL always casts, so this only affects hand-written queries; gated to
        // managed warehouses because customer ClickHouse versions may not know
        // these settings.
        ...(isManagedWarehouse(this.datasource)
          ? {
              allow_suspicious_types_in_group_by: 1,
              allow_suspicious_types_in_order_by: 1,
            }
          : {}),
      },
    });
    const results = await client.query({ query: sql, format: "JSON" });
    // eslint-disable-next-line
    const data: ResponseJSON<Record<string, any>[]> = await results.json();
    const rows = data.data ? data.data : [];
    if (isManagedWarehouse(this.datasource)) {
      normalizeManagedWarehouseDatetimes(rows, data.meta);
    }
    return {
      rows,
      statistics: data.statistics
        ? {
            executionDurationMs: data.statistics.elapsed,
            rowsProcessed: data.statistics.rows_read,
            bytesProcessed: data.statistics.bytes_read,
          }
        : undefined,
    };
  }

  getInformationSchemaWhereClause(): string {
    if (!this.params.database)
      throw new Error(
        "No database name provided in ClickHouse connection. Please add a database by editing the connection settings.",
      );

    // For Managed Warehouse, filter out materialized views
    const extraWhere =
      this.datasource.type === "growthbook_clickhouse"
        ? " AND table_name NOT LIKE '%_mv'"
        : "";

    return `table_schema IN ('${this.params.database}')${extraWhere}`;
  }

  getFeatureEvalDiagnosticsQuery(
    params: FeatureEvalDiagnosticsQueryParams,
  ): string {
    if (this.datasource.type === "growthbook_clickhouse") {
      const featureKey = this.getSqlDialect().escapeStringLiteral(
        params.feature,
      );
      const { start: windowStart, limit } =
        resolveFeatureEvalDiagnosticsWindow(params);
      return `SELECT
        timestamp,
        feature AS feature_key,
        environment,
        value,
        source,
        ruleId,
        variationId
      FROM feature_usage
      WHERE feature = '${featureKey}'
        AND timestamp >= ${this.getSqlDialect().toTimestamp(windowStart)}${getFeatureEvalDiagnosticsNarrowingSql(
          params,
          this.getSqlDialect(),
          // feature_usage has ruleId and no rule_id.
          { rule_id: "ruleId" },
        )}
      ORDER BY timestamp DESC
      LIMIT ${limit}`;
    }
    return super.getFeatureEvalDiagnosticsQuery(params);
  }

  async getFeatureUsage(
    feature: string,
    lookback: FeatureUsageLookback,
    /**
     * Environments the org recognises. Filtered here in SQL and nowhere else:
     * a marginal grouped by `value` carries no environment column for a caller
     * to filter on afterwards, so this is the only place it can happen.
     */
    environments?: string[],
  ): Promise<{
    start: number;
    total: number;
    marginals: FeatureUsageMarginalRow[];
    marginalLimit: number;
  }> {
    logger.info(
      `Getting feature usage for ${feature} with lookback ${lookback}`,
    );
    if (!(lookback in FEATURE_USAGE_BUCKET_SECONDS)) {
      throw new Error(`Invalid lookback: ${lookback}`);
    }

    /**
     * Window start and bucket width both come from the shared table, which the
     * controller's bucket skeleton and the front end's dummy generator also
     * read. These rows are placed INTO that skeleton, so the two agreeing is
     * not a nicety — a mismatch of one bucket edge drops rows into a bucket
     * that does not exist.
     *
     * One `toStartOfInterval … SECOND` for every lookback rather than the four
     * named helpers this used (toStartOfMinute / FiveMinutes / Hour, and an
     * explicit HOUR interval). They are equivalent at these widths — all of
     * them align to epoch-anchored boundaries, and 30s, 5m, 1h and 2h divide
     * the hour and the day evenly — and a single expression is what lets the
     * width be read from the table instead of restated per branch.
     */
    const start = getFeatureUsageWindowStart(lookback);
    const roundedTimestamp = `toStartOfInterval(timestamp, INTERVAL ${FEATURE_USAGE_BUCKET_SECONDS[lookback]} SECOND)`;

    // A true count for the window. Kept as its own aggregate rather than
    // summed from the marginals: a marginal is per dimension, so summing one of
    // them would be a total for that dimension only, and picking which
    // dimension to trust is not a decision this should be making.
    // Built once and applied to BOTH queries below. The count is the window's
    // `total`; scoped by environment only in the marginals, it would compare
    // an all-environments total against scoped rows, and every scoped view
    // would report a shortfall that is not one.
    const envFilter =
      environments && environments.length
        ? `AND environment IN (${environments
            .map((e) => `'${this.getSqlDialect().escapeStringLiteral(e)}'`)
            .join(", ")})`
        : "";

    const totalRes = await this.runQuery(`
      SELECT COUNT(*) as total
      FROM feature_usage
      WHERE
        timestamp > ${this.getSqlDialect().toTimestamp(start)}
        AND feature = '${this.getSqlDialect().escapeStringLiteral(feature)}'
        ${envFilter}
      `);

    /**
     * Per-dimension marginals in ONE scan.
     *
     * `arrayJoin` pivots each source row into four labelled rows before
     * aggregation, so a single pass over `feature_usage` yields all four
     * marginals. The alternative — four grouped queries UNION ALL'd, or four
     * separate calls — reads the same granules four times, and on a columnar
     * store billed by bytes scanned the I/O dominates. Fanning out in memory
     * after the read is CPU on rows already in flight.
     *
     * Chosen over GROUP BY GROUPING SETS deliberately: that needs the
     * GROUPING() function to tell which set a row came from, whereas the
     * labels here are explicit values in the projection, so nothing depends on
     * how a non-participating column defaults.
     */
    const marginalRes = await this.runQuery(`
      SELECT
        pair.1 AS dimension,
        ts,
        pair.2 AS group_value,
        COUNT(*) AS evaluations
      FROM (
        SELECT
          ${this.getSqlDialect().formatDateTimeString(roundedTimestamp)} AS ts,
          arrayJoin([
            ('value', value),
            ('source', source),
            ('ruleId', ruleId),
            ('environment', environment)
          ]) AS pair
        FROM feature_usage
        WHERE
          timestamp > ${this.getSqlDialect().toTimestamp(start)}
          AND feature = '${this.getSqlDialect().escapeStringLiteral(feature)}'
          ${envFilter}
      )
      GROUP BY dimension, ts, group_value
      ORDER BY evaluations DESC
      LIMIT ${FEATURE_USAGE_MARGINAL_LIMIT}
      `);

    return {
      start: start.getTime(),
      total: parseFloat(totalRes.rows[0]?.total ?? "0"),
      marginalLimit: FEATURE_USAGE_MARGINAL_LIMIT,
      marginals: marginalRes.rows.map((row) => ({
        dimension: "" + row.dimension,
        timestamp: new Date(row.ts.includes("T") ? row.ts : row.ts + "Z"),
        group: "" + row.group_value,
        evaluations: parseFloat(row.evaluations),
      })),
      // Reported rather than assumed by the caller: the cap belongs to whoever
      // ran the query.
    };
  }

  /**
   * Lifetime-ish facts, bounded by LAST_RECEIVED_LOOKBACK_DAYS. Deliberately
   * separate from getFeatureUsage: neither value can change when the selected
   * window changes, so riding on that call would re-run this scan on every
   * lookback flip and on every poll, for an answer that cannot have moved.
   *
   * The bound is why the caller says "no evaluations in the last N days" rather
   * than "never" — an unbounded max() here is a full-table scan, and claiming
   * "never" on the strength of a 90-day window would be a certainty this query
   * does not establish.
   */
  async getFeatureUsageSummary(feature: string): Promise<{
    lastEvaluated: string | null;
    lifetimeTotal: number;
    lookbackDays: number;
  }> {
    const res = await this.runQuery(`
      SELECT
        MAX(timestamp) as last_evaluated,
        COUNT(*) as lifetime_total
      FROM feature_usage
      WHERE
        feature = '${this.getSqlDialect().escapeStringLiteral(feature)}'
        AND timestamp >= now() - INTERVAL ${LAST_RECEIVED_LOOKBACK_DAYS} DAY
      `);

    const row = res.rows[0];
    const lifetimeTotal = parseFloat(row?.lifetime_total ?? "0");
    return {
      // MAX over no rows comes back as ClickHouse's zero date rather than null,
      // so an empty result is detected by the count, not by the timestamp.
      lastEvaluated:
        lifetimeTotal > 0 && row?.last_evaluated
          ? new Date(
              row.last_evaluated.includes("T")
                ? row.last_evaluated
                : row.last_evaluated + "Z",
            ).toISOString()
          : null,
      lifetimeTotal,
      lookbackDays: LAST_RECEIVED_LOOKBACK_DAYS,
    };
  }
}
