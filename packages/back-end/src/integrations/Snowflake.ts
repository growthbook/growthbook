import { SnowflakeConnectionParams } from "../../types/integrations/snowflake";
import { decryptDataSourceParams } from "../services/datasource";
import { runSnowflakeQuery } from "../services/snowflake";
import { MissingDatasourceParamsError } from "../types/Integration";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Snowflake extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: SnowflakeConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<SnowflakeConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    return "snowflake";
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  runQuery(sql: string) {
    return runSnowflakeQuery(this.params, sql);
  }
  formatDate(col: string): string {
    return `TO_VARCHAR(${col}, 'YYYY-MM-DD')`;
  }
  formatDateTimeString(col: string): string {
    return `TO_VARCHAR(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  }
  castToString(col: string): string {
    return `TO_VARCHAR(${col})`;
  }
  ensureFloat(col: string): string {
    return `CAST(${col} AS DOUBLE)`;
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('INFORMATION_SCHEMA')";
  }
  generateTableName(
    tableName: string,
    schemaName?: string,
    databaseName?: string
  ): string {
    const database = databaseName || this.params.database;
    const schema = schemaName || this.params.schema;

    if (!database) {
      throw new MissingDatasourceParamsError(
        "No database provided. Please edit the connection settings and try again."
      );
    }

    if (!schema)
      throw new MissingDatasourceParamsError(
        "No schema provided. Please edit the connection settings and try again."
      );

    return `${database}.${schema}.${tableName}`;
  }
}
