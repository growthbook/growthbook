import { decryptDataSourceParams } from "back-end/src/services/datasource";
import {
  cancelAthenaQuery,
  runAthenaQuery,
} from "back-end/src/services/athena";
import {
  ExternalIdCallback,
  QueryResponse,
} from "back-end/src/types/Integration";
import { AthenaConnectionParams } from "back-end/types/integrations/athena";
import { FormatDialect } from "back-end/src/util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Athena extends SqlIntegration {
  params!: AthenaConnectionParams;
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
  getDefaultDatabase() {
    return this.params.catalog || "";
  }
}
