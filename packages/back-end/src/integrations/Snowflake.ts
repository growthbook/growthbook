import { DataSourceProperties } from "../../types/datasource";
import { SnowflakeConnectionParams } from "../../types/integrations/snowflake";
import { decryptDataSourceParams } from "../services/datasource";
import { runSnowflakeQuery } from "../services/snowflake";
import { InformationSchema, RawInformationSchema } from "../types/Integration";
import { formatInformationSchema } from "../util/informationSchemas";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Snowflake extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  params: SnowflakeConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<SnowflakeConnectionParams>(
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
    return "snowflake";
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  runQuery(sql: string) {
    return runSnowflakeQuery(this.params, sql);
  }
  formatDate(col: string): string {
    return `TO_VARCHAR(${col}, 'YYYY-MM-DD')`;
  }
  formatDateTimeString(col: string): string {
    return `TO_VARCHAR(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  }
  castToString(col: string): string {
    return `TO_VARCHAR(${col})`;
  }
  ensureFloat(col: string): string {
    return `CAST(${col} AS DOUBLE)`;
  }
  async getInformationSchema(): Promise<InformationSchema[]> {
    const database = this.params.database;

    if (!database) {
      throw new Error(
        "No database provided. In order to get the information schema, you must provide a database."
      );
    }

    const queryString = `SELECT
        table_name,
        table_catalog,
        table_schema,
        count(column_name) as column_count
    FROM
        ${database}.INFORMATION_SCHEMA.COLUMNS
    WHERE
        table_schema
      NOT IN ('INFORMATION_SCHEMA')
    GROUP BY (table_name, table_schema, table_catalog)`;

    const results = await this.runQuery(queryString);

    if (!results.length) {
      throw new Error(`No tables found for database "${database}".`);
    }

    return formatInformationSchema(
      results as RawInformationSchema[],
      "snowflake"
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
