import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { decryptDataSourceParams } from "../services/datasource";
import { runPostgresQuery } from "../services/postgres";
import { MissingDatasourceParamsError } from "../types/Integration";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Redshift extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: PostgresConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PostgresConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    return "redshift";
  }
  getSensitiveParamKeys(): string[] {
    return ["password", "caCert", "clientCert", "clientKey"];
  }
  runQuery(sql: string) {
    return runPostgresQuery(this.params, sql);
  }
  getSchema(): string {
    return this.params.defaultSchema || "";
  }
  formatDate(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  }
  formatDateTimeString(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  }
  ensureFloat(col: string): string {
    return `${col}::float`;
  }
  generateTableName(
    tableName: string,
    schemaName?: string,
    databaseName?: string
  ): string {
    if (tableName === "columns" && schemaName === "information_schema")
      return "SVV_COLUMNS";

    const database = databaseName || this.params.database;
    const schema = schemaName || this.params.defaultSchema;

    if (!database) {
      throw new MissingDatasourceParamsError(
        "No database provided. Please edit the connection settings and try again."
      );
    }

    if (!schema)
      throw new MissingDatasourceParamsError(
        "No default schema provided. Please edit the connection settings and try again."
      );

    return `${database}.${schema}.${tableName}`;
  }
}
