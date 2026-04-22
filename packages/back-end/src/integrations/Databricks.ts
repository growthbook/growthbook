import { databricksCreateTableOptions } from "shared/enterprise";
import { FormatDialect } from "shared/types/sql";
import { QueryResponse, DataType } from "shared/types/integrations";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { ColumnInterface } from "shared/types/fact-table";
import { runDatabricksQuery } from "back-end/src/services/databricks";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
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
    return "spark";
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
  public supportsEfficientTopValues(): boolean {
    return true;
  }
  protected getTopValuesCTEBody({
    columns,
    start,
    limit,
    maxValueLength,
  }: {
    columns: ColumnInterface[];
    start: Date;
    limit: number;
    maxValueLength?: number;
  }): string {
    // Unpivot via LATERAL VIEW STACK so the fact table is scanned once
    // regardless of how many columns we're sampling. STACK(N, ...) splits
    // N pairs of (name, value) into N rows.
    const pairs = columns
      .map((c) => `'${c.column}', ${this.castToString(c.column)}`)
      .join(",\n        ");
    const lengthFilter =
      maxValueLength !== undefined
        ? `AND ${this.stringLengthFn("value")} <= ${maxValueLength}`
        : "";
    const aggQuery = `
      SELECT column_name, value, COUNT(*) AS count
      FROM __factTable
      LATERAL VIEW STACK(${columns.length},
        ${pairs}
      ) __col AS column_name, value
      WHERE timestamp >= ${this.toTimestamp(start)}
        AND value IS NOT NULL
        ${lengthFilter}
      GROUP BY column_name, value`;
    return this.wrapWithTopNPerColumn(aggQuery, limit);
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
      case "kll":
        return "BINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  }
}
