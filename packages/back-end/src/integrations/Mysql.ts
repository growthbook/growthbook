import mysql, { RowDataPacket } from "mysql2/promise";
import { ConnectionOptions } from "mysql2";
import { MysqlConnectionParams } from "../../types/integrations/mysql";
import { decryptDataSourceParams } from "../services/datasource";
import { FormatDialect } from "../util/sql";
import { DataSourceProperties } from "../../types/datasource";
import { formatInformationSchema } from "../util/informationSchemas";
import { InformationSchema, RawInformationSchema } from "../types/Integration";
import SqlIntegration from "./SqlIntegration";

export default class Mysql extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  params: MysqlConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<MysqlConnectionParams>(
      encryptedParams
    );
  }
  getSourceProperties(): DataSourceProperties {
    return {
      ...super.getSourceProperties(),
      supportsInformationSchema: true,
    };
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
  async getInformationSchema(): Promise<InformationSchema[]> {
    const databaseName = this.params.database;
    const sql = `SELECT
        table_name as table_name,
        table_catalog as table_catalog,
        table_schema as table_schema,
        count(column_name) as column_count
      FROM
        information_schema.columns
      WHERE table_schema in ('${databaseName}')
      GROUP BY table_name, table_schema, table_catalog`;

    const results = await this.runQuery(sql);

    if (!results.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(results as RawInformationSchema[], "mysql");
  }

  async getTableData(
    databaseName: string,
    tableSchema: string,
    tableName: string
  ): Promise<{ tableData: null | unknown[]; refreshMS: number }> {
    const sql = `SELECT
        data_type as data_type,
        column_name as column_name
      FROM
        information_schema.columns
      WHERE
        table_catalog
      IN ('${databaseName}')
      AND
        table_schema
      IN ('${tableSchema}')
      AND
        table_name
      IN ('${tableName}')`;

    const queryStartTime = Date.now();
    const tableData = await this.runQuery(sql);
    const queryEndTime = Date.now();

    return { tableData, refreshMS: queryEndTime - queryStartTime };
  }
}
