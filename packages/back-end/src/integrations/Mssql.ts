import { MssqlConnectionParams } from "../../types/integrations/mssql";
import { decryptDataSourceParams } from "../services/datasource";
import SqlIntegration from "./SqlIntegration";
import mssql from "mssql";

export default class Mssql extends SqlIntegration {
  params: MssqlConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<MssqlConnectionParams>(
      encryptedParams
    );
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sqlStr: string) {
    const conn = await mssql.connect({
      server: this.params.server,
      port: this.params.port,
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
    return `DATETRUNC(day, ${col})`;
  }
  stddev(col: string) {
    return `STDEV(${col})`;
  }
  avg(col: string) {
    return `AVG(CAST(${col} as FLOAT))`;
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
    return `FORMAT(${col}, "yyyy-mm-dd")`;
  }
  castToString(col: string): string {
    return `cast(${col} as varchar(256))`;
  }
}
