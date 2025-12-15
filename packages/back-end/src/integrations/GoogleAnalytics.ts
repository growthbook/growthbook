import { analyticsreporting_v4, google } from "googleapis";
import cloneDeep from "lodash/cloneDeep";
import {
  MetricValueParams,
  ExperimentMetricQueryResponse,
  MetricValueQueryResponse,
  ExperimentQueryResponses,
  MetricValueQueryResponseRows,
  PastExperimentQueryResponse,
  ExperimentUnitsQueryResponse,
  ExperimentAggregateUnitsQueryResponse,
  DimensionSlicesQueryResponse,
  MetricAnalysisQueryResponse,
  DropTableQueryResponse,
  IncrementalWithNoOutputQueryResponse,
  ExternalIdCallback,
  MaxTimestampQueryResponse,
  ExperimentMetricQueryParams,
  ExperimentAggregateUnitsQueryParams,
  ExperimentUnitsQueryParams,
  CreateExperimentIncrementalUnitsQueryParams,
  UpdateExperimentIncrementalUnitsQueryParams,
  DropOldIncrementalUnitsQueryParams,
  AlterNewIncrementalUnitsQueryParams,
  MaxTimestampIncrementalUnitsQueryParams,
  MaxTimestampMetricSourceQueryParams,
  CreateMetricSourceTableQueryParams,
  InsertMetricSourceDataQueryParams,
  IncrementalRefreshStatisticsQueryParams,
  DimensionSlicesQueryParams,
  PastExperimentParams,
  MetricAnalysisParams,
  ExperimentFactMetricsQueryResponse,
  UserExperimentExposuresQueryResponse,
  DropMetricSourceCovariateTableQueryParams,
  InsertMetricSourceCovariateDataQueryParams,
  CreateMetricSourceCovariateTableQueryParams,
} from "shared/types/integrations";
import { ReqContext } from "back-end/types/request";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { GoogleAnalyticsParams } from "back-end/types/integrations/googleanalytics";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  APP_ORIGIN,
} from "back-end/src/util/secrets";
import { sumSquaresFromStats } from "back-end/src/util/stats";
import {
  DataSourceInterface,
  DataSourceProperties,
} from "back-end/types/datasource";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentSnapshotSettings } from "back-end/types/experiment-snapshot";
import { applyMetricOverrides } from "back-end/src/util/integration";
import { FactMetricInterface } from "back-end/types/fact-table";

export function getOauth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    `${APP_ORIGIN}/oauth/google`,
  );
}

// Transforms YYYYMMDD to ISO format (or empty string)
function convertDate(rawDate: string): string {
  if (rawDate.match(/^[0-9]{8}$/)) {
    return (
      rawDate.slice(0, 4) +
      "-" +
      rawDate.slice(4, 6) +
      "-" +
      rawDate.slice(6, 8) +
      "T12:00:00Z"
    );
  }

  return "";
}

export default class GoogleAnalytics implements SourceIntegrationInterface {
  params: GoogleAnalyticsParams;
  context: ReqContext;
  datasource: DataSourceInterface;
  decryptionError: boolean;

