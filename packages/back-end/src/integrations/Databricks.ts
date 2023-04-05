import { DataSourceProperties } from "../../types/datasource";
import { DatabricksConnectionParams } from "../../types/integrations/databricks";
import { runDatabricksQuery } from "../services/databricks";
import { decryptDataSourceParams } from "../services/datasource";
import { InformationSchema, RawInformationSchema } from "../types/Integration";
import { formatInformationSchema } from "../util/informationSchemas";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Databricks extends SqlIntegration {
  params!: DatabricksConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<DatabricksConnectionParams>(
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
    // sql-formatter doesn't support databricks explicitly yet, so using their generic formatter instead
    return "sql";
  }
  getSensitiveParamKeys(): string[] {
    const sensitiveKeys: (keyof DatabricksConnectionParams)[] = ["token"];
    return sensitiveKeys;
  }
  runQuery(sql: string) {
    return runDatabricksQuery(this.params, sql);
  }
  toTimestamp(date: Date) {
    return `TIMESTAMP'${date.toISOString()}'`;
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `timestampadd(${unit},${sign === "-" ? "-" : ""}${amount},${col})`;
  }
  formatDate(col: string) {
    return `date_format(${col}, 'y-MM-dd')`;
  }
  castToString(col: string): string {
    return `cast(${col} as string)`;
  }
  ensureFloat(col: string): string {
    return `cast(${col} as double)`;
  }
  async getInformationSchema(): Promise<InformationSchema[]> {
    const sql = `SELECT
        table_name,
        table_catalog,
        table_schema,
        count(column_name) as column_count
      FROM
        information_schema.columns
      WHERE
        table_schema
      NOT IN ('information_schema')
      GROUP BY (table_name, table_schema, table_catalog)`;

    const results = await this.runQuery(sql);

    if (!results.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(
      results as RawInformationSchema[],
      "databricks"
    );
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
