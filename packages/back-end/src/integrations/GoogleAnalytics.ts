import { analyticsreporting_v4, google } from "googleapis";
import { DataSourceType } from "aws-sdk/clients/quicksight";
import cloneDeep from "lodash/cloneDeep";
import { decryptDataSourceParams } from "@/src/services/datasource";
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  APP_ORIGIN,
} from "@/src/util/secrets";
import { sumSquaresFromStats } from "@/src/util/stats";
import { applyMetricOverrides } from "@/src/util/integration";
import { GoogleAnalyticsParams } from "@/types/integrations/googleanalytics";
import { DataSourceProperties, DataSourceSettings } from "@/types/datasource";
import { MetricInterface } from "@/types/metric";
import { ExperimentSnapshotSettings } from "@/types/experiment-snapshot";
import {
  SourceIntegrationConstructor,
  SourceIntegrationInterface,
  MetricValueParams,
  ExperimentMetricQueryResponse,
  MetricValueQueryResponse,
  ExperimentQueryResponses,
  MetricValueQueryResponseRows,
  PastExperimentQueryResponse,
  ExperimentUnitsQueryResponse,
  ExperimentAggregateUnitsQueryResponse,
  DimensionSlicesQueryResponse,
} from "@/src/types/Integration";

export function getOauth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    `${APP_ORIGIN}/oauth/google`
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

const GoogleAnalytics: SourceIntegrationConstructor = class
  implements SourceIntegrationInterface {
  params: GoogleAnalyticsParams;
  type!: DataSourceType;
  datasource!: string;
  organization!: string;
  settings: DataSourceSettings;
  decryptionError!: boolean;

  constructor(encryptedParams: string) {
    try {
      this.params = decryptDataSourceParams<GoogleAnalyticsParams>(
        encryptedParams
      );
    } catch (e) {
      this.params = { customDimension: "", refreshToken: "", viewId: "" };
      this.decryptionError = true;
    }
    this.settings = {};
  }
  getExperimentMetricQuery(): string {
    throw new Error("Method not implemented.");
  }
  getExperimentAggregateUnitsQuery(): string {
    throw new Error("Method not implemented.");
  }
  runExperimentAggregateUnitsQuery(): Promise<ExperimentAggregateUnitsQueryResponse> {
    throw new Error("Method not implemented.");
  }
  runExperimentMetricQuery(): Promise<ExperimentMetricQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getExperimentUnitsTableQuery(): string {
    throw new Error("Method not implemented.");
  }
  runExperimentUnitsQuery(): Promise<ExperimentUnitsQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getPastExperimentQuery(): string {
    throw new Error("Method not implemented.");
  }
  runPastExperimentQuery(): Promise<PastExperimentQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getDimensionSlicesQuery(): string {
    throw new Error("Method not implemented.");
  }
  async runDimensionSlicesQuery(): Promise<DimensionSlicesQueryResponse> {
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
      2
    );
  }
  async runMetricValueQuery(query: string): Promise<MetricValueQueryResponse> {
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
          metric
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
          count
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
    metricDocs: MetricInterface[]
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
    metrics: MetricInterface[]
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
};
export default GoogleAnalytics;