  constructor(context: ReqContext, datasource: DataSourceInterface) {
    this.context = context;
    this.datasource = datasource;

    this.decryptionError = false;
    try {
      this.params = decryptDataSourceParams<GoogleAnalyticsParams>(
        datasource.params,
      );
    } catch (e) {
      this.params = { customDimension: "", refreshToken: "", viewId: "" };
      this.decryptionError = true;
    }
  }
  getCurrentTimestamp(): string {
    throw new Error("Method not implemented.");
  }
  getMetricAnalysisQuery(
    _metric: FactMetricInterface,
    _params: Omit<MetricAnalysisParams, "metric">,
  ): string {
    throw new Error("Method not implemented.");
  }
  runMetricAnalysisQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<MetricAnalysisQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getDropUnitsTableQuery(_: { fullTablePath: string }): string {
    throw new Error("Method not implemented.");
  }
  runDropTableQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<DropTableQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getExperimentMetricQuery(_: ExperimentMetricQueryParams): string {
    throw new Error("Method not implemented.");
  }
  getExperimentAggregateUnitsQuery(
    _: ExperimentAggregateUnitsQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  runExperimentAggregateUnitsQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<ExperimentAggregateUnitsQueryResponse> {
    throw new Error("Method not implemented.");
  }
  runExperimentMetricQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<ExperimentMetricQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getExperimentUnitsTableQuery(_: ExperimentUnitsQueryParams): string {
    throw new Error("Method not implemented.");
  }
  runExperimentUnitsQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<ExperimentUnitsQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getPastExperimentQuery(_: PastExperimentParams): string {
    throw new Error("Method not implemented.");
  }
  runPastExperimentQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<PastExperimentQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getDimensionSlicesQuery(_: DimensionSlicesQueryParams): string {
    throw new Error("Method not implemented.");
  }
  async runDimensionSlicesQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<DimensionSlicesQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getCreateExperimentIncrementalUnitsQuery(
    _: CreateExperimentIncrementalUnitsQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  getUpdateExperimentIncrementalUnitsQuery(
    _: UpdateExperimentIncrementalUnitsQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  getDropOldIncrementalUnitsQuery(
    _: DropOldIncrementalUnitsQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  getAlterNewIncrementalUnitsQuery(
    _: AlterNewIncrementalUnitsQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  getMaxTimestampIncrementalUnitsQuery(
    _: MaxTimestampIncrementalUnitsQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  getMaxTimestampMetricSourceQuery(
    _: MaxTimestampMetricSourceQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  getCreateMetricSourceTableQuery(
    _: CreateMetricSourceTableQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  getInsertMetricSourceDataQuery(_: InsertMetricSourceDataQueryParams): string {
    throw new Error("Method not implemented.");
  }
  getIncrementalRefreshStatisticsQuery(
    _: IncrementalRefreshStatisticsQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  runIncrementalWithNoOutputQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<IncrementalWithNoOutputQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getDropMetricSourceCovariateTableQuery(
    _params: DropMetricSourceCovariateTableQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  getCreateMetricSourceCovariateTableQuery(
    _params: CreateMetricSourceCovariateTableQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  getInsertMetricSourceCovariateDataQuery(
    _params: InsertMetricSourceCovariateDataQueryParams,
  ): string {
    throw new Error("Method not implemented.");
  }
  runIncrementalRefreshStatisticsQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<ExperimentFactMetricsQueryResponse> {
    throw new Error("Method not implemented.");
  }
  runMaxTimestampQuery(
    _query: string,
    _setExternalId: ExternalIdCallback,
  ): Promise<MaxTimestampQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getUserExperimentExposuresQuery(): string {
    throw new Error("Method not implemented.");
  }
  runUserExperimentExposuresQuery(): Promise<UserExperimentExposuresQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getMetricValueQuery(params: MetricValueParams): string {
    // TODO: support segments
    return JSON.stringify(
      {
        viewId: this.params.viewId,
        dateRanges: [
          {
            startDate: params.from.toISOString().substr(0, 10),
            endDate: params.to.toISOString().substr(0, 10),
          },
        ],
        metrics: [
          {
            expression: params.metric.table,
          },
          {
            expression: "ga:users",
          },
        ],
        dimensions: [
          {
            name: "ga:date",
          },
        ],
      },
      null,
      2,
    );
  }
  async runMetricValueQuery(
    query: string,
    _setExternalId?: ExternalIdCallback,
  ): Promise<MetricValueQueryResponse> {
    const { rows, metrics } = await this.runQuery(query);
    const dates: MetricValueQueryResponseRows = [];
    if (rows) {
      const metric = metrics[0];
      const isTotal =
        metric && metric !== "ga:bounceRate" && !metric.match(/^ga:avg/);
      const isBinomial =
        metric &&
        (metric === "ga:bounceRate" ||
          metric.match(/^ga:goal.*(Starts|Completions)$/));
      const isDuration =
        metric &&
        ["ga:avgPageLoadTime", "avgSessionDuration", "avgTimeOnPage"].includes(
          metric,
        );
      rows.forEach((row) => {
        const date = convertDate(row.dimensions?.[0] || "");
        const value = parseFloat(row.metrics?.[0]?.values?.[0] || "") || 0;
        const users = parseInt(row.metrics?.[0]?.values?.[1] || "") || 0;

        let count: number;
        let mean: number;
        let stddev = 0;

        if (metric === "ga:bounceRate") {
          count = Math.round((users * value) / 100);
          mean = 1;
        } else if (isBinomial) {
          count = value;
          mean = 1;
        } else if (isDuration) {
          count = users;
          mean = value;
          stddev = mean;
        } else if (isTotal) {
          count = users;
          mean = value / users;
        } else {
          count = users;
          mean = value;
        }

        // Rebuild sum and sums of squares to match SQL integration
        // TODO: refactor above queries to just build these values directly
        const sum = count * mean;
        const sum_squares = sumSquaresFromStats(
          sum,
          Math.pow(stddev, 2),
          count,
        );
        dates.push({
          date,
          count,
          main_sum: sum,
          main_sum_squares: sum_squares,
        });
      });
    }

    return { rows: dates };
  }

  async runQuery(query: string) {
    const result = await google.analyticsreporting("v4").reports.batchGet({
      auth: this.getAuth(),
      requestBody: {
        reportRequests: [JSON.parse(query)],
      },
    });

    return {
      metrics: (
        result?.data?.reports?.[0]?.columnHeader?.metricHeader
          ?.metricHeaderEntries || []
      ).map((m) => m.name),
      rows: result?.data?.reports?.[0]?.data?.rows,
    };
  }

  getSourceProperties(): DataSourceProperties {
    return {
      queryLanguage: "json",
    };
  }

  async testConnection(): Promise<boolean> {
    this.getAuth();
    return true;
  }

  getSensitiveParamKeys(): string[] {
    return ["refreshToken"];
  }

  getAuth() {
    const client = getOauth2Client();
    client.setCredentials({
      // eslint-disable-next-line
      refresh_token: this.params.refreshToken,
    });
    return client;
  }

  getExperimentResultsQuery(
    snapshotSettings: ExperimentSnapshotSettings,
    metricDocs: MetricInterface[],
  ): string {
    const metrics = metricDocs.map((m) => {
      const mCopy = cloneDeep<MetricInterface>(m);
      applyMetricOverrides(mCopy, snapshotSettings);
      return mCopy;
    });
    const metricExpressions = metrics.map((m) => ({
      expression: m.table,
    }));

    const query: analyticsreporting_v4.Schema$ReportRequest = {
      viewId: this.params.viewId,
      dateRanges: [
        {
          startDate: snapshotSettings.startDate.toISOString().substr(0, 10),
          endDate: snapshotSettings.endDate.toISOString().substr(0, 10),
        },
      ],
      metrics: [
        {
          expression: "ga:users",
        },
        ...metricExpressions,
      ],
      dimensions: [
        {
          name: `ga:dimension${this.params.customDimension}`,
        },
      ],
      dimensionFilterClauses: [
        {
          filters: [
            {
              dimensionName: `ga:dimension${this.params.customDimension}`,
              operator: "BEGINS_WITH",
              expressions: [
                snapshotSettings.experimentId + this.getDelimiter(),
              ],
            },
          ],
        },
      ],
    };

    return JSON.stringify(query, null, 2);
  }

  private getDelimiter() {
    return this.params.delimiter || ":";
  }

  async getExperimentResults(
    snapshotSettings: ExperimentSnapshotSettings,
    metrics: MetricInterface[],
  ): Promise<ExperimentQueryResponses> {
    const query = this.getExperimentResultsQuery(snapshotSettings, metrics);

    const result = await google.analyticsreporting("v4").reports.batchGet({
      auth: this.getAuth(),
      requestBody: {
        reportRequests: [JSON.parse(query)],
      },
    });

    const rows = result?.data?.reports?.[0]?.data?.rows;
    if (!rows) {
      throw new Error("Failed to update");
    }

    return rows.map((row) => {
      const users = parseInt(row.metrics?.[0]?.values?.[0] || "");
      return {
        dimension: "",
        variation:
          (row.dimensions?.[0] || "").split(this.getDelimiter(), 2)[1] || "",
        users: users || 0,
        metrics: metrics.map((metric, j) => {
          let value = parseFloat(row.metrics?.[0]?.values?.[j + 1] || "") || 0;
          if (metric.table === "ga:bounceRate") {
            value = (users * value) / 100;
          } else if (metric.table?.match(/^ga:avg/)) {
            value = users * value;
          }

          const mean = Math.round(value) / users;
          const sum = value;
          const count = users;

          // GA doesn't expose standard deviations, so we have to guess
          // If the metric is duration, we can assume an exponential distribution where the stddev equals the mean
          // If the metric is count, we can assume a poisson distribution where the variance equals the mean
          // For binomial metrics, we can use the Normal approximation for a bernouli random variable
          const variance =
            metric.type === "duration"
              ? Math.pow(mean, 2)
              : metric.type === "count"
                ? mean
                : metric.type === "binomial"
                  ? mean * (1 - mean)
                  : 0;

          // because of above guessing about stddev, we have to backout the implied sum_squares
          const sum_squares = sumSquaresFromStats(mean, variance, count);
          return {
            metric: metric.id,
            metric_type: metric.type,
            count: count,
            main_sum: sum,
            main_sum_squares: sum_squares,
          };
        }),
      };
    });
  }
}
