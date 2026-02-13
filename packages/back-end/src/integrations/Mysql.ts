import mysql, { RowDataPacket } from "mysql2/promise";
import { ConnectionOptions } from "mysql2";
import { FormatDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { MysqlConnectionParams } from "shared/types/integrations/mysql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import SqlIntegration from "./SqlIntegration.js";

export default class Mysql extends SqlIntegration {
  params!: MysqlConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<MysqlConnectionParams>(encryptedParams);
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
    conn.end();
    return { rows: rows as RowDataPacket[] };
  }
  dateDiff(startCol: string, endCol: string) {
    return `DATEDIFF(${endCol}, ${startCol})`;
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
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
    values: {
      valueCol: string;
      outputCol: string;
      percentile: number;
      ignoreZeros: boolean;
    }[],
    metricTable: string,
    where: string = "",
  ): string {
    if (values.length > 1) {
      throw new Error(
        "MySQL only supports one percentile capped metric at a time",
      );
    }

    let whereClause = where;
    if (values[0].ignoreZeros) {
      whereClause = whereClause
        ? `${whereClause} AND ${values[0].valueCol} != 0`
        : `WHERE ${values[0].valueCol} != 0`;
    }

    return `
    SELECT DISTINCT FIRST_VALUE(${values[0].valueCol}) OVER (
      ORDER BY CASE WHEN p <= ${values[0].percentile} THEN p END DESC
    ) AS ${values[0].outputCol}
    FROM (
      SELECT
        ${values[0].valueCol},
        PERCENT_RANK() OVER (ORDER BY ${values[0].valueCol}) p
      FROM ${metricTable}
      ${whereClause}
    ) t`;
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `JSON_EXTRACT(${jsonCol}, '$.${path}')`;
    return isNumeric ? this.ensureFloat(raw) : raw;
  }
  hasQuantileTesting(): boolean {
    return false;
  }
  hasEfficientPercentile(): boolean {
    return false;
  }
  getInformationSchemaWhereClause(): string {
    if (!this.params.database)
      throw new Error(
        `No database name provided in MySql connection. Please add a database by editing the connection settings.`,
      );
    return `table_schema IN ('${this.params.database}')`;
  }
}
