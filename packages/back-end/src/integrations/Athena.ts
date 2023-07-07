import { decryptDataSourceParams } from "../services/datasource";
import { runAthenaQuery } from "../services/athena";
import { AthenaConnectionParams } from "../../types/integrations/athena";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Athena extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: AthenaConnectionParams;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<AthenaConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    return "trino";
  }
  getSensitiveParamKeys(): string[] {
    return ["accessKeyId", "secretAccessKey"];
  }
  toTimestamp(date: Date) {
    return `from_iso8601_timestamp('${date.toISOString()}')`;
  }
  runQuery(sql: string) {
    return runAthenaQuery(this.params, sql);
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `${col} ${sign} INTERVAL '${amount}' ${unit}`;
  }
  formatDate(col: string): string {
    return `substr(to_iso8601(${col}),1,10)`;
  }
  formatDateTimeString(col: string): string {
    return `to_iso8601(${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `date_diff('day', ${startCol}, ${endCol})`;
  }
  useAliasInGroupBy(): boolean {
    return false;
  }
  ensureFloat(col: string): string {
    return `1.0*${col}`;
  }
  percentileCapSelectClause(
    capPercentile: number,
    metricTable: string
  ): string {
    return `
      SELECT APPROX_PERCENTILE(value, ${capPercentile}) AS cap_value
      FROM ${metricTable}
      WHERE value IS NOT NULL
    `;
  }
  getDefaultDatabase() {
    return this.params.catalog || "";
  }
}
