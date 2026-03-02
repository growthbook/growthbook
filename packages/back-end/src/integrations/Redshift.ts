import { FormatDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import SqlIntegration from "./SqlIntegration";

export default class Redshift extends SqlIntegration {
  params!: PostgresConnectionParams;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<PostgresConnectionParams>(encryptedParams);
  }
  getFormatDialect(): FormatDialect {
    return "redshift";
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
  formatDate(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  }
  formatDateTimeString(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  }
  ensureFloat(col: string): string {
    return `${col}::float`;
  }
  hasCountDistinctHLL(): boolean {
    return true;
  }
  hllAggregate(col: string): string {
    return `HLL_CREATE_SKETCH(${col})`;
  }
  hllReaggregate(col: string): string {
    return `HLL_COMBINE(${col})`;
  }
  hllCardinality(col: string): string {
    return `HLL_CARDINALITY(${col})`;
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `JSON_EXTRACT_PATH_TEXT(${jsonCol}, ${path
      .split(".")
      .map((p) => `'${p}'`)
      .join(", ")}, TRUE)`;
    return isNumeric ? this.ensureFloat(raw) : raw;
  }
  approxQuantile(value: string, quantile: string | number): string {
    // approx behaves differently in redshift
    return `PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`;
  }
  percentileCapSelectClause(
    values: {
      valueCol: string;
      outputCol: string;
      percentile: number;
      ignoreZeros: boolean;
      sourceIndex: number;
    }[],
    metricTable: string,
    where: string = "",
  ): string {
    // Redshift doesn't support multiple PERCENTILE_CONT functions with different
    // ORDER BY clauses in the same SELECT statement. Use scalar subqueries instead.
    return `
      SELECT
        ${values
          .map(({ valueCol, outputCol, percentile, ignoreZeros }) => {
            const value = ignoreZeros
              ? this.ifElse(`${valueCol} = 0`, "NULL", valueCol)
              : valueCol;
            return `(SELECT ${this.approxQuantile(value, percentile)} FROM ${metricTable} ${where}) AS ${outputCol}`;
          })
          .join(",\n        ")}
      `;
  }
  getInformationSchemaTable(): string {
    return "SVV_COLUMNS";
  }
}
