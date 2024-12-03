import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import { QueryResponse } from "back-end/src/types/Integration";
import { FormatDialect } from "back-end/src/util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Postgres extends SqlIntegration {
  params!: PostgresConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PostgresConnectionParams>(
      encryptedParams
    );
  }
  hasCountDistinctHLL(): boolean {
    return false;
  }
  hllAggregate(): string {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source."
    );
  }
  hllReaggregate(): string {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source."
    );
  }
  hllCardinality(): string {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source."
    );
  }
  getFormatDialect(): FormatDialect {
    return "postgresql";
  }
  getSensitiveParamKeys(): string[] {
    return ["password", "caCert", "clientCert", "clientKey"];
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runPostgresQuery(this.params, sql);
  }
  getSchema(): string {
    return this.params.defaultSchema || "";
  }
  dateDiff(startCol: string, endCol: string) {
    return `${endCol}::DATE - ${startCol}::DATE`;
  }
  ensureFloat(col: string): string {
    return `${col}::float`;
  }
  formatDate(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  }
  formatDateTimeString(col: string): string {
    return `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')";
  }
  approxQuantile(value: string, quantile: string | number): string {
    // no approx in postgres
    return `PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`;
  }
}
