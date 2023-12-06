import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { decryptDataSourceParams } from "../services/datasource";
import { runPostgresQuery } from "../services/postgres";
import { QueryResponse } from "../types/Integration";
import { FormatDialect } from "../util/sql";
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

  supportsUnnesting(): boolean {
    return true;
  }

  formatJSONObj(obj: Record<string, string>) {
    // TODO: On Redshift, CONCAT only works with 2 arguments so need to nest multiple CONCAT calls
    return `CONCAT('{',${Object.entries(obj)
      .map(([k, v]) => `'"${k}":', ${v}`)
      .join(",")},'}')::json`;
  }

  unnest(objects: Record<string, string>[]): string {
    return `unnest(ARRAY[
      ${objects.map((obj) => this.formatJSONObj(obj)).join(",\n")}
      ]) as data`;
  }

  extractUnnestedData(key: string): string {
    return `data -> '${key}'`;
  }
}
