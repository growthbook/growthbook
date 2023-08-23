import * as bq from "@google-cloud/bigquery";
import { getValidDate } from "shared/dates";
import { decryptDataSourceParams } from "../services/datasource";
import { BigQueryConnectionParams } from "../../types/integrations/bigquery";
import { IS_CLOUD } from "../util/secrets";
import { FormatDialect } from "../util/sql";
import { QueryResponse } from "../types/Integration";
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

  async runQuery(sql: string): Promise<QueryResponse> {
    const client = this.getClient();

    const [job] = await client.createQueryJob({
      labels: { integration: "growthbook" },
      query: sql,
      useLegacySql: false,
    });
    const [rows] = await job.getQueryResults();
    const statistics = {
      executionDurationMs: job.metadata.statistics.finalExecutionDurationMs,
      totalSlotMs: job.metadata.statistics.totalSlotMs,
      bytesProcessed: job.metadata.statistics.totalBytesProcessed,
      bytesBilled: job.metadata.statistics.query.totalBytesBilled,
      warehouseCachedResult: job.metadata.statistics.query.cacheHit,
      partitionsUsed:
        job.metadata.statistics.query.totalPartitionsProcessed > 0 ?? undefined,
    };
    return { rows, statistics };
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
  getDefaultSchema() {
    return this.params.defaultDataset;
  }
  getInformationSchemaTable(schema?: string, database?: string): string {
    return this.generateTablePath(
      "INFORMATION_SCHEMA.COLUMNS",
      schema,
      database
    );
  }
}
