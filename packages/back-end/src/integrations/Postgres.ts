import { FormatDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import SqlIntegration from "./SqlIntegration";

export default class Postgres extends SqlIntegration {
  params!: PostgresConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<PostgresConnectionParams>(encryptedParams);
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
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `JSON_EXTRACT_PATH_TEXT(${jsonCol}::json, ${path
      .split(".")
      .map((p) => `'${p}'`)
      .join(", ")})`;
    return isNumeric ? this.ensureFloat(raw) : raw;
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')";
  }
  approxQuantile(value: string, quantile: string | number): string {
    // no approx in postgres
    return `PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`;
  }
}
