import mssql from "mssql";
import { MssqlConnectionParams } from "../../types/integrations/mssql";
import { decryptDataSourceParams } from "../services/datasource";
import { FormatDialect } from "../util/sql";
import { MissingDatasourceParamsError } from "../types/Integration";
import SqlIntegration from "./SqlIntegration";

export default class Mssql extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
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

  // MS SQL Server doesn't support the LIMIT keyword, so we have to use the TOP or OFFSET and FETCH keywords instead.
  // (and OFFSET/FETCH only work when there is an ORDER BY clause)
  selectSampleRows(table: string, limit: number): string {
    return `SELECT TOP ${limit} * FROM ${table}`;
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
  ensureFloat(col: string): string {
    return `CAST(${col} as FLOAT)`;
  }
  formatDate(col: string): string {
    return `FORMAT(${col}, "yyyy-MM-dd")`;
  }
  castToString(col: string): string {
    return `cast(${col} as varchar(256))`;
  }
  formatDateTimeString(col: string): string {
    return `CONVERT(VARCHAR(25), ${col}, 121)`;
  }
  getInformationSchemaFromClause(): string {
    if (!this.params.database)
      throw new MissingDatasourceParamsError(
        "To view the information schema for a MS Sql dataset, you must define a default database. Please add a default database by editing the datasource's connection settings."
      );
    return `${this.params.database}.information_schema.columns`;
  }
  getInformationSchemaTableFromClause(databaseName: string): string {
    return `${databaseName}.information_schema.columns`;
  }
  getEventsTrackedByDatasourceFromClause(
    trackedEventTableName: string
  ): string {
    if (!this.params.defaultSchema)
      throw new Error(
        "No default schema provided. To automatically generate metrics, you must provide a default schema. This should be the schema where the Rudderstack tracked events are stored."
      );
    return `${this.params.defaultSchema}.${trackedEventTableName}`;
  }
}
