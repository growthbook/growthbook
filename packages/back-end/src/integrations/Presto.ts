import { Client, ClientOptions, QueryOptions } from "presto-client";
import {
  isIngestYearMonthDayPartitionSettings,
  prestoCreateTablePartitions,
} from "shared/enterprise";
import { format } from "shared/sql";
import { FormatDialect } from "shared/types/sql";
import {
  QueryResponse,
  MaxTimestampIncrementalUnitsQueryParams,
  MaxTimestampMetricSourceQueryParams,
  ExternalIdCallback,
} from "shared/types/integrations";
import { QueryMetadata, QueryStatistics } from "shared/types/query";
import { PrestoConnectionParams } from "shared/types/integrations/presto";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { getKerberosHeader } from "back-end/src/util/kerberos.util";
import { getQueryTagString } from "back-end/src/util/integration";
import SqlIntegration from "./SqlIntegration";

// eslint-disable-next-line
type Row = any;

// Unknown if there is an actual limit, using 2000 as this is the
// limit in Snowflake
const PRESTO_QUERY_TAG_MAX_LENGTH = 2000;

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
  toTimestampWithMs(date: Date) {
    return this.toTimestamp(date);
  }
  isWritingTablesSupported(): boolean {
    return true;
  }
  runQuery(
    sql: string,
    setExternalId?: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<QueryResponse> {
    const engineHeaderName =
      this.params.engine === "presto" ? "Presto" : "Trino";

    const configOptions: ClientOptions = {
      engine: this.params.engine,
      host: this.params.host,
      port: this.params.port,
      source: this.params?.source || "growthbook",
      schema: this.params.schema,
      catalog: this.params.catalog,
      timeout: this.params.requestTimeout ?? 0,
      checkInterval: 500,
    };
    if (this.params.engine === "trino") {
      if (this.params.trinoUser) {
        configOptions.user = this.params.trinoUser;
      }
    } else {
      configOptions.user = this.params.user || "growthbook";
    }
    if (!this.params?.authType || this.params?.authType === "basicAuth") {
      configOptions.basic_auth = {
        user: this.params.username || "",
        password: this.params.password || "",
      };
    }
    if (this.params?.authType === "customAuth") {
      configOptions.custom_auth = this.params.customAuth || "";
    }
    if (this.params?.authType === "kerberos") {
      const servicePrincipal = this.params.kerberosServicePrincipal;
      const clientPrincipal = this.params.kerberosClientPrincipal;
      if (!servicePrincipal) {
        throw new Error(
          "Kerberos service principal is required for Kerberos authentication",
        );
      }

      if (this.params.kerberosUser) {
        configOptions.user = this.params.kerberosUser;
      }

      // Use a function to generate fresh Kerberos tokens for each request
      configOptions.custom_auth = () =>
        getKerberosHeader(servicePrincipal, clientPrincipal);
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

      const executeOptions: QueryOptions = {
        query: sql,
        catalog: this.params.catalog,
        schema: this.params.schema,
        headers: {
          [`X-${engineHeaderName}-Client-Info`]: getQueryTagString(
            queryMetadata ?? {},
            PRESTO_QUERY_TAG_MAX_LENGTH,
          ),
        },
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
              // @ts-expect-error - From our testing this does exist but types are not happy
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
      };

      client.execute(executeOptions);
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

  getMaxIngestedPartitionSourceQuery(
    params: Parameters<SqlIntegration["getMaxIngestedPartitionSourceQuery"]>[0],
  ): string | null {
    if (!params) return null;
    if (!isIngestYearMonthDayPartitionSettings(params.partitionSettings)) {
      return null;
    }

    const sourceTableFullName = this.getSimpleSourceTableName(params.sourceSql);
    if (!sourceTableFullName) {
      return null;
    }

    const partitionsTable =
      this.getTablePartitionsTableName(sourceTableFullName);

    const ingestCursorExpression = this.getIngestCursorExpression(
      params.partitionSettings,
      "p",
    );
    const lowerBound =
      params.lastIngestedPartition ??
      params.experimentStartDate.toISOString().slice(0, 10);
    const operator = params.lastIngestedPartition ? ">" : ">=";
    const upperBound = params.endDate?.toISOString().slice(0, 10);

    return format(
      `
      SELECT
        MAX(${ingestCursorExpression}) AS last_ingested_partition
      FROM ${partitionsTable} p
      WHERE ${ingestCursorExpression} ${operator} '${lowerBound}'
      ${upperBound ? `AND ${ingestCursorExpression} <= '${upperBound}'` : ""}
      `,
      this.getFormatDialect(),
    );
  }

  getMaxTimestampIncrementalUnitsQuery(
    params: MaxTimestampIncrementalUnitsQueryParams,
  ): string {
    const partitionsTable = this.getTablePartitionsTableName(
      params.unitsTableFullName,
    );

    // Ensures we scan only the last partition from units table
    if (params.includeLastIngestedPartition) {
      return format(
        `
        SELECT
          p.max_timestamp AS max_timestamp,
          MAX(u.last_ingested_partition) AS last_ingested_partition
        FROM ${params.unitsTableFullName} u
        JOIN (
          SELECT MAX(max_timestamp) AS max_timestamp
          FROM ${partitionsTable}
        ) p ON u.max_timestamp = p.max_timestamp
        GROUP BY p.max_timestamp
        `,
        this.getFormatDialect(),
      );
    }

    return format(
      `
      SELECT MAX(max_timestamp) AS max_timestamp
      FROM ${partitionsTable}
      `,
      this.getFormatDialect(),
    );
  }

  getMaxTimestampMetricSourceQuery(
    params: MaxTimestampMetricSourceQueryParams,
  ): string {
    const partitionsTable = this.getTablePartitionsTableName(
      params.metricSourceTableFullName,
    );

    // Ensures we scan only the last partition from metric source table
    if (params.includeLastIngestedPartition) {
      return format(
        `
        SELECT
          p.max_timestamp AS max_timestamp,
          MAX(t.last_ingested_partition) AS last_ingested_partition
        FROM ${params.metricSourceTableFullName} t
        JOIN (
          SELECT MAX(max_timestamp) AS max_timestamp
          FROM ${partitionsTable}
        ) p ON t.max_timestamp = p.max_timestamp
        GROUP BY p.max_timestamp
        `,
        this.getFormatDialect(),
      );
    }

    return format(
      `
      SELECT MAX(max_timestamp) AS max_timestamp
      FROM ${partitionsTable}
      `,
      this.getFormatDialect(),
    );
  }
}
