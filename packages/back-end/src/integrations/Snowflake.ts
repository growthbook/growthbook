import { snowflakeCreateTableOptions } from "shared/enterprise";
import { FormatDialect } from "shared/types/sql";
import {
  QueryResponse,
  DataType,
  ExternalIdCallback,
} from "shared/types/integrations";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { QueryMetadata } from "shared/types/query";
import { ColumnInterface } from "shared/types/fact-table";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runSnowflakeQuery } from "back-end/src/services/snowflake";
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
  public supportsEfficientTopValues(): boolean {
    return true;
  }
  protected getTopValuesCTEBody({
    columns,
    start,
    limit,
  }: {
    columns: ColumnInterface[];
    start: Date;
    limit: number;
  }): string {
    // Unpivot via LATERAL FLATTEN over an array of OBJECTs so the fact table
    // is scanned once regardless of how many columns we're sampling.
    const objects = columns
      .map(
        (c) =>
          `OBJECT_CONSTRUCT('column_name', '${c.column}', 'value', ${this.castToString(
            c.column,
          )})`,
      )
      .join(",\n        ");
    const aggQuery = `
      SELECT
        __col.value:column_name::VARCHAR AS column_name,
        __col.value:value::VARCHAR AS value,
        COUNT(*) AS count
      FROM __factTable,
      LATERAL FLATTEN(input => ARRAY_CONSTRUCT(
        ${objects}
      )) __col
      WHERE timestamp >= ${this.toTimestamp(start)}
        AND __col.value:value::VARCHAR IS NOT NULL
      GROUP BY column_name, value`;
    return this.wrapWithTopNPerColumn(aggQuery, limit);
  }
  ensureFloat(col: string): string {
    return `CAST(${col} AS DOUBLE)`;
  }
  hasCountDistinctHLL(): boolean {
    return true;
  }
  supportsLimitZeroColumnValidation(): boolean {
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
  evalBoolean(col: string, value: boolean): string {
    // Snowflake does not support `IS TRUE` / `IS FALSE`
    return `${col} = ${value ? "true" : "false"}`;
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
      case "kll":
        return "BINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  }
}
