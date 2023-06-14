import mysql, { RowDataPacket } from "mysql2/promise";
import { ConnectionOptions } from "mysql2";
import { MysqlConnectionParams } from "../../types/integrations/mysql";
import { decryptDataSourceParams } from "../services/datasource";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Mysql extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: MysqlConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<MysqlConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    return "mysql";
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sql: string) {
    const config: ConnectionOptions = {
      host: this.params.host,
      port: this.params.port,
      user: this.params.user,
      password: this.params.password,
      database: this.params.database,
    };
    if (this.params.ssl) {
      config["ssl"] = {
        ca: this.params.caCert,
        cert: this.params.clientCert,
        key: this.params.clientKey,
      };
    }
    const conn = await mysql.createConnection(config);

    const [rows] = await conn.query(sql);
    return rows as RowDataPacket[];
  }
  dateDiff(startCol: string, endCol: string) {
    return `DATEDIFF(${endCol}, ${startCol})`;
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
  formatDateTimeString(col: string): string {
    return `DATE_FORMAT(${col}, "%Y-%m-%d %H:%i:%S")`;
  }
  castToString(col: string): string {
    return `cast(${col} as char)`;
  }
  ensureFloat(col: string): string {
    return `CAST(${col} AS DOUBLE)`;
  }
  // From https://rpbouman.blogspot.com/2008/07/calculating-nth-percentile-in-mysql.html
  // One pass, but builds a long string of all values and then cuts it at the right
  // percentile
  percentileCapSelectClause(capPercentile: number) {
    return `
      SUBSTRING_INDEX(
        SUBSTRING_INDEX(
          GROUP_CONCAT(
              value
              ORDER BY value
          ), ',', ${capPercentile} * COUNT(*) + 1
        ), ',', -1
      ) AS cap_value
    `;
  }
  getInformationSchemaWhereClause(): string {
    if (!this.params.database)
      throw new Error(
        `No database name provided in MySql connection. Please add a database by editing the connection settings.`
      );
    return `table_schema IN ('${this.params.database}')`;
  }
}
