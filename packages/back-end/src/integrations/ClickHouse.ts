import { createClient, ResponseJSON } from "@clickhouse/client";
import {
  FeatureUsageAggregateRow,
  FeatureUsageLookback,
  QueryResponse,
} from "shared/types/integrations";
import { ClickHouseConnectionParams } from "shared/types/integrations/clickhouse";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { getHost } from "back-end/src/util/sql";
import { logger } from "back-end/src/util/logger";
import SqlIntegration from "./SqlIntegration";

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
  toTimestamp(date: Date) {
    return `toDateTime('${date
      .toISOString()
      .substr(0, 19)
      .replace("T", " ")}', 'UTC')`;
  }
  getCurrentTimestamp(): string {
    return `now()`;
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ): string {
    return `date${sign === "+" ? "Add" : "Sub"}(${unit}, ${amount}, ${col})`;
  }
  dateTrunc(col: string) {
    return `dateTrunc('day', ${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `dateDiff('day', ${startCol}, ${endCol})`;
  }
  formatDate(col: string): string {
    return `formatDateTime(${col}, '%F')`;
  }
  formatDateTimeString(col: string): string {
    return `formatDateTime(${col}, '%Y-%m-%d %H:%i:%S.%f')`;
  }
  ifElse(condition: string, ifTrue: string, ifFalse: string) {
    return `if(${condition}, ${ifTrue}, ${ifFalse})`;
  }
  castToDate(col: string): string {
    const columType = col === "NULL" ? "Nullable(DATE)" : "DATE";
    return `CAST(${col} AS ${columType})`;
  }
  castToString(col: string): string {
    return `toString(${col})`;
  }
  ensureFloat(col: string): string {
    return `toFloat64(${col})`;
  }
  hasCountDistinctHLL(): boolean {
    return true;
  }
  hllAggregate(col: string): string {
    return `uniqState(${col})`;
  }
  hllReaggregate(col: string): string {
    return `uniqMergeState(${col})`;
  }
  hllCardinality(col: string): string {
    return `finalizeAggregation(${col})`;
  }
  approxQuantile(value: string, quantile: string | number): string {
    return `quantile(${quantile})(${value})`;
    // TODO explore gains to using `quantiles`
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    if (isNumeric) {
      return `
if(
  toTypeName(${jsonCol}) = 'JSON', 
  toFloat64(${jsonCol}.${path}),
  JSONExtractFloat(${jsonCol}, '${path}')
)
      `;
    } else {
      return `
if(
  toTypeName(${jsonCol}) = 'JSON',
  ${jsonCol}.${path}.:String,
  JSONExtractString(${jsonCol}, '${path}')
)
      `;
    }
  }
  evalBoolean(col: string, value: boolean): string {
    // Clickhouse does not support `IS TRUE` / `IS FALSE`
    return `${col} = ${value ? "true" : "false"}`;
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
	  ${this.formatDateTimeString(roundedTimestamp)} as ts,
    environment,
    value,
    source,
    ruleId,
    variationId
  FROM feature_usage
	WHERE
	  timestamp > ${this.toTimestamp(start)}
	  AND feature = '${this.escapeStringLiteral(feature)}'
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
