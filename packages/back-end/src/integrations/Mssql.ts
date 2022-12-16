import mssql from "mssql";
import { MssqlConnectionParams } from "../../types/integrations/mssql";
import { decryptDataSourceParams } from "../services/datasource";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Mssql extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  params: MssqlConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<MssqlConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    return "tsql";
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sqlStr: string) {
    const conn = await mssql.connect({
      server: this.params.server,
      port: parseInt(this.params.port + "", 10),
      user: this.params.user,
      password: this.params.password,
      database: this.params.database,
      options: this.params.options,
    });

    const results = await conn.request().query(sqlStr);
    return results.recordset;
  }

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `DATEADD(${unit}, ${sign === "-" ? "-" : ""}${amount}, ${col})`;
  }
  dateTrunc(col: string) {
    //return `DATETRUNC(day, ${col})`; <- this is only supported in SQL Server 2022 preview.
    return `cast(${col} as DATE)`;
  }
  stddev(col: string) {
    return `STDEV(${col})`;
  }
  variance(col: string) {
    return `VAR(${col})`;
  }
  covariance(y: string, x: string): string {
    return `(SUM(${x}*${y})-SUM(${x})*SUM(${y})/COUNT(*))/(COUNT(*)-1)`;
  }
  ensureFloat(col: string): string {
    return `CAST(${col} as FLOAT)`;
  }
  formatDate(col: string): string {
    return `FORMAT(${col}, "yyyy-MM-dd")`;
  }
  castToString(col: string): string {
    return `cast(${col} as varchar(256))`;
  }
}
