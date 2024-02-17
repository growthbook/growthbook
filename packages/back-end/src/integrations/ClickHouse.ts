import { ClickHouse as ClickHouseClient } from "clickhouse";
import { decryptDataSourceParams } from "../services/datasource";
import { ClickHouseConnectionParams } from "../../types/integrations/clickhouse";
import { QueryResponse } from "../types/Integration";
import SqlIntegration from "./SqlIntegration";

export default class ClickHouse extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: ClickHouseConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<ClickHouseConnectionParams>(
      encryptedParams
    );

    if (this.params.user) {
      this.params.username = this.params.user;
      delete this.params.user;
    }
    if (this.params.host) {
      this.params.url = this.params.host;
      delete this.params.host;
    }
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sql: string): Promise<QueryResponse> {
    const client = new ClickHouseClient({
      url: this.params.url,
      port: this.params.port,
      basicAuth: this.params.username
        ? {
            username: this.params.username,
            password: this.params.password,
          }
        : null,
      format: "json",
      debug: false,
      raw: false,
      config: {
        database: this.params.database,
      },
      reqParams: {
        headers: {
          "x-clickhouse-format": "JSON",
        },
      },
    });
    return { rows: Array.from(await client.query(sql).toPromise()) };
  }
  toTimestamp(date: Date) {
    return `toDateTime('${date
      .toISOString()
      .substr(0, 19)
      .replace("T", " ")}', 'UTC')`;
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `date${sign === "+" ? "Add" : "Sub"}(${unit}, ${amount}, ${col})`;
  }
  dateTrunc(col: string) {
    return `dateTrunc('day', ${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `dateDiff('day', ${startCol}, ${endCol})`;
  }
  formatDate(col: string): string {
    return `formatDateTime(${col}, '%F')`;
  }
  formatDateTimeString(col: string): string {
    return `formatDateTime(${col}, '%Y-%m-%d %H:%i:%S.%f')`;
  }
  ifElse(condition: string, ifTrue: string, ifFalse: string) {
    return `if(${condition}, ${ifTrue}, ${ifFalse})`;
  }
  castToString(col: string): string {
    return `toString(${col})`;
  }
  ensureFloat(col: string): string {
    return `toFloat64(${col})`;
  }
  percentileCapSelectClause(
    values: {
      valueCol: string;
      outputCol: string;
      percentile: number;
      ignoreZeros: boolean;
    }[],
    metricTable: string,
    where: string = ""
  ): string {
    return `
    SELECT
      ${values
        .map((v) => {
          const value = v.ignoreZeros
            ? this.ifElse(`${v.valueCol} = 0`, "NULL", v.valueCol)
            : v.valueCol;
          return `quantile(${v.percentile})(${value}) AS ${v.outputCol}`;
        })
        .join(",\n")}
      FROM ${metricTable}
      ${where}
    `;
  }
  getInformationSchemaWhereClause(): string {
    if (!this.params.database)
      throw new Error(
        "No database name provided in ClickHouse connection. Please add a database by editing the connection settings."
      );
    return `table_schema IN ('${this.params.database}')`;
  }
}
