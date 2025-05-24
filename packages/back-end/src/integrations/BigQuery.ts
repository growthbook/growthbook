import * as bq from "@google-cloud/bigquery";
import { bigQueryCreateTableOptions } from "shared/enterprise";
import { getValidDate } from "shared/dates";
import { format, FormatDialect } from "back-end/src/util/sql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { BigQueryConnectionParams } from "back-end/types/integrations/bigquery";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  ExternalIdCallback,
  InformationSchema,
  QueryResponse,
  RawInformationSchema,
} from "back-end/src/types/Integration";
import { formatInformationSchema } from "back-end/src/util/informationSchemas";
import { logger } from "back-end/src/util/logger";
import SqlIntegration from "./SqlIntegration";

export default class BigQuery extends SqlIntegration {
  requiresEscapingPath = true;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<BigQueryConnectionParams>(encryptedParams);
  }
  isWritingTablesSupported(): boolean {
    return true;
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
      projectId: this.params.projectId || this.params.project_id,
      credentials: {
        client_email: this.params.clientEmail || this.params.client_email,
        private_key: this.params.privateKey || this.params.private_key,
      },
    });
  }

  async cancelQuery(externalId: string): Promise<void> {
    const client = this.getClient();
    const job = client.job(externalId);

    // Attempt to cancel job
    const [apiResult] = await job.cancel();
    logger.debug(
      `Cancelled BigQuery job ${externalId} - ${JSON.stringify(
        apiResult.job?.status
      )}`
    );
  }

  async runQuery(
    sql: string,
    setExternalId?: ExternalIdCallback
  ): Promise<QueryResponse> {
    const client = this.getClient();

    const [job] = await client.createQueryJob({
      labels: { integration: "growthbook" },
      query: sql,
      useLegacySql: false,
    });

    if (setExternalId && job.id) {
      await setExternalId(job.id);
    }

    const [rows] = await job.getQueryResults();
    const [metadata] = await job.getMetadata();
    const statistics = {
      executionDurationMs: Number(
        metadata?.statistics?.finalExecutionDurationMs
      ),
      totalSlotMs: Number(metadata?.statistics?.totalSlotMs),
      bytesProcessed: Number(metadata?.statistics?.totalBytesProcessed),
      bytesBilled: Number(metadata?.statistics?.query?.totalBytesBilled),
      warehouseCachedResult: metadata?.statistics?.query?.cacheHit,
      partitionsUsed:
        metadata?.statistics?.query?.totalPartitionsProcessed !== undefined
          ? metadata.statistics.query.totalPartitionsProcessed > 0
          : undefined,
    };
    return { rows, statistics };
  }

  createUnitsTableOptions() {
    return bigQueryCreateTableOptions(
      this.datasource.settings.pipelineSettings ?? {}
    );
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

  // BigQueryDateTime: ISO Date string in UTC (Z at end)
  // BigQueryDatetime: ISO Date string with no timezone
  // BigQueryDate: YYYY-MM-DD
  convertDate(
    fromDB:
      | bq.BigQueryDatetime
      | bq.BigQueryTimestamp
      | bq.BigQueryDate
      | undefined
  ) {
    if (!fromDB?.value) return getValidDate(null);

    // BigQueryTimestamp already has `Z` at the end, but the others don't
    let value = fromDB.value;
    if (!value.endsWith("Z")) {
      value += "Z";
    }

    return getValidDate(value);
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
  escapeStringLiteral(value: string): string {
    return value.replace(/(['\\])/g, "\\$1");
  }
  castUserDateCol(column: string): string {
    return `CAST(${column} as DATETIME)`;
  }
  hasCountDistinctHLL(): boolean {
    return true;
  }
  hllAggregate(col: string): string {
    return `HLL_COUNT.INIT(${col})`;
  }
  hllReaggregate(col: string): string {
    return `HLL_COUNT.MERGE_PARTIAL(${col})`;
  }
  hllCardinality(col: string): string {
    return `HLL_COUNT.EXTRACT(${col})`;
  }
  approxQuantile(value: string, quantile: string | number): string {
    const multiplier = 10000;
    const quantileVal = Number(quantile)
      ? Math.trunc(multiplier * Number(quantile))
      : `${multiplier} * ${quantile}`;
    return `APPROX_QUANTILES(${value}, ${multiplier} IGNORE NULLS)[OFFSET(CAST(${quantileVal} AS INT64))]`;
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `JSON_VALUE(${jsonCol}, '$.${path}')`;
    return isNumeric ? `CAST(${raw} AS FLOAT64)` : raw;
  }
  getDefaultDatabase() {
    return this.params.projectId || this.params.project_id || "";
  }
  getInformationSchemaTable(schema?: string, database?: string): string {
    return this.generateTablePath(
      "INFORMATION_SCHEMA.COLUMNS",
      schema,
      database
    );
  }

  async listDatasets(): Promise<string[]> {
    const [datasets] = await this.getClient().getDatasets();

    const datasetNames: string[] = [];
    for (let i = 0; i < datasets.length; i++) {
      const dataset = datasets[i];
      if (dataset.id) {
        datasetNames.push(dataset.id);
      }
    }

    return datasetNames;
  }

  async getInformationSchema(): Promise<InformationSchema[]> {
    const datasetNames = await this.listDatasets();

    if (!datasetNames.length) {
      throw new Error(`No datasets found.`);
    }

    // eslint-disable-next-line
    const results: Record<string, any>[] = [];

    for (const datasetName of datasetNames) {
      const query = `SELECT
        table_name as table_name,
        table_catalog as table_catalog,
        table_schema as table_schema,
        count(column_name) as column_count
      FROM
        ${this.getInformationSchemaTable(`${datasetName}`)}
        WHERE ${this.getInformationSchemaWhereClause()}
      GROUP BY table_name, table_schema, table_catalog
      ORDER BY table_name;`;

      try {
        const { rows: datasetResults } = await this.runQuery(
          format(query, this.getFormatDialect())
        );

        if (datasetResults.length > 0) {
          results.push(...datasetResults);
        }
      } catch (e) {
        logger.error(
          `Error fetching information schema data for dataset: ${datasetName}`,
          e
        );
      }
    }

    if (!results.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(
      results as RawInformationSchema[],
      this.datasource.type
    );
  }
}
