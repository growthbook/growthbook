import { SnowflakeConnectionParams } from "../../types/integrations/snowflake";
import { decryptDataSourceParams } from "../services/datasource";
import { runSnowflakeQuery } from "../services/snowflake";
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
  getDateTable(startDate: Date, endDate: Date | null): string {
    const startDateTrunc: string = this.castToDate(this.toTimestamp(startDate));
    return `
      SELECT ${this.castToDate(startDateTrunc)} + VALUE::INT AS day
      FROM TABLE(FLATTEN(ARRAY_GENERATE_RANGE(
        0, 
        ${this.dateDiff(
          startDateTrunc,
          this.castToDate(
            endDate ? this.toTimestamp(endDate) : "CURRENT_DATE()"
          )
        )} +1
      )))
    `;
  }
  getInformationSchemaFromClause(): string {
    if (!this.params.database)
      throw new Error(
        "No database provided. In order to get the information schema, you must provide a database."
      );
    return `${this.params.database}.information_schema.columns`;
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('INFORMATION_SCHEMA')";
  }
  getInformationSchemaTableFromClause(databaseName: string): string {
    return `${databaseName}.information_schema.columns`;
  }
}
