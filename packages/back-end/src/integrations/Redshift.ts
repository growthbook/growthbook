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
  getInformationSchemaTableFromClause(): string {
    return "SVV_COLUMNS";
  }
  generateTableName(tableName?: string): string {
    if (tableName) {
      if (!this.params.database) {
        throw new MissingDatasourceParamsError(
          "To automatically generate metrics for an Athena data source, you must define a default database."
        );
      }
      if (!this.params.defaultSchema)
        throw new MissingDatasourceParamsError(
          "To automatically generate metrics for an Athena data source, you must define a default catalog."
        );
      return `${this.params.database}.${this.params.defaultSchema}.${tableName}`;
    } else {
      return "SVV_COLUMNS";
    }
  }
}
