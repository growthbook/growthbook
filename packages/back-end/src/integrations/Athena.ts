import { decryptDataSourceParams } from "../services/datasource";
import { runAthenaQuery } from "../services/athena";
import { AthenaConnectionParams } from "../../types/integrations/athena";
import { FormatDialect } from "../util/sql";
import { MissingDatasourceParamsError } from "../types/Integration";
import SqlIntegration from "./SqlIntegration";

export default class Athena extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  params: AthenaConnectionParams;
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
  getInformationSchemaFromClause(): string {
    if (!this.params.catalog)
      throw new MissingDatasourceParamsError(
        "To view the information schema for an Athena data source, you must define a default catalog. Please add a default catalog by editing the datasource's connection settings."
      );
    return `${this.params.catalog}.information_schema.columns`;
  }
  getInformationSchemaTableFromClause(databaseName: string): string {
    return `${databaseName}.information_schema.columns`;
  }
}
