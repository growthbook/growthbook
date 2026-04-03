import mysql, { RowDataPacket } from "mysql2/promise";
import { ConnectionOptions } from "mysql2";
import { DateTruncGranularity, FormatDialect } from "shared/types/sql";
import {
  FactMetricPercentileData,
  QueryResponse,
} from "shared/types/integrations";
import { MysqlConnectionParams } from "shared/types/integrations/mysql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import SqlIntegration from "./SqlIntegration";

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
  dateTrunc(col: string, granularity: DateTruncGranularity = "day") {
    const formatMap: Record<DateTruncGranularity, string> = {
      hour: `DATE_FORMAT(${col}, '%Y-%m-%d %H:00:00')`,
      day: `DATE(${col})`,
      // Hack required for MySQL to calculate the start of the week
      week: `DATE(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY))`,
      month: `DATE_FORMAT(${col}, '%Y-%m-01')`,
      year: `DATE_FORMAT(${col}, '%Y-01-01')`,
    };

    return formatMap[granularity];
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
    values: FactMetricPercentileData[],
    metricTable: string,
    where: string = "",
  ): string {
    if (values.length > 1) {
      throw new Error(
        "MySQL only supports one percentile capped metric at a time",
      );
    }

    const v = values[0];
    const whereFor = (ignoreZeros: boolean) => {
      let whereClause = where;
      if (ignoreZeros) {
        whereClause = whereClause
          ? `${whereClause} AND ${v.valueCol} != 0`
          : `WHERE ${v.valueCol} != 0`;
      }
      return whereClause;
    };

    const scalarCap = (percentile: number, outputCol: string, ign: boolean) => {
      const wc = whereFor(ign);
      return `(SELECT x.capped FROM (
    SELECT DISTINCT FIRST_VALUE(${v.valueCol}) OVER (
      ORDER BY CASE WHEN p <= ${percentile} THEN p END DESC
    ) AS capped
    FROM (
      SELECT
        ${v.valueCol},
        PERCENT_RANK() OVER (ORDER BY ${v.valueCol}) p
      FROM ${metricTable}
      ${wc}
    ) t
  ) x LIMIT 1) AS ${outputCol}`;
    };

    const cols: string[] = [];
    const upperP = v.upperPercentile;
    if (upperP != null && upperP > 0 && upperP < 1) {
      cols.push(scalarCap(upperP, v.outputCol, v.upperIgnoreZeros ?? false));
    }
    const lowerP = v.lowerPercentile;
    if (lowerP != null && lowerP > 0 && lowerP < 1) {
      cols.push(
        scalarCap(
          lowerP,
          `${v.outputCol}_lower`,
          v.lowerIgnoreZeros ?? v.upperIgnoreZeros ?? false,
        ),
      );
    }
    if (cols.length === 0) {
      throw new Error(
        "percentileCapSelectClause: expected at least one percentile bound",
      );
    }

    return `SELECT ${cols.join(",\n    ")}`;
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
  canGroupPercentileCappedMetrics(): boolean {
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
