import { snowflakeCreateTableOptions } from "enterprise";
import { decryptDataSourceParams } from "@back-end/src/services/datasource";
import { runSnowflakeQuery } from "@back-end/src/services/snowflake";
import { FormatDialect } from "@back-end/src/util/sql";
import { SnowflakeConnectionParams } from "@back-end/types/integrations/snowflake";
import { QueryResponse } from "@back-end/src/types/Integration";
import SqlIntegration from "./SqlIntegration";

export default class Snowflake extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: SnowflakeConnectionParams;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<SnowflakeConnectionParams>(
      encryptedParams
    );
  }
  isWritingTablesSupported(): boolean {
    return true;
  }
  createUnitsTableOptions() {
    return snowflakeCreateTableOptions(this.settings.pipelineSettings ?? {});
  }
  getFormatDialect(): FormatDialect {
    return "snowflake";
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  runQuery(sql: string): Promise<QueryResponse> {
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
  getDefaultDatabase() {
    return this.params.database || "";
  }
}
