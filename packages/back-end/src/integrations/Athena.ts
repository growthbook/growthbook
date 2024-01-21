import { decryptDataSourceParams } from "../services/datasource";
import { cancelAthenaQuery, runAthenaQuery } from "../services/athena";
import { ExternalIdCallback, QueryResponse } from "../types/Integration";
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
  runQuery(
    sql: string,
    setExternalId: ExternalIdCallback
  ): Promise<QueryResponse> {
    return runAthenaQuery(this.params, sql, setExternalId);
  }
  async cancelQuery(externalId: string): Promise<void> {
    await cancelAthenaQuery(this.params, externalId);
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
  ensureFloat(col: string): string {
    return `CAST(${col} as double)`;
  }
  percentileCapSelectClause(
    values: {
      valueCol: string;
      outputCol: string;
      percentile: number;
    }[],
    metricTable: string,
    where: string = ""
  ): string {
    return `
    SELECT
      ${values
        .map(
          (v) =>
            `APPROX_PERCENTILE(${v.valueCol}, ${v.percentile}) AS ${v.outputCol}`
        )
        .join(",\n")}
      FROM ${metricTable}
      ${where}
    `;
  }
  getDefaultDatabase() {
    return this.params.catalog || "";
  }
}
