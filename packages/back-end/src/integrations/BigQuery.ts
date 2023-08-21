import * as bq from "@google-cloud/bigquery";
import { getValidDate } from "shared/dates";
import { format, FormatDialect } from "../util/sql";
import { decryptDataSourceParams } from "../services/datasource";
import { BigQueryConnectionParams } from "../../types/integrations/bigquery";
import { IS_CLOUD } from "../util/secrets";
import { InformationSchema, RawInformationSchema } from "../types/Integration";
import { formatInformationSchema } from "../util/informationSchemas";
import SqlIntegration from "./SqlIntegration";

export default class BigQuery extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: BigQueryConnectionParams;
  requiresEscapingPath = true;
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
      labels: { integration: "growthbook" },
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
  percentileCapSelectClause(
    capPercentile: number,
    metricTable: string
  ): string {
    return `
    SELECT 
      APPROX_QUANTILES(value, 100000)[OFFSET(${Math.trunc(
        100000 * capPercentile
      )})] AS cap_value
    FROM ${metricTable}
    WHERE value IS NOT NULL
  `;
  }
  getDefaultDatabase() {
    return this.params.projectId || "";
  }
  getInformationSchemaTable(schema?: string, database?: string): string {
    return this.generateTablePath(
      "INFORMATION_SCHEMA.COLUMNS",
      schema,
      database
    );
  }
  async getInformationSchema(): Promise<InformationSchema[]> {
    const datasets = await this.runQuery(
      `SELECT * FROM ${`\`${this.params.projectId}.INFORMATION_SCHEMA.SCHEMATA\``}`
    );

    const query: string[] = [];

    for (const dataset of datasets) {
      query.push(`
      SELECT
        table_name as table_name,
        table_catalog as table_catalog,
        table_schema as table_schema,
        count(column_name) as column_count
      FROM
        ${this.getInformationSchemaTable(dataset.schema_name)}
        WHERE ${this.getInformationSchemaWhereClause()}
      GROUP BY table_name, table_schema, table_catalog`);
    }

    let queryString = query.join("\nUNION ALL\n");

    queryString = queryString + " ORDER BY table_name;";

    const results = await this.runQuery(
      format(queryString, this.getFormatDialect())
    );

    if (!results.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(
      results as RawInformationSchema[],
      this.type
    );
  }
}
