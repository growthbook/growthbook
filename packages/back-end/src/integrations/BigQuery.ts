import * as bq from "@google-cloud/bigquery";
import { decryptDataSourceParams } from "../services/datasource";
import { BigQueryConnectionParams } from "../../types/integrations/bigquery";
import { getValidDate } from "../util/dates";
import { IS_CLOUD } from "../util/secrets";
import { FormatDialect } from "../util/sql";
import { InformationSchema, RawInformationSchema } from "../types/Integration";
import { formatInformationSchema } from "../util/integrations";
import SqlIntegration from "./SqlIntegration";

export default class BigQuery extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
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
  castToString(col: string): string {
    return `cast(${col} as string)`;
  }
  castUserDateCol(column: string): string {
    return `CAST(${column} as DATETIME)`;
  }

  async getInformationSchema(): Promise<InformationSchema[] | null> {
    const projectId = this.params.projectId;

    if (!projectId) {
      return null;
    }

    const datasets = await this.runQuery(
      `SELECT * FROM ${projectId}.INFORMATION_SCHEMA.SCHEMATA;`
    );

    const combinedResults: RawInformationSchema[] = [];

    const query: string[] = [];

    for (const dataset of datasets) {
      query.push(`SELECT
        table_name,
        '${projectId}' as table_catalog,
        table_schema,
        COUNT(column_name) as column_count
      FROM
        \`${projectId}.${dataset.schema_name}.INFORMATION_SCHEMA.COLUMNS\`
        GROUP BY table_name, table_schema`);
    }

    // Limit to 10 datasets for now.
    if (query.length > 10) return null;

    const queryString = query.join(" UNION ALL ");

    const results = await this.runQuery(queryString);

    for (const result of results) {
      combinedResults.push(result);
    }

    return combinedResults.length
      ? formatInformationSchema(combinedResults, "bigquery")
      : null;
  }
}
