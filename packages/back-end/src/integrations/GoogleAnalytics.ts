import { analyticsreporting_v4, google } from "googleapis";
import {
  SourceIntegrationConstructor,
  SourceIntegrationInterface,
  MetricValueParams,
  ExperimentMetricQueryResponse,
  PastExperimentResponse,
  MetricValueQueryResponse,
  ExperimentQueryResponses,
} from "../types/Integration";
import { GoogleAnalyticsParams } from "../../types/integrations/googleanalytics";
import { decryptDataSourceParams } from "../services/datasource";
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  APP_ORIGIN,
} from "../util/secrets";
import {
  DataSourceProperties,
  DataSourceSettings,
} from "../../types/datasource";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { MetricInterface } from "../../types/metric";

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
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  datasource: string;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  organization: string;
  settings: DataSourceSettings;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  decryptionError: boolean;

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
  runExperimentMetricQuery(): Promise<ExperimentMetricQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getPastExperimentQuery(): string {
    throw new Error("Method not implemented.");
  }
  runPastExperimentQuery(): Promise<PastExperimentResponse> {
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
    const dates: MetricValueQueryResponse = [];
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

        dates.push({
          date,
          count,
          mean,
          stddev,
        });
      });
    }

    return dates;
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
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[]
  ): string {
    const metricExpressions = metrics.map((m) => ({
      expression: m.table,
    }));

    const query: analyticsreporting_v4.Schema$ReportRequest = {
      viewId: this.params.viewId,
      dateRanges: [
        {
          startDate: phase.dateStarted.toISOString().substr(0, 10),
          endDate: (phase.dateEnded || new Date()).toISOString().substr(0, 10),
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
              expressions: [experiment.trackingKey + this.getDelimiter()],
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
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[]
  ): Promise<ExperimentQueryResponses> {
    const query = this.getExperimentResultsQuery(experiment, phase, metrics);

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
          const count = users;

          // GA doesn't expose standard deviations, so we have to guess
          // If the metric is duration, we can assume an exponential distribution where the stddev equals the mean
          // If the metric is count, we can assume a poisson distribution where the variance equals the mean
          // For binomial metrics, we can use the Normal approximation for a bernouli random variable
          const stddev =
            metric.type === "duration"
              ? mean
              : metric.type === "count"
              ? Math.sqrt(mean)
              : metric.type === "binomial"
              ? Math.sqrt(mean * (1 - mean))
              : 0;

          return {
            metric: metric.id,
            users,
            count,
            mean,
            stddev,
          };
        }),
      };
    });
  }
};
export default GoogleAnalytics;
