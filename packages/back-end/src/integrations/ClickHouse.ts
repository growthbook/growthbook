import { ClickHouse as ClickHouseClient } from "clickhouse";
import { decryptDataSourceParams } from "../services/datasource";
import { ClickHouseConnectionParams } from "../../types/integrations/clickhouse";
import { DataSourceProperties } from "../../types/datasource";
import { InformationSchema, RawInformationSchema } from "../types/Integration";
import { formatInformationSchema } from "../util/informationSchemas";
import SqlIntegration from "./SqlIntegration";

export default class ClickHouse extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  params: ClickHouseConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<ClickHouseConnectionParams>(
      encryptedParams
    );

    if (this.params.user) {
      this.params.username = this.params.user;
      delete this.params.user;
    }
    if (this.params.host) {
      this.params.url = this.params.host;
      delete this.params.host;
    }
  }
  getSourceProperties(): DataSourceProperties {
    return {
      ...super.getSourceProperties(),
      supportsInformationSchema: true,
    };
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sql: string) {
    const client = new ClickHouseClient({
      url: this.params.url,
      port: this.params.port,
      basicAuth: this.params.username
        ? {
            username: this.params.username,
            password: this.params.password,
          }
        : null,
      format: "json",
      debug: false,
      raw: false,
      config: {
        database: this.params.database,
      },
      reqParams: {
        headers: {
          "x-clickhouse-format": "JSON",
        },
      },
    });
    return Array.from(await client.query(sql).toPromise());
  }
  toTimestamp(date: Date) {
    return `toDateTime('${date
      .toISOString()
      .substr(0, 19)
      .replace("T", " ")}')`;
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `date${sign === "+" ? "Add" : "Sub"}(${unit}, ${amount}, ${col})`;
  }
  dateTrunc(col: string) {
    return `dateTrunc('day', ${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `dateDiff('day', ${startCol}, ${endCol})`;
  }
  stddev(col: string) {
    return `stddevSamp(${col})`;
  }
  formatDate(col: string): string {
    return `formatDateTime(${col}, '%F')`;
  }
  ifElse(condition: string, ifTrue: string, ifFalse: string) {
    return `if(${condition}, ${ifTrue}, ${ifFalse})`;
  }
  castToString(col: string): string {
    return `toString(${col})`;
  }
  async getInformationSchema(): Promise<InformationSchema[]> {
    const databaseName = this.params.database;
    if (!databaseName)
      throw new Error(
        "No database name provided in ClickHouse connection. Please add a database by editing the connection settings."
      );

    const sql = `SELECT
        table_name,
        table_catalog,
        table_schema,
        count(column_name) as column_count
      FROM
        information_schema.columns
      WHERE
        table_schema
      IN ('${databaseName}')
      GROUP BY (table_name, table_schema, table_catalog)`;

    const results = await this.runQuery(sql);

    if (!results.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(
      results as RawInformationSchema[],
      "clickhouse"
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
