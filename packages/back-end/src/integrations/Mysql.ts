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
  percentile() {
    // TODO: find workaround since mysql doesn't natively support percentiles
    return `0`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `DATEDIFF(${endCol}, ${startCol})`;
  }
  addHours(col: string, hours: number) {
    return `DATE_ADD(${col}, INTERVAL ${hours} HOUR)`;
  }
  subtractHalfHour(col: string) {
    return `SUBTIME(${col}, "0:30")`;
  }
  regexMatch(col: string, regex: string) {
    return `${col} REGEXP '${regex}'`;
  }
  dateTrunc(col: string) {
    return `DATE(${col})`;
  }
  formatDate(col: string): string {
    return `DATE_FORMAT(${col}, "%Y-%m-%d")`;
  }
}
