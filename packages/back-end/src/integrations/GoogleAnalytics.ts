import {
  SourceIntegrationConstructor,
  SourceIntegrationInterface,
  ExperimentResults,
  ImpactEstimationResult,
  UsersQueryParams,
  MetricValueParams,
  UsersResult,
  MetricValueResult,
  VariationResult,
  MetricValueResultDate,
  PastExperimentResult,
} from "../types/Integration";
import { GoogleAnalyticsParams } from "../../types/integrations/googleanalytics";
import { decryptDataSourceParams } from "../services/datasource";
import { EventInterface } from "../models/TrackTableModel";
import { google } from "googleapis";
import {
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  APP_ORIGIN,
} from "../util/secrets";
import { DataSourceProperties } from "../../types/datasource";
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

  constructor(encryptedParams: string) {
    this.params = decryptDataSourceParams<GoogleAnalyticsParams>(
      encryptedParams
    );
  }
  getPastExperimentQuery(): string {
    throw new Error("Method not implemented.");
  }
  runPastExperimentQuery(): Promise<PastExperimentResult> {
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
  async runUsersQuery(query: string): Promise<UsersResult> {
    const { rows } = await this.runQuery(query);
    const dates: { date: string; users: number }[] = [];
    let totalUsers = 0;
    if (rows) {
      rows.forEach((row) => {
        const date = row.dimensions[0] + "T12:00:00Z";
        const users = parseFloat(row.metrics[0].values[0]);
        totalUsers += users;
        dates.push({
          date,
          users,
        });
      });
    }
    return {
      users: totalUsers,
      dates,
    };
  }
  async runMetricValueQuery(query: string): Promise<MetricValueResult> {
    const { rows, metrics } = await this.runQuery(query);
    const dates: MetricValueResultDate[] = [];
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

        let count = 0;
        let mean = 0;
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

    return {
      dates,
    };
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
    };
  }

  async getLatestEvents(): Promise<EventInterface[]> {
    throw new Error("Not implemented");
  }

  async testConnection(): Promise<boolean> {
    this.getAuth();
    return true;
  }

  getNonSensitiveParams(): Partial<GoogleAnalyticsParams> {
    return {
      customDimension: this.params.customDimension,
      viewId: this.params.viewId,
    };
  }

  getAuth() {
    const client = getOauth2Client();
    client.setCredentials({
      // eslint-disable-next-line
      refresh_token: this.params.refreshToken
    });
    return client;
  }

  async getImpactEstimation(): Promise<ImpactEstimationResult> {
    throw new Error("Not implemented for GA");
  }

  async getExperimentResults(
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[]
  ): Promise<ExperimentResults> {
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

    const result = await google.analyticsreporting("v4").reports.batchGet({
      auth: this.getAuth(),
      requestBody: {
        reportRequests: [query],
      },
    });

    const rows: VariationResult[] = [];
    const raw = result?.data?.reports[0]?.data?.rows;
    if (!raw) {
      throw new Error("Failed to update");
    }

    raw.forEach((row, i) => {
      if (i >= experiment.variations.length) return;
      row.dimensions[0] = `myexp:${i}`;
      const users = parseInt(row.metrics[0].values[0]);
      rows.push({
        variation: parseInt(row.dimensions[0].split(":", 2)[1]),
        users,
        metrics: metrics.map((metric, j) => {
          let value = parseFloat(row.metrics[0].values[j + 1]);
          if (metric.table === "ga:bounceRate") {
            value = (users * value) / 100;
          } else if (metric.table.match(/^ga:avg/)) {
            value = users * value;
          }

          const mean = Math.round(value) / users;

          // If the metric is duration, we can assume an exponential distribution and the stddev equals the mean
          const stddev = metric.type === "duration" ? mean : 0;

          return {
            metric: metric.id,
            count: users,
            mean,
            stddev,
          };
        }),
      });
    });

    return {
      results: [
        {
          dimension: "All",
          variations: rows,
        },
      ],
      query: JSON.stringify(query, null, 2),
    };
  }
};
export default GoogleAnalytics;
