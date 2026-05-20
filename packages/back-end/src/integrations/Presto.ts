import { Client, ClientOptions, QueryOptions } from "presto-client";
import { format } from "shared/sql";
import { parseIntWithDefault } from "shared/util";
import { SqlDialect } from "shared/types/sql";
import { prestoCreateTablePartitions } from "shared/enterprise";
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
import { logger } from "back-end/src/util/logger";
import SqlIntegration from "./SqlIntegration";
import { prestoDialect } from "./dialects/presto";

// eslint-disable-next-line
type Row = any;

// Unknown if there is an actual limit, using 2000 as this is the
// limit in Snowflake
const PRESTO_QUERY_TAG_MAX_LENGTH = 2000;

const DEFAULT_PRESTO_REQUEST_TIMEOUT_SEC = 3600;

export default class Presto extends SqlIntegration {
  params!: PrestoConnectionParams;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<PrestoConnectionParams>(encryptedParams);
  }
  getSqlDialect(): SqlDialect {
    return prestoDialect;
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  isWritingTablesSupported(): boolean {
    return true;
  }

  private createClient(): Client {
    const configOptions: ClientOptions = {
      engine: this.params.engine,
      host: this.params.host,
      port: this.params.port,
      source: this.params?.source || "growthbook",
      schema: this.params.schema,
      catalog: this.params.catalog,
      timeout: parseIntWithDefault(
        this.params.requestTimeout,
        DEFAULT_PRESTO_REQUEST_TIMEOUT_SEC,
      ),
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
    return new Client(configOptions);
  }

  async cancelQuery(externalId: string): Promise<void> {
    const client = this.createClient();
    return new Promise((resolve, reject) => {
      client.kill(externalId, (error) => {
        if (error) {
          logger.debug(
            `Failed to cancel Presto/Trino query ${externalId}: ${error.message}`,
          );
          reject(error);
        } else {
          logger.debug(`Cancelled Presto/Trino query ${externalId}`);
          resolve();
        }
      });
    });
  }

  runQuery(
    sql: string,
    setExternalId?: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<QueryResponse> {
    const engineHeaderName =
      this.params.engine === "presto" ? "Presto" : "Trino";
    const client = this.createClient();

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
        state: (_error, queryId) => {
          if (queryId && setExternalId) {
            setExternalId(queryId);
          }
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
        user_id ${this.getSqlDialect().getDataType("string")},
        variation ${this.getSqlDialect().getDataType("string")},
        first_exposure_timestamp ${this.getSqlDialect().getDataType("timestamp")}
    )
      ${this.createUnitsTableOptions()}
    `,
      this.getSqlDialect().formatDialect,
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
      this.getSqlDialect().formatDialect,
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
      this.getSqlDialect().formatDialect,
    );
  }
}
