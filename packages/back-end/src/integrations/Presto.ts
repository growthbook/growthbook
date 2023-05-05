/// <reference types="../../typings/presto-client" />
import { Client, IPrestoClientOptions } from "presto-client";
import { decryptDataSourceParams } from "../services/datasource";
import { PrestoConnectionParams } from "../../types/integrations/presto";
import { FormatDialect } from "../util/sql";
import {
  InformationSchema,
  MissingDatasourceParamsError,
  RawInformationSchema,
} from "../types/Integration";
import { formatInformationSchema } from "../util/informationSchemas";
import { DataSourceProperties } from "../../types/datasource";
import SqlIntegration from "./SqlIntegration";

// eslint-disable-next-line
type Row = any;

export default class Presto extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: PrestoConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PrestoConnectionParams>(
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
    return "trino";
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  toTimestamp(date: Date) {
    return `from_iso8601_timestamp('${date.toISOString()}')`;
  }
  runQuery(sql: string) {
    const configOptions: IPrestoClientOptions = {
      host: this.params.host,
      port: this.params.port,
      user: "growthbook",
      source: "nodejs-client",
      basic_auth: {
        user: this.params.username,
        password: this.params.password,
      },
      schema: this.params.schema,
      catalog: this.params.catalog,
      checkInterval: 500,
    };
    if (this.params?.ssl) {
      configOptions.ssl = {
        ca: this.params?.caCert,
        cert: this.params?.clientCert || "",
        key: this.params?.clientKey,
        secureProtocol: "SSLv23_method",
      };
    }
    const client = new Client(configOptions);

    return new Promise<Row[]>((resolve, reject) => {
      let cols: string[];
      const rows: Row[] = [];

      client.execute({
        query: sql,
        catalog: this.params.catalog,
        schema: this.params.schema,
        columns: (error, data) => {
          if (error) return;
          cols = data.map((d) => d.name);
        },
        error: (error) => {
          reject(error);
        },
        data: (error, data) => {
          if (error) return;

          data.forEach((d) => {
            const row: Row = {};
            d.forEach((v, i) => {
              row[cols[i]] = v;
            });
            rows.push(row);
          });
        },
        success: () => {
          resolve(rows);
        },
      });
    });
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `${col} ${sign} INTERVAL '${amount}' ${unit}`;
  }
  formatDate(col: string): string {
    return `substr(to_iso8601(${col}),1,10)`;
  }
  formatDateTimeString(col: string): string {
    return `to_iso8601(${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `date_diff('day', ${startCol}, ${endCol})`;
  }
  useAliasInGroupBy(): boolean {
    return false;
  }
  ensureFloat(col: string): string {
    return `CAST(${col} AS DOUBLE)`;
  }
  async getInformationSchema(): Promise<InformationSchema[]> {
    const defaultCatalog = this.params.catalog;

    if (!defaultCatalog)
      throw new MissingDatasourceParamsError(
        "To view the information schema for a Presto dataset, you must define a default catalog. Please add a default catalog by editing the datasource's connection settings."
      );

    const sql = `SELECT
        table_name,
        table_catalog,
        table_schema,
        count(column_name) as column_count
      FROM
        ${defaultCatalog}.information_schema.columns
      GROUP BY (table_name, table_schema, table_catalog)`;

    const results = await this.runQuery(sql);

    if (!results.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(results as RawInformationSchema[], "presto");
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
        ${databaseName}.information_schema.columns
      WHERE
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
