import mysql, { RowDataPacket } from "mysql2/promise";
import { ConnectionOptions } from "mysql2";
import { MysqlConnectionParams } from "../../types/integrations/mysql";
import { decryptDataSourceParams } from "../services/datasource";
import { FormatDialect } from "../util/sql";
import { QueryResponse } from "../types/Integration";
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
  async runQuery(sql: string): Promise<QueryResponse> {
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
    return { rows: rows as RowDataPacket[] };
  }
  dateDiff(startCol: string, endCol: string) {
    return `DATEDIFF(${endCol}, ${startCol})`;
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
  percentileCapSelectClause(
    capPercentile: number,
    metricTable: string
  ): string {
    return `
    SELECT DISTINCT FIRST_VALUE(value) OVER (
      ORDER BY CASE WHEN p <= ${capPercentile} THEN p END DESC
    ) AS cap_value
    FROM (
      SELECT
        value,
        PERCENT_RANK() OVER (ORDER BY value) p
      FROM ${metricTable}
      WHERE value IS NOT NULL
    ) t`;
  }
  getInformationSchemaWhereClause(): string {
    if (!this.params.database)
      throw new Error(
        `No database name provided in MySql connection. Please add a database by editing the connection settings.`
      );
    return `table_schema IN ('${this.params.database}')`;
  }
}
