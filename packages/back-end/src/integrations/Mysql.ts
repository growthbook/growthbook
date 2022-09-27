import { MysqlConnectionParams } from "../../types/integrations/mysql";
import { decryptDataSourceParams } from "../services/datasource";
import SqlIntegration from "./SqlIntegration";
import mysql, { RowDataPacket } from "mysql2/promise";

export default class Mysql extends SqlIntegration {
  params: MysqlConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<MysqlConnectionParams>(
      encryptedParams
    );
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sql: string) {
    const conn = await mysql.createConnection({
      host: this.params.host,
      port: this.params.port,
      user: this.params.user,
      password: this.params.password,
      database: this.params.database,
    });

    const [rows] = await conn.query(sql);
    return rows as RowDataPacket[];
  }
  dateDiff(startCol: string, endCol: string) {
    return `DATEDIFF(${endCol}, ${startCol})`;
  }
  covariance(y: string, x: string): string {
    return `(SUM(${x}*${y})-SUM(${x})*SUM(${y})/COUNT(*))/(COUNT(*)-1)`;
  }
  stddev(col: string) {
    return `STDDEV_SAMP(${col})`;
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `DATE_${
      sign === "+" ? "ADD" : "SUB"
    }(${col}, INTERVAL ${amount} ${unit.toUpperCase()})`;
  }
  dateTrunc(col: string) {
    return `DATE(${col})`;
  }
  formatDate(col: string): string {
    return `DATE_FORMAT(${col}, "%Y-%m-%d")`;
  }
  castToString(col: string): string {
    return `cast(${col} as char)`;
  }
}
