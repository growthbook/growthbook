import * as bq from "@google-cloud/bigquery";
import { getValidDate } from "shared/dates";
import { decryptDataSourceParams } from "../services/datasource";
import { BigQueryConnectionParams } from "../../types/integrations/bigquery";
import { IS_CLOUD } from "../util/secrets";
import { FormatDialect } from "../util/sql";
import { MissingDatasourceParamsError } from "../types/Integration";
import SqlIntegration from "./SqlIntegration";

export default class BigQuery extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: BigQueryConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<BigQueryConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    return "bigquery";
  }
  getSensitiveParamKeys(): string[] {
    return ["privateKey"];
  }

  private getClient() {
    // If pull credentials from env or the metadata server
    if (!IS_CLOUD && this.params.authType === "auto") {
      return new bq.BigQuery();
    }

    return new bq.BigQuery({
      projectId: this.params.projectId,
      credentials: {
        client_email: this.params.clientEmail,
        private_key: this.params.privateKey,
      },
    });
  }

  async runQuery(sql: string) {
    const client = this.getClient();

    const [job] = await client.createQueryJob({
      query: sql,
      useLegacySql: false,
    });
    const [rows] = await job.getQueryResults();
    return rows;
  }
  toTimestamp(date: Date) {
    return `DATETIME("${date.toISOString().substr(0, 19).replace("T", " ")}")`;
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `DATETIME_${
      sign === "+" ? "ADD" : "SUB"
    }(${col}, INTERVAL ${amount} ${unit.toUpperCase()})`;
  }
  convertDate(fromDB: bq.BigQueryDatetime) {
    return getValidDate(fromDB.value + "Z");
  }
  dateTrunc(col: string) {
    return `date_trunc(${col}, DAY)`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `date_diff(${endCol}, ${startCol}, DAY)`;
  }
  formatDate(col: string): string {
    return `format_date("%F", ${col})`;
  }
  formatDateTimeString(col: string): string {
    return `format_datetime("%F %T", ${col})`;
  }
  castToString(col: string): string {
    return `cast(${col} as string)`;
  }
  castUserDateCol(column: string): string {
    return `CAST(${column} as DATETIME)`;
  }
  generateTableName(
    tableName: string,
    schemaName?: string,
    databaseName?: string
  ): string {
    const database = databaseName || this.params.projectId;
    const schema = schemaName || this.params.defaultDataset;

    if (!database) {
      throw new MissingDatasourceParamsError("No project ID provided.");
    }

    if (!schema)
      throw new MissingDatasourceParamsError(
        "No default dataset provided. Please edit the connection settings and try again."
      );

    if (schemaName === "information_schema" && tableName === "columns") {
      return `\`${database}.${this.params.defaultDataset}.INFORMATION_SCHEMA.COLUMNS\``;
    }
    return `\`${database}.${schema}.${tableName}\``;
  }
}
