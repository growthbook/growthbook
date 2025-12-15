import { snowflakeCreateTableOptions } from "shared/enterprise";
import { FormatDialect } from "shared/types/sql";
import {
  QueryResponse,
  DataType,
  ExternalIdCallback,
} from "shared/types/integrations";
import { SnowflakeConnectionParams } from "back-end/types/integrations/snowflake";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runSnowflakeQuery } from "back-end/src/services/snowflake";
import { QueryMetadata } from "back-end/types/query";
import SqlIntegration from "./SqlIntegration";

export default class Snowflake extends SqlIntegration {
  params!: SnowflakeConnectionParams;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<SnowflakeConnectionParams>(encryptedParams);
  }
  isWritingTablesSupported(): boolean {
    return true;
  }
  createUnitsTableOptions() {
    if (!this.datasource.settings.pipelineSettings) {
      throw new Error("Pipeline settings are required to create a units table");
    }
    return snowflakeCreateTableOptions(
      this.datasource.settings.pipelineSettings,
    );
  }
  getFormatDialect(): FormatDialect {
    return "snowflake";
  }
  getSensitiveParamKeys(): string[] {
    return ["password", "privateKey", "privateKeyPassword"];
  }
  runQuery(
    sql: string,
    setExternalId?: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<QueryResponse> {
    return runSnowflakeQuery(this.params, sql, setExternalId, queryMetadata);
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
  hasCountDistinctHLL(): boolean {
    return true;
  }
  hllAggregate(col: string): string {
    return `HLL_ACCUMULATE(${col})`;
  }
  hllReaggregate(col: string): string {
    return `HLL_COMBINE(${col})`;
  }
  hllCardinality(col: string): string {
    return `HLL_ESTIMATE(${col})`;
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    return `PARSE_JSON(${jsonCol}):${path}::${isNumeric ? "float" : "string"}`;
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('INFORMATION_SCHEMA')";
  }
  getDefaultDatabase() {
    return this.params.database || "";
  }
  getDataType(dataType: DataType): string {
    switch (dataType) {
      case "string":
        return "VARCHAR";
      case "integer":
        return "INTEGER";
      case "float":
        return "DOUBLE";
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "timestamp":
        return "TIMESTAMP";
      case "hll":
        return "BINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  }
}
