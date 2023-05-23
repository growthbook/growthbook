/// <reference types="../../typings/presto-client" />
import { Client, IPrestoClientOptions } from "presto-client";
import { decryptDataSourceParams } from "../services/datasource";
import { PrestoConnectionParams } from "../../types/integrations/presto";
import { FormatDialect } from "../util/sql";
import { MissingDatasourceParamsError } from "../types/Integration";
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
  getInformationSchemaFromClause(): string {
    if (!this.params.catalog)
      throw new MissingDatasourceParamsError(
        "To view the information schema for a Presto data source, you must define a default catalog. Please add a default catalog by editing the datasource's connection settings."
      );
    return `${this.params.catalog}.information_schema.columns`;
  }
  getInformationSchemaTableFromClause(databaseName: string): string {
    return `${databaseName}.information_schema.columns`;
  }
}
