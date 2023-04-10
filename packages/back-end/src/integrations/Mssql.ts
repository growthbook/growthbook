import mssql from "mssql";
import { DataSourceProperties } from "../../types/datasource";
import { MssqlConnectionParams } from "../../types/integrations/mssql";
import { decryptDataSourceParams } from "../services/datasource";
import {
  InformationSchema,
  MissingDatasourceParamsError,
} from "../types/Integration";
import { formatInformationSchema } from "../util/informationSchemas";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Mssql extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  params: MssqlConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<MssqlConnectionParams>(
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
  castDateToStandardString(col: string): string {
    return `CONVERT(VARCHAR(25), ${col}, 121)`;
  }
  replaceDateDimensionString(minDateDimString: string): string {
    return `SUBSTRING(${minDateDimString}, 29, 99999)`;
  }
  async getInformationSchema(): Promise<InformationSchema[]> {
    const databaseName = this.params.database;

    if (!databaseName)
      throw new MissingDatasourceParamsError(
        "To view the information schema for a MS Sql dataset, you must define a default database. Please add a default database by editing the datasource's connection settings."
      );

    const queryString = `SELECT
    table_name,
    table_catalog,
    table_schema,
    COUNT(column_name) as column_count
  FROM
    ${databaseName}.INFORMATION_SCHEMA.COLUMNS
    GROUP BY table_name, table_schema, table_catalog`;

    const results = await this.runQuery(queryString);

    if (!results.length) {
      throw new Error(`No tables found for database "${databaseName}".`);
    }

    return formatInformationSchema(results, "mssql");
  }

  async getTableData(
    databaseName: string,
    tableSchema: string,
    tableName: string
  ): Promise<{ tableData: null | unknown[]; refreshMS: number }> {
    const sql = `SELECT
          data_type,
          column_name
        FROM
          ${databaseName}.INFORMATION_SCHEMA.COLUMNS
        WHERE
          table_name
        IN ('${tableName}')
        AND
          table_schema
        IN ('${tableSchema}')`;

    const queryStartTime = Date.now();
    const tableData = await this.runQuery(sql);
    const queryEndTime = Date.now();

    return { tableData, refreshMS: queryEndTime - queryStartTime };
  }
}
