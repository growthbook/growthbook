import {
  SourceIntegrationConstructor,
  SourceIntegrationInterface,
  ImpactEstimationResult,
  UsersQueryParams,
  MetricValueParams,
  ExperimentUsersQueryResponse,
  ExperimentMetricQueryResponse,
  PastExperimentResponse,
  UsersQueryResponse,
  MetricValueQueryResponse,
  ExperimentQueryResponses,
} from "../types/Integration";
import { GoogleAnalyticsParams } from "../../types/integrations/googleanalytics";
import { decryptDataSourceParams } from "../services/datasource";
import { google } from "googleapis";
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

const GoogleAnalytics: SourceIntegrationConstructor = class
  implements SourceIntegrationInterface {
  params: GoogleAnalyticsParams;
  datasource: string;
  organization: string;
  settings: DataSourceSettings;

  constructor(encryptedParams: string) {
    this.params = decryptDataSourceParams<GoogleAnalyticsParams>(
      encryptedParams
    );
    this.settings = {};
  }
  getExperimentUsersQuery(): string {
    throw new Error("Method not implemented.");
  }
  getExperimentMetricQuery(): string {
    throw new Error("Method not implemented.");
  }
  runExperimentUsersQuery(): Promise<ExperimentUsersQueryResponse> {
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
  getUsersQuery(params: UsersQueryParams): string {
    // TODO: support segments and url regex
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
  getMetricValueQuery(params: MetricValueParams): string {
    // TODO: support segments and url regex
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
  async runUsersQuery(query: string): Promise<UsersQueryResponse> {
    const { rows } = await this.runQuery(query);

    let totalUsers = 0;
    const correctedRows = rows.map((row) => {
      const users = parseFloat(row.metrics[0].values[0]);
      totalUsers += users;
      return {
        date: row.dimensions[0] + "T12:00:00Z",
        users,
      };
    });

    return [{ date: "", users: totalUsers }, ...correctedRows];
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
        const date = row.dimensions[0] + "T12:00:00Z";
        const value = parseFloat(row.metrics[0].values[0]);
        const users = parseInt(row.metrics[1].values[0]);

        let count;
        let mean;
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
        result?.data?.reports[0]?.columnHeader?.metricHeader
          ?.metricHeaderEntries || []
      ).map((m) => m.name),
      rows: result?.data?.reports[0]?.data?.rows,
    };
  }

  getSourceProperties(): DataSourceProperties {
    return {
      includeInConfig: true,
      readonlyFields: [],
      type: "api",
      queryLanguage: "json",
      metricCaps: false,
      separateExperimentResultQueries: false,
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

  async getImpactEstimation(): Promise<ImpactEstimationResult> {
    throw new Error("Not implemented for GA");
  }

  getExperimentResultsQuery(
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[]
  ): string {
    const metricExpressions = metrics.map((m) => ({
      expression: m.table,
    }));

    const query = {
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
    };

    return JSON.stringify(query, null, 2);
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

    const rows = result?.data?.reports[0]?.data?.rows;
    if (!rows) {
      throw new Error("Failed to update");
    }

    return rows.map((row) => {
      const users = parseInt(row.metrics[0].values[0]);
      return {
        dimension: "",
        variation: row.dimensions[0].split(":", 2)[1],
        users,
        metrics: metrics.map((metric, j) => {
          let value = parseFloat(row.metrics[0].values[j + 1]);
          if (metric.table === "ga:bounceRate") {
            value = (users * value) / 100;
          } else if (metric.table.match(/^ga:avg/)) {
            value = users * value;
          }

          const mean = Math.round(value) / users;

          // If the metric is duration, we can assume an exponential distribution where the stddev equals the mean
          // If the metric is count, we can assume a poisson distribution where the variance equals the mean
          const stddev =
            metric.type === "duration"
              ? mean
              : metric.type === "count"
              ? Math.sqrt(mean)
              : 0;

          return {
            metric: metric.id,
            count: users,
            mean,
            stddev,
          };
        }),
      };
    });
  }
};
export default GoogleAnalytics;
