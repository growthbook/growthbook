import * as bq from "@google-cloud/bigquery";
import { QueryResultsResponse } from "@google-cloud/bigquery/build/src/bigquery";
import {
  bigQueryCreateTableOptions,
  bigQueryCreateTablePartitions,
} from "shared/enterprise";
import { DateTruncGranularity, FormatDialect } from "shared/types/sql";
import { format } from "shared/sql";
import {
  ExternalIdCallback,
  InformationSchema,
  QueryResponse,
  RawInformationSchema,
  DataType,
  QueryResponseColumnData,
  MaxTimestampMetricSourceQueryParams,
  MaxTimestampIncrementalUnitsQueryParams,
} from "shared/types/integrations";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { formatInformationSchema } from "back-end/src/util/informationSchemas";
import { logger } from "back-end/src/util/logger";
import {
  BigQueryDataType,
  getFactTableTypeFromBigQueryType,
} from "back-end/src/services/bigquery";
import SqlIntegration from "./SqlIntegration";

export default class BigQuery extends SqlIntegration {
  params!: BigQueryConnectionParams;
  escapePathCharacter = "`";
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
      projectId: this.params.projectId,
      credentials: {
        client_email: this.params.clientEmail,
        private_key: this.params.privateKey,
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
        apiResult.job?.status,
      )}`,
    );
  }

  async runQuery(
    sql: string,
    setExternalId?: ExternalIdCallback,
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

    const [rows, _, queryResultsResponse] = await job.getQueryResults();
    const [metadata] = await job.getMetadata();

    const rowsInserted =
      metadata?.statistics?.query?.statementType === "INSERT"
        ? Number(metadata?.statistics?.query?.numDmlAffectedRows)
        : undefined;
    const statistics = {
      executionDurationMs: Number(
        metadata?.statistics?.finalExecutionDurationMs,
      ),
      totalSlotMs: Number(metadata?.statistics?.totalSlotMs),
      bytesProcessed: Number(metadata?.statistics?.totalBytesProcessed),
      bytesBilled: Number(metadata?.statistics?.query?.totalBytesBilled),
      warehouseCachedResult: metadata?.statistics?.query?.cacheHit,
      partitionsUsed:
        metadata?.statistics?.query?.totalPartitionsProcessed !== undefined
          ? metadata.statistics.query.totalPartitionsProcessed > 0
          : undefined,
      ...(rowsInserted !== undefined && { rowsInserted }),
    };

    const columns = queryResultsResponse
      ? this.getQueryResultResponseColumns(queryResultsResponse)
      : undefined;

    // BigQuery dates are stored nested in an object, so need to extract the value
    for (const row of rows) {
      for (const key in row) {
        const value = row[key];
        if (value instanceof bq.BigQueryDatetime) {
          row[key] = value.value + "Z"; // Convert to ISO date
        } else if (
          value instanceof bq.BigQueryTimestamp ||
          value instanceof bq.BigQueryDate
        ) {
          row[key] = value.value; // Already in ISO format
        }
      }
    }

    return {
      rows,
      columns,
      statistics,
    };
  }

  createUnitsTableOptions() {
    if (!this.datasource.settings.pipelineSettings) {
      throw new Error("Pipeline settings are required to create a units table");
    }
    return bigQueryCreateTableOptions(
      this.datasource.settings.pipelineSettings,
    );
  }

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ): string {
    return `DATETIME_${
      sign === "+" ? "ADD" : "SUB"
    }(${col}, INTERVAL ${amount} ${unit.toUpperCase()})`;
  }
  dateTrunc(col: string, granularity: DateTruncGranularity = "day") {
    return `date_trunc(${col}, ${granularity.toUpperCase()})`;
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
  supportsLimitZeroColumnValidation(): boolean {
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
    return this.params.projectId || "";
  }
  getInformationSchemaTable(schema?: string, database?: string): string {
    return this.generateTablePath(
      "INFORMATION_SCHEMA.COLUMNS",
      schema,
      database,
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
          format(query, this.getFormatDialect()),
        );

        if (datasetResults.length > 0) {
          results.push(...datasetResults);
        }
      } catch (e) {
        logger.error(
          e,
          `Error fetching information schema data for dataset: ${datasetName}`,
        );
      }
    }

    if (!results.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(results as RawInformationSchema[]);
  }

  getDataType(dataType: DataType): string {
    switch (dataType) {
      case "string":
        return "STRING";
      case "integer":
        return "INT64";
      case "float":
        return "FLOAT64";
      case "boolean":
        return "BOOL";
      case "date":
        return "DATE";
      case "timestamp":
        return "TIMESTAMP";
      case "hll":
        return "BYTES";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  }

  getQueryResultResponseColumns(
    bqQueryResultsResponse: QueryResultsResponse,
  ): QueryResponseColumnData[] | undefined {
    const mapField = (field: bq.TableField): QueryResponseColumnData => {
      let childFields: QueryResponseColumnData[] | undefined = undefined;
      if (field.type === "RECORD" || field.type === "STRUCT") {
        childFields = field.fields
          ?.filter((f) => f.name !== undefined)
          .map((f) => mapField(f));
      }

      const dataType = field.type
        ? getFactTableTypeFromBigQueryType(field.type as BigQueryDataType)
        : undefined;

      return {
        name: field.name!.toLowerCase(),
        ...(dataType && { dataType }),
        ...(childFields && { fields: childFields }),
      };
    };

    return bqQueryResultsResponse.schema?.fields
      ?.filter((field) => field.name !== undefined)
      .map((field) => mapField(field));
  }

  getCurrentTimestamp(): string {
    return `CURRENT_TIMESTAMP()`;
  }

  createTablePartitions(columns: string[]): string {
    return bigQueryCreateTablePartitions(columns);
  }

  getMaxTimestampMetricSourceQuery(
    params: MaxTimestampMetricSourceQueryParams,
  ): string {
    return format(
      `
      SELECT
        MAX(max_timestamp) AS max_timestamp
        FROM ${params.metricSourceTableFullName}
        ${params.lastMaxTimestamp ? `WHERE max_timestamp >= ${this.toTimestamp(params.lastMaxTimestamp)}` : ""}
      `,
      this.getFormatDialect(),
    );
  }

  getMaxTimestampIncrementalUnitsQuery(
    params: MaxTimestampIncrementalUnitsQueryParams,
  ): string {
    return format(
      `
      SELECT
        MAX(max_timestamp) AS max_timestamp
        FROM ${params.unitsTableFullName}
        ${params.lastMaxTimestamp ? `WHERE max_timestamp >= ${this.toTimestamp(params.lastMaxTimestamp)}` : ""}
      `,
      this.getFormatDialect(),
    );
  }
}
