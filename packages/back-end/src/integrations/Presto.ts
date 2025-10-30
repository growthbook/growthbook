/// <reference types="../../typings/presto-client" />
import { Client, IPrestoClientOptions } from "presto-client";
import { format } from "shared/sql";
import { FormatDialect } from "shared/src/types";
import { prestoCreateTablePartitions } from "shared/enterprise";
import { QueryStatistics } from "back-end/types/query";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { PrestoConnectionParams } from "back-end/types/integrations/presto";
import {
  QueryResponse,
  MaxTimestampIncrementalUnitsQueryParams,
  MaxTimestampMetricSourceQueryParams,
} from "back-end/src/types/Integration";
import SqlIntegration from "./SqlIntegration";

// eslint-disable-next-line
type Row = any;

export default class Presto extends SqlIntegration {
  params!: PrestoConnectionParams;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<PrestoConnectionParams>(encryptedParams);
  }
  getFormatDialect(): FormatDialect {
    return "trino";
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  toTimestamp(date: Date) {
    return `from_iso8601_timestamp('${date.toISOString()}')`;
  }
  isWritingTablesSupported(): boolean {
    return true;
  }
  runQuery(sql: string): Promise<QueryResponse> {
    const configOptions: IPrestoClientOptions = {
      host: this.params.host,
      port: this.params.port,
      user: "growthbook",
      source: this.params?.source || "growthbook",
      schema: this.params.schema,
      catalog: this.params.catalog,
      timeout: this.params.requestTimeout ?? 0,
      checkInterval: 500,
    };
    if (!this.params?.authType || this.params?.authType === "basicAuth") {
      configOptions.basic_auth = {
        user: this.params.username || "",
        password: this.params.password || "",
      };
    }
    if (this.params?.authType === "customAuth") {
      configOptions.custom_auth = this.params.customAuth || "";
    }
    if (this.params?.ssl) {
      configOptions.ssl = {
        ca: this.params?.caCert,
        cert: this.params?.clientCert || "",
        key: this.params?.clientKey,
        secureProtocol: "SSLv23_method",
      };
    }
    const client = new Client(configOptions);

    return new Promise<QueryResponse>((resolve, reject) => {
      let cols: string[];
      const rows: Row[] = [];
      const statistics: QueryStatistics = {};

      client.execute({
        query: sql,
        catalog: this.params.catalog,
        schema: this.params.schema,
        columns: (error, data) => {
          if (error) return;
          cols = data.map((d) => d.name);
        },
        error: (error) => {
          reject(error);
        },
        data: (error, data, _, stats) => {
          if (error) return;

          data.forEach((d) => {
            const row: Row = {};
            d.forEach((v, i) => {
              row[cols[i]] = v;
            });
            rows.push(row);
          });

          if (stats) {
            statistics.executionDurationMs = Number(stats.wallTimeMillis);
            statistics.bytesProcessed = Number(stats.processedBytes);
            statistics.rowsProcessed = Number(stats.processedRows);
            statistics.physicalWrittenBytes = Number(
              stats.physicalWrittenBytes,
            );
          }
        },
        success: () => {
          resolve({
            rows,
            columns: cols.map((col) => ({
              name: col,
            })),
            statistics,
          });
        },
      });
    });
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ): string {
    return `${col} ${sign} INTERVAL '${amount}' ${unit}`;
  }
  formatDate(col: string): string {
    return `substr(to_iso8601(${col}),1,10)`;
  }
  formatDateTimeString(col: string): string {
    return `to_iso8601(${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `date_diff('day', ${startCol}, ${endCol})`;
  }
  ensureFloat(col: string): string {
    return `CAST(${col} AS DOUBLE)`;
  }
  hasCountDistinctHLL(): boolean {
    return true;
  }
  hllAggregate(col: string): string {
    return `APPROX_SET(${col})`;
  }
  castToHyperLogLog(col: string): string {
    return `CAST(${col} AS HyperLogLog)`;
  }
  hllReaggregate(col: string): string {
    return `MERGE(${this.castToHyperLogLog(col)})`;
  }
  hllCardinality(col: string): string {
    return `CARDINALITY(${col})`;
  }
  getDefaultDatabase() {
    return this.params.catalog || "";
  }

  createTablePartitions(columns: string[]) {
    return prestoCreateTablePartitions(columns);
  }

  // FIXME(incremental-refresh): Consider using 2 separate queries to create table and insert data instead of ignored cteSql
  // NB: CREATE AS CTE does not work when inserting databecause of a bug with timestamp columns with Hive
  getExperimentUnitsTableQueryFromCte(
    unitsTableFullName: string,
    _cteSql: string,
  ): string {
    return format(
      `CREATE TABLE ${unitsTableFullName} (
        user_id ${this.getDataType("string")},
        variation ${this.getDataType("string")},
        first_exposure_timestamp ${this.getDataType("timestamp")}
    )
      ${this.createUnitsTableOptions()}
    `,
      this.getFormatDialect(),
    );
  }

  getTablePartitionsTableName(fullTableName: string) {
    const lastDotIndex = fullTableName.lastIndexOf(".");
    return lastDotIndex >= 0
      ? fullTableName.substring(0, lastDotIndex + 1) +
          `"${fullTableName.substring(lastDotIndex + 1)}$partitions"`
      : `"${fullTableName}$partitions"`;
  }

  getMaxTimestampIncrementalUnitsQuery(
    params: MaxTimestampIncrementalUnitsQueryParams,
  ): string {
    return format(
      `
      SELECT MAX(max_timestamp) AS max_timestamp
      FROM ${this.getTablePartitionsTableName(params.unitsTableFullName)}
      `,
      this.getFormatDialect(),
    );
  }

  getMaxTimestampMetricSourceQuery(
    params: MaxTimestampMetricSourceQueryParams,
  ): string {
    return format(
      `
      SELECT MAX(max_timestamp) AS max_timestamp
      FROM ${this.getTablePartitionsTableName(params.metricSourceTableFullName)}
      `,
      this.getFormatDialect(),
    );
  }
}
