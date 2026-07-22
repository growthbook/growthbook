import { randomUUID } from "crypto";
import { subDays } from "date-fns";
import { createClient, ResponseJSON } from "@clickhouse/client";
import {
  FeatureEvalDiagnosticsQueryParams,
  FeatureUsageAggregateRow,
  FeatureUsageLookback,
  QueryResponse,
  ExternalIdCallback,
} from "shared/types/integrations";
import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";
import {
  isManagedWarehouse,
  isManagedWarehouseAwaitingJsonMigration,
  isManagedWarehouseAwaitingProvisioning,
  isManagedWarehouseMigrating,
  ManagedWarehousePendingError,
} from "shared/util";
import { SqlDialect } from "shared/types/sql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { queueMigrateManagedWarehouse } from "back-end/src/jobs/migrateManagedWarehouse";
import { getHost } from "back-end/src/util/sql";
import { logger } from "back-end/src/util/logger";
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
  getSensitiveParamKeys(): string[] {
    return ["password"];
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

  private getClient() {
    return createClient({
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
      },
    });
  }

  async runQuery(sql: string): Promise<QueryResponse> {
    // Legacy (materialized-column) managed warehouses migrate to native JSON
    // columns on first use — enqueued async + deduped so it never blocks the query.
    // Runs before the guards below so a warehouse left mid-migration (pending +
    // matcols still present) OR stuck fully-migrated-but-still-`migrating` (the
    // flag clear failed) can re-trigger and recover itself on next use.
    if (
      isManagedWarehouseAwaitingJsonMigration(this.datasource) ||
      isManagedWarehouseMigrating(this.datasource)
    ) {
      void queueMigrateManagedWarehouse(this.datasource.organization).catch(
        (e) =>
          logger.error(e, "Failed to queue managed warehouse JSON migration"),
      );
    }
    // Block queries while never-provisioned OR mid-migration (tables being recreated).
    // Reuse the pending error so existing UI surfaces show the managed-warehouse callout;
    // the callout distinguishes the migrating case for honest "upgrading" copy.
    if (
      isManagedWarehouseAwaitingProvisioning(this.datasource) ||
      isManagedWarehouseMigrating(this.datasource)
    ) {
      throw new ManagedWarehousePendingError();
    }
    const client = this.getClient();

    const queryId = randomUUID();
    if (setExternalId) {
      await setExternalId(queryId);
    }

    const results = await client.query({
      query_id: queryId,
      query: sql,
      format: "JSON",
    });
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

  // Resolve the cluster to target for cluster-aware statements. The managed
  // warehouse runs on ClickHouse Cloud, whose predefined cluster is `default`;
  // a bare KILL only reaches the replica that receives it, so it must broadcast.
  private resolveCluster(): string | null {
    if (this.params.cluster) return this.params.cluster;
    if (this.datasource.type === "growthbook_clickhouse") return "default";
    return null;
  }

  private onClusterClause(): string {
    const cluster = this.resolveCluster();
    if (!cluster) return "";
    if (!/^[a-zA-Z0-9_]+$/.test(cluster)) {
      throw new Error(`Invalid ClickHouse cluster name: ${cluster}`);
    }
    return ` ON CLUSTER \`${cluster}\``;
  }

  async cancelQuery(externalId: string): Promise<void> {
    if (isManagedWarehouseAwaitingProvisioning(this.datasource)) {
      throw new ManagedWarehousePendingError();
    }
    const client = this.getClient();

    // KILL QUERY is async by default — this returns once ClickHouse accepts
    // the request, not once the target query has actually stopped.
    await client.command({
      query: `KILL QUERY${this.onClusterClause()} WHERE query_id = {qid:String}`,
      query_params: { qid: externalId },
    });
    logger.info({ externalId }, "ClickHouse cancel request accepted");
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
      const oneWeekAgo = subDays(new Date(), 7);
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
        AND timestamp >= ${this.getSqlDialect().toTimestamp(oneWeekAgo)}
      ORDER BY timestamp DESC
      LIMIT 100`;
    }
    return super.getFeatureEvalDiagnosticsQuery(params);
  }

  async getFeatureUsage(
    feature: string,
    lookback: FeatureUsageLookback,
  ): Promise<{ start: number; rows: FeatureUsageAggregateRow[] }> {
    logger.info(
      `Getting feature usage for ${feature} with lookback ${lookback}`,
    );
    const start = new Date();
    start.setSeconds(0, 0);
    let roundedTimestamp = "";
    if (lookback === "15minute") {
      roundedTimestamp = "toStartOfMinute(timestamp)";
      start.setMinutes(start.getMinutes() - 15);
    } else if (lookback === "hour") {
      start.setHours(start.getHours() - 1);
      start.setMinutes(0);
      roundedTimestamp = "toStartOfFiveMinutes(timestamp)";
    } else if (lookback === "day") {
      start.setHours(start.getHours() - 24);
      start.setMinutes(0);
      roundedTimestamp = "toStartOfHour(timestamp)";
    } else if (lookback === "week") {
      start.setDate(start.getDate() - 7);
      start.setHours(0);
      start.setMinutes(0);
      roundedTimestamp = "toStartOfInterval(timestamp, INTERVAL 6 HOUR)";
    } else {
      throw new Error(`Invalid lookback: ${lookback}`);
    }

    const res = await this.runQuery(
      `
WITH _data as (
	SELECT
	  ${this.getSqlDialect().formatDateTimeString(roundedTimestamp)} as ts,
    environment,
    value,
    source,
    ruleId,
    variationId
  FROM feature_usage
	WHERE
	  timestamp > ${this.getSqlDialect().toTimestamp(start)}
	  AND feature = '${this.getSqlDialect().escapeStringLiteral(feature)}'
)
  SELECT
    ts,
    environment,
    value,
    source,
    ruleId,
    variationId,
    COUNT(*) as evaluations
  FROM _data
  GROUP BY
    ts,
    environment,
    value,
    source,
    ruleId,
    variationId
  ORDER BY evaluations DESC
  LIMIT 200
      `,
      undefined,
    );

    return {
      start: start.getTime(),
      rows: res.rows.map((row) => ({
        timestamp: new Date(row.ts.includes("T") ? row.ts : row.ts + "Z"),
        environment: "" + row.environment,
        value: "" + row.value,
        source: "" + row.source,
        revision: "" + row.revision,
        ruleId: "" + row.ruleId,
        variationId: "" + row.variationId,
        evaluations: parseFloat(row.evaluations),
      })),
    };
  }
}
