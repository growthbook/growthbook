import { DateTruncGranularity, FormatDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { MssqlConnectionParams } from "shared/types/integrations/mssql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { findOrCreateConnection } from "back-end/src/util/mssqlPoolManager";
import SqlIntegration from "./SqlIntegration";

export default class Mssql extends SqlIntegration {
  params!: MssqlConnectionParams;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<MssqlConnectionParams>(encryptedParams);
  }
  getFormatDialect(): FormatDialect {
    return "tsql";
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sqlStr: string): Promise<QueryResponse> {
    const conn = await findOrCreateConnection(this.datasource.id, {
      server: this.params.server,
      port: parseInt(this.params.port + "", 10),
      user: this.params.user,
      password: this.params.password,
      database: this.params.database,
      requestTimeout: (this.params.requestTimeout ?? 0) * 1000,
      options: this.params.options,
    });

    const results = await conn.request().query(sqlStr);
    return { rows: results.recordset };
  }

  // MS SQL Server doesn't support the LIMIT keyword, so we have to use the TOP or OFFSET and FETCH keywords instead.
  // (and OFFSET/FETCH only work when there is an ORDER BY clause)
  selectStarLimit(table: string, limit: number): string {
    return `SELECT TOP ${limit} * FROM ${table}`;
  }

  ensureMaxLimit(sql: string, limit: number): string {
    return `WITH __table AS (\n${sql}\n) SELECT TOP ${limit} * FROM __table`;
  }

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ): string {
    return `DATEADD(${unit}, ${sign === "-" ? "-" : ""}${amount}, ${col})`;
  }
  dateTrunc(col: string, granularity: DateTruncGranularity = "day") {
    // Widely supported shortcut for day granularity (most commonly used)
    if (granularity === "day") {
      return `cast(${col} as DATE)`;
    }

    // DATETRUNC is only supported in SQL Server 2022 preview.
    return `DATETRUNC(${granularity}, ${col})`;
  }
  ensureFloat(col: string): string {
    return `CAST(${col} as FLOAT)`;
  }
  formatDate(col: string): string {
    return `FORMAT(${col}, 'yyyy-MM-dd')`;
  }
  castToString(col: string): string {
    return `cast(${col} as varchar(256))`;
  }
  formatDateTimeString(col: string): string {
    return `CONVERT(VARCHAR(25), ${col}, 121)`;
  }
  approxQuantile(value: string, quantile: string | number): string {
    return `APPROX_PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`;
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `JSON_VALUE(${jsonCol}, '$.${path}')`;
    return isNumeric ? this.ensureFloat(raw) : raw;
  }
  evalBoolean(col: string, value: boolean): string {
    // MS SQL does not support `IS TRUE` / `IS FALSE`
    return `${col} = ${value ? "1" : "0"}`;
  }
  getDefaultDatabase() {
    return this.params.database;
  }
}
