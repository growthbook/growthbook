import { createClient, ResponseJSON } from "@clickhouse/client";
import {
  FeatureUsageAggregateRow,
  FeatureUsageLookback,
  QueryResponse,
} from "shared/types/integrations";
import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";
import { SqlDialect } from "shared/types/sql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { getHost } from "back-end/src/util/sql";
import { logger } from "back-end/src/util/logger";
import SqlIntegration from "./SqlIntegration";
import { clickHouseDialect } from "./dialects/clickhouse";

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

  async runQuery(sql: string): Promise<QueryResponse> {
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
      },
    });
    const results = await client.query({ query: sql, format: "JSON" });
    // eslint-disable-next-line
    const data: ResponseJSON<Record<string, any>[]> = await results.json();
    return {
      rows: data.data ? data.data : [],
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

    const res = await this.runQuery(`
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
      `);

    return {
      start: start.getTime(),
      rows: res.rows.map((row) => ({
        timestamp: new Date(row.ts + "Z"),
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
