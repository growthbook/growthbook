import { databricksCreateTableOptions } from "shared/enterprise";
import { FormatDialect } from "shared/src/types";
import { DatabricksConnectionParams } from "back-end/types/integrations/databricks";
import { runDatabricksQuery } from "back-end/src/services/databricks";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { QueryResponse, DataType } from "back-end/src/types/Integration";
import SqlIntegration from "./SqlIntegration";

export default class Databricks extends SqlIntegration {
  params!: DatabricksConnectionParams;
  requiresDatabase = true;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<DatabricksConnectionParams>(encryptedParams);
  }
  isWritingTablesSupported(): boolean {
    return true;
  }
  dropUnitsTable(): boolean {
    return true;
  }
  createUnitsTableOptions() {
    if (!this.datasource.settings.pipelineSettings) {
      throw new Error("Pipeline settings are required to create a units table");
    }
    return databricksCreateTableOptions(
      this.datasource.settings.pipelineSettings,
    );
  }
  getFormatDialect(): FormatDialect {
    // sql-formatter doesn't support databricks explicitly yet, so using their generic formatter instead
    return "sql";
  }
  getSensitiveParamKeys(): string[] {
    const sensitiveKeys: (keyof DatabricksConnectionParams)[] = ["token"];
    return sensitiveKeys;
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runDatabricksQuery(this.params, sql);
  }
  toTimestamp(date: Date) {
    return `TIMESTAMP'${date.toISOString()}'`;
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ): string {
    return `timestampadd(${unit},${sign === "-" ? "-" : ""}${amount},${col})`;
  }
  formatDate(col: string) {
    return `date_format(${col}, 'y-MM-dd')`;
  }
  formatDateTimeString(col: string) {
    return `date_format(${col}, 'y-MM-dd HH:mm:ss.SSS')`;
  }
  castToString(col: string): string {
    return `cast(${col} as string)`;
  }
  ensureFloat(col: string): string {
    return `cast(${col} as double)`;
  }
  escapeStringLiteral(value: string): string {
    return value.replace(/(['\\])/g, "\\$1");
  }
  hasCountDistinctHLL(): boolean {
    return true;
  }
  hllAggregate(col: string): string {
    return `HLL_SKETCH_AGG(${this.castToString(col)})`;
  }
  hllReaggregate(col: string): string {
    return `HLL_UNION_AGG(${col})`;
  }
  hllCardinality(col: string): string {
    return `HLL_SKETCH_ESTIMATE(${col})`;
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `${jsonCol}:${path}`;
    return isNumeric ? this.ensureFloat(raw) : raw;
  }
  getDefaultDatabase(): string {
    return this.params.catalog;
  }
  getDataType(dataType: DataType): string {
    switch (dataType) {
      case "string":
        return "STRING";
      case "integer":
        return "INT";
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
