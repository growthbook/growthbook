import { createClient, ResponseJSON } from "@clickhouse/client";
import { decryptDataSourceParams } from "../services/datasource";
import { ClickHouseConnectionParams } from "../../types/integrations/clickhouse";
import {
  InsertTrackEventProps,
  QueryResponse,
  InsertFeatureUsageProps,
  FeatureUsageAggregateRow,
  FeatureUsageLookback,
} from "../types/Integration";
import { getHost } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class ClickHouse extends SqlIntegration {
  params!: ClickHouseConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<ClickHouseConnectionParams>(
      encryptedParams
    );

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
      host: getHost(this.params.url, this.params.port),
      username: this.params.username,
      password: this.params.password,
      database: this.params.database,
      application: "GrowthBook",
      request_timeout: 3620_000,
      clickhouse_settings: {
        max_execution_time: Math.min(
          this.params.maxExecutionTime ?? 1800,
          3600
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
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
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
  castToString(col: string): string {
    return `toString(${col})`;
  }
  ensureFloat(col: string): string {
    return `toFloat64(${col})`;
  }
  approxQuantile(value: string, quantile: string | number): string {
    return `quantile(${quantile})(${value})`;
    // TODO explore gains to using `quantiles`
  }
  getInformationSchemaWhereClause(): string {
    if (!this.params.database)
      throw new Error(
        "No database name provided in ClickHouse connection. Please add a database by editing the connection settings."
      );
    return `table_schema IN ('${this.params.database}')`;
  }

  async createAutoTrackTables(): Promise<void> {
    const dbName = this.datasource.id;
    await this.runQuery(`CREATE DATABASE IF NOT EXISTS ${dbName}`);

    // Create table for event tracking
    await this.runQuery(`
CREATE TABLE IF NOT EXISTS ${dbName}.events (
  uuid UUID,
  timestamp DateTime,
  anonymous_id String,
  event_name String,
  value Float64,
  properties String,
  browser String,
  deviceType String,
  url String,
  path String,
  host String,
  query String,
  pageTitle String,
  utmSource String,
  utmMedium String,
  utmCampaign String,
  utmTerm String,
  utmContent String
) ENGINE = MergeTree() PARTITION BY toYYYYMM(timestamp) ORDER BY (timestamp)`);

    // Create table for feature flag usage tracking
    await this.runQuery(`
CREATE TABLE IF NOT EXISTS ${dbName}.ff_usage (
  timestamp DateTime,
  feature String,
  env String,
  revision String,
  ruleId String,
  variationId String
) 
  ENGINE = MergeTree() 
  PARTITION BY toYYYYMMDD(timestamp) 
  ORDER BY (timestamp)`);
  }

  escape(value: unknown): string {
    if (typeof value !== "string") return "NULL";
    return `'${value.replace(/'/g, "''")}'`;
  }

  async insertTrackEvent({
    event_name,
    attributes,
    properties,
    value,
  }: InsertTrackEventProps): Promise<void> {
    const dbName = this.datasource.id;
    await this.runQuery(`
INSERT INTO ${dbName}.events (
  uuid,
  timestamp,
  anonymous_id,
  event_name,
  value,
  properties,
  browser,
  deviceType,
  url,
  path,
  host,
  query,
  pageTitle,
  utmSource,
  utmMedium,
  utmCampaign,
  utmTerm,
  utmContent
) VALUES (
  generateUUIDv4(),
  now(),
  ${this.escape(attributes?.anonymous_id)},
  ${this.escape(event_name)},
  ${value ?? "NULL"},
  ${this.escape(JSON.stringify(properties))},
  ${this.escape(attributes?.browser)},
  ${this.escape(attributes?.deviceType)},
  ${this.escape(attributes?.url)},
  ${this.escape(attributes?.path)},
  ${this.escape(attributes?.host)},
  ${this.escape(attributes?.query)},
  ${this.escape(attributes?.pageTitle)},
  ${this.escape(attributes?.utmSource)},
  ${this.escape(attributes?.utmMedium)},
  ${this.escape(attributes?.utmCampaign)},
  ${this.escape(attributes?.utmTerm)},
  ${this.escape(attributes?.utmContent)}
)`);
  }

  async insertFeatureUsage(data: InsertFeatureUsageProps): Promise<void> {
    const dbName = this.datasource.id;
    await this.runQuery(`
INSERT INTO ${dbName}.ff_usage (
  timestamp,
  feature,
  env,
  revision,
  ruleId,
  variationId
) VALUES (
  now(),
  ${this.escape(data.feature)},
  ${this.escape(data.env)},
  ${this.escape(data.revision)},
  ${this.escape(data.ruleId)},
  ${this.escape(data.variationId)}
)`);
  }

  async getFeatureUsage(
    feature: string,
    lookback: FeatureUsageLookback
  ): Promise<FeatureUsageAggregateRow[]> {
    const start = new Date();
    let roundedTimestamp = "";
    if (lookback === "15minute") {
      roundedTimestamp = "toStartOfMinute(timestamp)";
      start.setMinutes(start.getMinutes() - 15);
    } else if (lookback === "hour") {
      start.setHours(start.getHours() - 1);
      roundedTimestamp = "toStartOfFiveMinutes(timestamp)";
    } else if (lookback === "day") {
      start.setDate(start.getDate() - 1);
      roundedTimestamp = "toStartOfHour(timestamp)";
    } else if (lookback === "week") {
      start.setDate(start.getDate() - 7);
      roundedTimestamp = "toStartOfInterval(timestamp, INTERVAL 6 HOUR)";
    } else {
      throw new Error(`Invalid lookback: ${lookback}`);
    }

    const dbName = this.datasource.id;
    const res = await this.runQuery(`
WITH _data as (
	SELECT
	  ${roundedTimestamp} as timestamp,
    env,
    ruleId,
    variationId
  FROM ${dbName}.ff_usage
	WHERE
	  timestamp > ${this.toTimestamp(start)}
	  AND feature = ${this.escape(feature)}
)
SELECT
  timestamp,
  env,
  ruleId,
  variationId,
  COUNT(*) as evaluations
FROM _data
GROUP BY
  timestamp,
  env,
  ruleId,
  variationId,
      `);

    return res.rows.map((row) => ({
      timestamp: new Date(row.timestamp),
      env: "" + row.env,
      revision: "" + row.revision,
      ruleId: "" + row.ruleId,
      variationId: "" + row.variationId,
      evaluations: 0 + row.evaluations,
    }));
  }
}
