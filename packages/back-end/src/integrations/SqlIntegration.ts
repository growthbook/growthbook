import { MetricInterface } from "../../types/metric";
import {
  DataSourceSettings,
  DataSourceProperties,
} from "../../types/datasource";
import {
  ImpactEstimationResult,
  MetricValueParams,
  SourceIntegrationInterface,
  ExperimentMetricQueryParams,
  PastExperimentParams,
  PastExperimentResponse,
  ExperimentMetricQueryResponse,
  MetricValueQueryResponse,
  MetricValueQueryResponseRow,
  ExperimentQueryResponses,
} from "../types/Integration";
import { format, FormatOptions } from "sql-formatter";
import { ExperimentPhase, ExperimentInterface } from "../../types/experiment";
import { DimensionInterface } from "../../types/dimension";
import { SegmentInterface } from "../../types/segment";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";
import { processMetricValueQueryResponse } from "../services/queries";
import { getValidDate } from "../util/dates";

const percentileNumbers = [
  0.01,
  0.05,
  0.1,
  0.2,
  0.3,
  0.4,
  0.5,
  0.6,
  0.7,
  0.8,
  0.9,
  0.95,
  0.99,
];

export function getExperimentQuery(
  settings: DataSourceSettings,
  schema?: string
): string {
  if (settings?.queries?.experimentsQuery) {
    return settings.queries.experimentsQuery;
  }

  return `SELECT
  ${
    settings?.experiments?.userIdColumn ||
    settings?.default?.userIdColumn ||
    "user_id"
  } as user_id,
  ${
    settings?.experiments?.anonymousIdColumn ||
    settings?.default?.anonymousIdColumn ||
    "anonymous_id"
  } as anonymous_id,
  ${
    settings?.experiments?.timestampColumn ||
    settings?.default?.timestampColumn ||
    "received_at"
  } as timestamp,
  ${
    settings?.experiments?.experimentIdColumn || "experiment_id"
  } as experiment_id,
  ${settings?.experiments?.variationColumn || "variation_id"} as variation_id
FROM 
  ${schema && !settings?.experiments?.table?.match(/\./) ? schema + "." : ""}${
    settings?.experiments?.table || "experiment_viewed"
  }`;
}

export function getPageviewsQuery(
  settings: DataSourceSettings,
  schema?: string
): string {
  if (settings?.queries?.pageviewsQuery) {
    return settings.queries.pageviewsQuery;
  }

  return `SELECT
  ${
    settings?.pageviews?.userIdColumn ||
    settings?.default?.userIdColumn ||
    "user_id"
  } as user_id,
  ${
    settings?.pageviews?.anonymousIdColumn ||
    settings?.default?.anonymousIdColumn ||
    "anonymous_id"
  } as anonymous_id,
  ${
    settings?.pageviews?.timestampColumn ||
    settings?.default?.timestampColumn ||
    "received_at"
  } as timestamp,
  ${settings?.pageviews?.urlColumn || "path"} as url
FROM 
  ${schema && !settings?.pageviews?.table?.match(/\./) ? schema + "." : ""}${
    settings?.pageviews?.table || "pages"
  }`;
}

export default abstract class SqlIntegration
  implements SourceIntegrationInterface {
  settings: DataSourceSettings;
  datasource: string;
  organization: string;
  // eslint-disable-next-line
  params: any;
  abstract setParams(encryptedParams: string): void;
  // eslint-disable-next-line
  abstract runQuery(sql: string): Promise<any[]>;
  abstract percentile(col: string, percentile: number): string;
  abstract getSensitiveParamKeys(): string[];

  constructor(encryptedParams: string, settings: DataSourceSettings) {
    this.setParams(encryptedParams);
    this.settings = {
      ...settings,
    };
  }
  getSourceProperties(): DataSourceProperties {
    return {
      queryLanguage: "sql",
      metricCaps: true,
      segments: true,
      dimensions: true,
      separateExperimentResultQueries: true,
      hasSettings: true,
      userIds: true,
      experimentSegments: true,
      activationDimension: true,
    };
  }

  async testConnection(): Promise<boolean> {
    await this.runQuery("select 1");
    return true;
  }

  getSchema(): string {
    return "";
  }
  toTimestamp(date: Date) {
    return `'${date.toISOString().substr(0, 19).replace("T", " ")}'`;
  }
  addHours(col: string, hours: number) {
    return `${col} + INTERVAL '${hours} hours'`;
  }
  subtractHalfHour(col: string) {
    return `${col} - INTERVAL '30 minutes'`;
  }
  regexMatch(col: string, regex: string) {
    return `${col} ~ '${regex}'`;
  }
  dateTrunc(col: string) {
    return `date_trunc('day', ${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `datediff(day, ${startCol}, ${endCol})`;
  }
  // eslint-disable-next-line
  convertDate(fromDB: any): Date {
    return getValidDate(fromDB);
  }
  stddev(col: string) {
    return `STDDEV(${col})`;
  }
  avg(col: string) {
    return `AVG(${col})`;
  }
  formatDate(col: string): string {
    return col;
  }
  ifElse(condition: string, ifTrue: string, ifFalse: string) {
    return `(CASE WHEN ${condition} THEN ${ifTrue} ELSE ${ifFalse} END)`;
  }

  getPastExperimentQuery(params: PastExperimentParams) {
    const minLength = params.minLength ?? 6;

    return format(
      `-- Past Experiments
    WITH
      __experiments as (
        ${getExperimentQuery(this.settings, this.getSchema())}
      ),
      __experimentDates as (
        SELECT
          experiment_id,
          variation_id,
          ${this.dateTrunc("timestamp")} as date,
          count(distinct anonymous_id) as users
        FROM
          __experiments
        WHERE
          timestamp > ${this.toTimestamp(params.from)}
        GROUP BY
          experiment_id,
          variation_id,
          ${this.dateTrunc("timestamp")}
      ),
      __userThresholds as (
        SELECT
          experiment_id,
          variation_id,
          -- It's common for a small number of tracking events to continue coming in
          -- long after an experiment ends, so limit to days with enough traffic
          max(users)*0.05 as threshold
        FROM
          __experimentDates
        WHERE
          -- Skip days where a variation got 5 or fewer visitors since it's probably not real traffic
          users > 5
        GROUP BY
          experiment_id, variation_id
      ),
      __variations as (
        SELECT
          d.experiment_id,
          d.variation_id,
          MIN(d.date) as start_date,
          MAX(d.date) as end_date,
          SUM(d.users) as users
        FROM
          __experimentDates d
          JOIN __userThresholds u ON (
            d.experiment_id = u.experiment_id
            AND d.variation_id = u.variation_id
          )
        WHERE
          d.users > u.threshold
        GROUP BY
          d.experiment_id, d.variation_id
      )
    SELECT
      *
    FROM
      __variations
    WHERE
      -- Skip experiments with fewer than 200 users since they don't have enough data
      users > 200 AND
      -- Skip experiments that are shorter than ${minLength} days (most likely means it was stopped early)
      ${this.dateDiff("start_date", "end_date")} >= ${minLength} AND
      -- Skip experiments that start on the very first day since we're likely missing data
      ${this.dateDiff(this.toTimestamp(params.from), "start_date")} > 2
    ORDER BY
      experiment_id ASC, variation_id ASC`,
      this.getFormatOptions()
    );
  }
  async runPastExperimentQuery(query: string): Promise<PastExperimentResponse> {
    const rows = await this.runQuery(query);

    return rows.map((row) => {
      return {
        experiment_id: row.experiment_id,
        variation_id: row.variation_id ?? "",
        users: parseInt(row.users) || 0,
        end_date: this.convertDate(row.end_date).toISOString(),
        start_date: this.convertDate(row.start_date).toISOString(),
      };
    });
  }

  getMetricValueQuery(params: MetricValueParams): string {
    const userId = params.userIdType === "user";

    // Get rough date filter for metrics to improve performance
    const metricStart = new Date(params.from);
    metricStart.setMinutes(metricStart.getMinutes() - 30);
    const metricEnd = new Date(params.to);
    metricEnd.setHours(
      metricEnd.getHours() +
        (params.metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS)
    );

    return format(
      `-- ${params.name} - ${params.metric.name} Metric
      WITH
        ${this.getIdentifiesCTE(userId, {
          from: params.from,
          to: params.to,
          segment: !!params.segmentQuery,
          metrics: [params.metric],
        })}
        __pageviews as (${getPageviewsQuery(this.settings, this.getSchema())}),
        __users as (${this.getPageUsersCTE(
          params,
          userId,
          params.metric.conversionWindowHours
        )})
        ${
          params.segmentQuery
            ? `, segment as (${this.getSegmentCTE(
                params.segmentQuery,
                params.segmentName || "",
                userId
              )})`
            : ""
        }
        , __metric as (${this.getMetricCTE({
          metric: params.metric,
          userId,
          startDate: metricStart,
          endDate: metricEnd,
        })})
        , __distinctUsers as (
          SELECT
            u.user_id,
            MIN(u.conversion_end) as conversion_end,
            MIN(u.session_start) as session_start,
            MIN(u.actual_start) as actual_start
          FROM
            __users u
            ${
              params.segmentQuery
                ? "JOIN segment s ON (s.user_id = u.user_id) WHERE s.date <= u.actual_start"
                : ""
            }
          GROUP BY
            u.user_id
        )
        , __userMetric as (
          -- Add in the aggregate metric value for each user
          SELECT
            ${this.getAggregateMetricSqlValue(params.metric)} as value
          FROM
            __distinctUsers d
            JOIN __metric m ON (
              m.user_id = d.user_id
            )
            WHERE
              m.actual_start >= d.${
                params.metric.earlyStart ? "session_start" : "actual_start"
              }
              AND m.actual_start <= d.conversion_end
          GROUP BY
            d.user_id
        )
        , __overallUsers as (
          -- Number of users overall
          SELECT
            COUNT(*) as users
          FROM
            __distinctUsers
        )
        , __overall as (
          SELECT
            COUNT(*) as count,
            ${this.avg("value")} as mean,
            ${this.stddev("value")} as stddev
            ${
              params.includePercentiles && params.metric.type !== "binomial"
                ? `,${percentileNumbers
                    .map(
                      (n) =>
                        `${this.percentile("value", n)} as p${Math.floor(
                          n * 100
                        )}`
                    )
                    .join("\n      ,")}`
                : ""
            }
          from
            __userMetric
        )
        ${
          params.includeByDate
            ? `
          , __userMetricDates as (
            -- Add in the aggregate metric value for each user
            SELECT
              ${this.dateTrunc("d.actual_start")} as date,
              ${this.getAggregateMetricSqlValue(params.metric)} as value
            FROM
              __distinctUsers d
              JOIN __metric m ON (
                m.user_id = d.user_id
              )
              WHERE
                m.actual_start >= d.${
                  params.metric.earlyStart ? "session_start" : "actual_start"
                }
                AND m.actual_start <= d.conversion_end
            GROUP BY
              ${this.dateTrunc("d.actual_start")},
              d.user_id
          )
          , __usersByDate as (
            -- Number of users by date
            SELECT
              ${this.dateTrunc("actual_start")} as date,
              COUNT(*) as users
            FROM
              __distinctUsers
            GROUP BY
              ${this.dateTrunc("actual_start")}
          )
          , __byDateOverall as (
            SELECT
              date,
              COUNT(*) as count,
              ${this.avg("value")} as mean,
              ${this.stddev("value")} as stddev
              ${
                params.includePercentiles && params.metric.type !== "binomial"
                  ? `,${percentileNumbers
                      .map((n) => `0 as p${Math.floor(n * 100)}`)
                      .join("\n      ,")}`
                  : ""
              }
            FROM
              __userMetricDates d
            GROUP BY
              date
          )`
            : ""
        }
      SELECT
        ${params.includeByDate ? "null as date," : ""}
        o.*,
        u.users
      FROM
        __overall o
        JOIN __overallUsers u ON (1=1)
      ${
        params.includeByDate
          ? `
        UNION ALL SELECT
          o.*,
          u.users
        FROM
          __byDateOverall o
          JOIN __usersByDate u ON (o.date = u.date)
        ORDER BY
          date ASC
      `
          : ""
      }
      `,
      this.getFormatOptions()
    );
  }

  async runExperimentMetricQuery(
    query: string
  ): Promise<ExperimentMetricQueryResponse> {
    const rows = await this.runQuery(query);
    return rows.map((row) => {
      return {
        variation: row.variation ?? "",
        dimension: row.dimension || "",
        users: parseInt(row.users) || 0,
        count: parseFloat(row.count) || 0,
        mean: parseFloat(row.mean) || 0,
        stddev: parseFloat(row.stddev) || 0,
      };
    });
  }

  async runMetricValueQuery(query: string): Promise<MetricValueQueryResponse> {
    const rows = await this.runQuery(query);

    return rows.map((row) => {
      const { date, count, mean, users, stddev, ...percentiles } = row;

      const ret: MetricValueQueryResponseRow = {
        date: date ? this.convertDate(date).toISOString() : "",
        users: parseInt(users) || 0,
        count: parseFloat(count) || 0,
        mean: parseFloat(mean) || 0,
        stddev: parseFloat(stddev) || 0,
      };

      if (percentiles) {
        Object.keys(percentiles).forEach((p) => {
          ret[p] = parseFloat(percentiles[p]) || 0;
        });
      }

      return ret;
    });
  }

  getFormatOptions(): FormatOptions {
    return {
      language: "redshift",
    };
  }

  async getImpactEstimation(
    urlRegex: string,
    metric: MetricInterface,
    segment?: SegmentInterface
  ): Promise<ImpactEstimationResult> {
    const numDays = 30;

    const conversionWindowHours =
      metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS;

    // Ignore last X hours of data since we need to give people time to convert
    const end = new Date();
    end.setHours(end.getHours() - conversionWindowHours);
    const start = new Date();
    start.setDate(start.getDate() - numDays);
    start.setHours(start.getHours() - conversionWindowHours);

    const baseSettings = {
      from: start,
      to: end,
      includeByDate: false,
      userIdType: metric.userIdType || "either",
      conversionWindowHours,
    };

    const metricSql = this.getMetricValueQuery({
      ...baseSettings,
      name: "Metric Value - Entire Site",
      metric,
      includePercentiles: false,
    });
    const valueSql = this.getMetricValueQuery({
      ...baseSettings,
      name: "Metric Value - Selected Pages and Segment",
      metric,
      includePercentiles: false,
      urlRegex,
      segmentQuery: segment?.sql,
      segmentName: segment?.name,
    });

    const [metricTotalResponse, valueResponse]: [
      MetricValueQueryResponse,
      MetricValueQueryResponse
    ] = await Promise.all([
      this.runMetricValueQuery(metricSql),
      this.runMetricValueQuery(valueSql),
    ]);

    const metricTotal = processMetricValueQueryResponse(metricTotalResponse);
    const value = processMetricValueQueryResponse(valueResponse);

    const formatted =
      [metricSql, valueSql]
        .map((sql) => format(sql, this.getFormatOptions()))
        .join(";\n\n") + ";";

    return {
      query: formatted,
      users: value.users,
      value: (value.count * value.mean) / numDays,
      metricTotal: (metricTotal.count * metricTotal.mean) / numDays,
    };
  }

  private getIdentifiesCTE(
    userId: boolean,
    {
      from,
      to,
      metrics,
      dimension,
      segment,
    }: {
      from: Date;
      to?: Date;
      metrics?: (MetricInterface | null)[];
      dimension?: boolean;
      segment?: boolean;
    }
  ): string {
    const select = `__identities as (
      SELECT
        user_id,
        anonymous_id
      FROM
        (${getPageviewsQuery(this.settings, this.getSchema())}) i
      WHERE
        i.timestamp >= ${this.toTimestamp(from)}
        ${to ? `AND i.timestamp <= ${this.toTimestamp(to)}` : ""}
      GROUP BY
        user_id, 
        anonymous_id
    ),`;

    if (metrics) {
      for (let i = 0; i < metrics.length; i++) {
        if (!metrics[i]) continue;
        if (userId && metrics[i]?.userIdType === "anonymous") {
          return select;
        } else if (!userId && metrics[i]?.userIdType === "user") {
          return select;
        }
      }
    }
    if (dimension && !userId) return select;
    if (segment && !userId) return select;

    return "";
  }

  private getIdentifiesJoinSql(column: string, userId: boolean = true) {
    return `JOIN __identities i ON (
      i.${userId ? "user_id" : "anonymous_id"} = ${column}
    )`;
  }

  private getActivatedUsersCTE() {
    return `
      SELECT
        e.user_id,
        a.actual_start,
        a.session_start,
        a.conversion_end
      FROM
        __experiment e
        JOIN __activationMetric a ON (
          a.user_id = e.user_id
        )
      WHERE
        a.actual_start >= e.actual_start
        AND a.actual_start <= e.conversion_end`;
  }

  private ifNullFallback(nullable: string | null, fallback: string) {
    if (!nullable) return fallback;
    return `COALESCE(${nullable}, ${fallback})`;
  }

  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string {
    const {
      metric,
      experiment,
      phase,
      dimension,
      activationMetric,
      segment,
    } = params;

    const userId = experiment.userIdType === "user";

    const activationDimension =
      activationMetric && dimension?.type === "activation";

    // Get rough date filter for metrics to improve performance
    const metricStart = new Date(phase.dateStarted);
    metricStart.setMinutes(metricStart.getMinutes() - 30);
    const metricEnd = phase.dateEnded ? new Date(phase.dateEnded) : null;
    if (metricEnd) {
      metricEnd.setHours(
        metricEnd.getHours() +
          // Add conversion window so metric has time to convert after experiment ends
          (metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS) +
          // If using an activation metric, also need to allow for that conversion time
          (activationMetric
            ? activationMetric.conversionWindowHours ||
              DEFAULT_CONVERSION_WINDOW_HOURS
            : 0)
      );
    }

    return format(
      `-- ${metric.name} (${metric.type})
    WITH
      ${this.getIdentifiesCTE(userId, {
        from: phase.dateStarted,
        to: phase.dateEnded,
        dimension: dimension?.type === "user",
        metrics: [metric, activationMetric],
      })}
      __rawExperiment as (${getExperimentQuery(
        this.settings,
        this.getSchema()
      )}),
      __experiment as (${this.getExperimentCTE({
        experiment,
        phase,
        conversionWindowHours:
          (activationMetric
            ? activationMetric.conversionWindowHours
            : metric.conversionWindowHours) || 0,
        experimentDimension:
          dimension?.type === "experiment" ? dimension.id : null,
      })})
      , __metric as (${this.getMetricCTE({
        metric,
        userId,
        startDate: metricStart,
        endDate: metricEnd,
      })})
      ${
        segment
          ? `, __segment as (${this.getSegmentCTE(
              segment.sql,
              segment.name,
              userId
            )})`
          : ""
      }
      ${
        dimension?.type === "user"
          ? `, __dimension as (${this.getDimensionCTE(
              dimension.dimension,
              userId
            )})`
          : ""
      }
      ${
        activationMetric
          ? `, __activationMetric as (${this.getMetricCTE({
              metric: activationMetric,
              conversionWindowHours: metric.conversionWindowHours,
              userId,
              startDate: metricStart,
              endDate: metricEnd,
            })})
            , __activatedUsers as (${this.getActivatedUsersCTE()})`
          : ""
      }
      , __distinctUsers as (
        -- One row per user/dimension/variation
        SELECT
          e.user_id,
          e.variation,
          ${
            dimension?.type === "user"
              ? "d.value"
              : dimension?.type === "experiment"
              ? "e.dimension"
              : dimension?.type === "date"
              ? this.formatDate(this.dateTrunc("e.actual_start"))
              : activationDimension
              ? this.ifElse(
                  "a.user_id IS NULL",
                  "'Not Activated'",
                  "'Activated'"
                )
              : "'All'"
          } as dimension,
          MIN(${this.ifNullFallback(
            activationMetric ? "a.actual_start" : null,
            "e.actual_start"
          )}) as actual_start,
          MIN(${this.ifNullFallback(
            activationMetric ? "a.session_start" : null,
            "e.session_start"
          )}) as session_start,
          MIN(${this.ifNullFallback(
            activationMetric ? "a.conversion_end" : null,
            "e.conversion_end"
          )}) as conversion_end
        FROM
          __experiment e
          ${segment ? "JOIN __segment s ON (s.user_id = e.user_id)" : ""}
          ${
            dimension?.type === "user"
              ? "JOIN __dimension d ON (d.user_id = e.user_id)"
              : ""
          }
          ${
            activationMetric
              ? `
          ${activationDimension ? "LEFT " : ""}JOIN __activatedUsers a ON (
            a.user_id = e.user_id
          )`
              : ""
          }
        GROUP BY
          variation, dimension, e.user_id
      )
      , __userMetric as (
        -- Add in the aggregate metric value for each user
        SELECT
          d.variation,
          d.dimension,
          ${this.getAggregateMetricSqlValue(metric)} as value
        FROM
          __distinctUsers d
          JOIN __metric m ON (
            m.user_id = d.user_id
          )
          WHERE
            m.actual_start >= d.${
              metric.earlyStart ? "session_start" : "actual_start"
            }
            AND m.actual_start <= d.conversion_end
        GROUP BY
          variation, dimension, d.user_id
      )
      , __overallUsers as (
        -- Number of users in each variation
        SELECT
          variation,
          dimension,
          COUNT(*) as users
        FROM
          __distinctUsers
        GROUP BY
          variation,
          dimension
      )
      , __stats as (    
        -- Sum all user metrics together to get a total per variation/dimension
        SELECT
          variation,
          dimension,
          COUNT(*) as count,
          ${this.avg("value")} as mean,
          ${this.stddev("value")} as stddev
        FROM
          __userMetric
        GROUP BY
          variation,
          dimension
      )
    SELECT
      s.variation,
      s.dimension,
      s.count,
      s.mean,
      s.stddev,
      u.users
    FROM
      __stats s
      JOIN __overallUsers u ON (
        s.variation = u.variation 
        AND s.dimension = u.dimension
      )
    `,
      this.getFormatOptions()
    );
  }
  getExperimentResultsQuery(): string {
    throw new Error("Not implemented");
  }
  async getExperimentResults(): Promise<ExperimentQueryResponses> {
    throw new Error("Not implemented");
  }

  private getMetricCTE({
    metric,
    conversionWindowHours = DEFAULT_CONVERSION_WINDOW_HOURS,
    userId = true,
    startDate,
    endDate,
  }: {
    metric: MetricInterface;
    conversionWindowHours?: number;
    userId?: boolean;
    startDate?: Date;
    endDate?: Date | null;
  }) {
    let userIdCol: string;
    let join = "";
    // Need to use userId, but metric is anonymous only
    if (userId && metric.userIdType === "anonymous") {
      userIdCol = "i.user_id";
      join = this.getIdentifiesJoinSql(
        "m." + this.getAnonymousIdColumn(metric),
        false
      );
    }
    // Need to use anonymousId, but metric is user only
    else if (!userId && metric.userIdType === "user") {
      userIdCol = "i.anonymous_id";
      join = this.getIdentifiesJoinSql(
        "m." + this.getUserIdColumn(metric),
        true
      );
    }
    // Otherwise, can query the metric directly
    else {
      userIdCol =
        "m." +
        (userId
          ? this.getUserIdColumn(metric)
          : this.getAnonymousIdColumn(metric));
    }

    const timestampCol = "m." + this.getTimestampColumn(metric);

    const schema = this.getSchema();

    const where: string[] = [];

    // From old, deprecated query builder UI
    if (metric.conditions?.length) {
      metric.conditions.forEach((c) => {
        where.push(`m.${c.column} ${c.operator} '${c.value}'`);
      });
    }
    // Add a rough date filter to improve query performance
    if (startDate) {
      where.push(`${timestampCol} >= ${this.toTimestamp(startDate)}`);
    }
    if (endDate) {
      where.push(`${timestampCol} <= ${this.toTimestamp(endDate)}`);
    }

    return `-- Metric (${metric.name})
      SELECT
        ${userIdCol} as user_id,
        ${this.getRawMetricSqlValue(metric, "m")} as value,
        ${timestampCol} as actual_start,
        ${this.addHours(timestampCol, conversionWindowHours)} as conversion_end,
        ${this.subtractHalfHour(timestampCol)} as session_start
      FROM
        ${
          metric.sql
            ? `(${metric.sql})`
            : (schema && !metric.table?.match(/\./) ? schema + "." : "") +
              (metric.table || "")
        } m
        ${join}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `;
  }

  // Only include users who entered the experiment before this timestamp
  private getExperimentEndDate(
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    conversionWindowHours: number
  ): Date | null {
    // If we need to wait until users have had a chance to full convert
    if (experiment.skipPartialData) {
      // The last date allowed to give enough time for users to convert
      const conversionWindowEndDate = new Date();
      conversionWindowEndDate.setHours(
        conversionWindowEndDate.getHours() - conversionWindowHours
      );

      // Use the earliest of either the conversion end date or the phase end date
      return new Date(
        Math.min(
          phase?.dateEnded?.getTime() ?? Date.now(),
          conversionWindowEndDate.getTime()
        )
      );
    }
    // If the phase is ended, use that as the end date
    else if (phase.dateEnded) {
      return phase.dateEnded;
    }

    // Otherwise, there is no end date for analysis
    return null;
  }

  private getExperimentCTE({
    experiment,
    phase,
    conversionWindowHours = 0,
    experimentDimension = null,
  }: {
    experiment: ExperimentInterface;
    phase: ExperimentPhase;
    conversionWindowHours: number;
    experimentDimension: string | null;
  }) {
    conversionWindowHours =
      conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS;

    const userIdCol =
      experiment.userIdType === "user" ? "e.user_id" : "e.anonymous_id";

    const endDate = this.getExperimentEndDate(
      experiment,
      phase,
      conversionWindowHours
    );

    return `-- Viewed Experiment
    SELECT
      ${userIdCol} as user_id,
      e.variation_id as variation,
      e.timestamp as actual_start,
      ${experimentDimension ? `e.${experimentDimension} as dimension,` : ""}
      ${this.addHours("e.timestamp", conversionWindowHours)} as conversion_end,
      ${this.subtractHalfHour("e.timestamp")} as session_start
    FROM
        __rawExperiment e
    WHERE
        e.experiment_id = '${experiment.trackingKey}'
        AND e.timestamp >= ${this.toTimestamp(phase.dateStarted)}
        ${endDate ? `AND e.timestamp <= ${this.toTimestamp(endDate)}` : ""}
        ${experiment.queryFilter ? `AND (${experiment.queryFilter})` : ""}
    `;
  }
  private getSegmentCTE(sql: string, name: string, userId: boolean = true) {
    // Need to map user_id to anonymous_id
    if (!userId) {
      return `-- Segment (${name})
      SELECT
        i.anonymous_id as user_id,
        s.date
      FROM
        (${sql}) s
        ${this.getIdentifiesJoinSql("s.user_id", true)}
      `;
    }

    return `-- Segment (${name})
    ${sql}
    `;
  }

  private getDimensionCTE(
    dimension: DimensionInterface,
    userId: boolean = true
  ) {
    // Need to map user_id to anonymous_id
    if (!userId) {
      return `-- Dimension (${dimension.name})
      SELECT
        i.anonymous_id as user_id,
        d.value
      FROM
        (${dimension.sql}) d
        ${this.getIdentifiesJoinSql("d.user_id", true)}
      `;
    }

    return `-- Dimension (${dimension.name})
    ${dimension.sql}
    `;
  }

  private getPageUsersCTE(
    params: MetricValueParams,
    userId: boolean = true,
    conversionWindowHours: number = DEFAULT_CONVERSION_WINDOW_HOURS
  ): string {
    // TODO: use identifies if table is missing the requested userId type
    const userIdCol = userId ? "p.user_id" : "p.anonymous_id";

    return `-- Users visiting specific pages
    SELECT
      ${userIdCol} as user_id,
      MIN(p.timestamp) as actual_start,
      ${this.addHours(
        `MIN(p.timestamp)`,
        conversionWindowHours
      )} as conversion_end,
      ${this.subtractHalfHour(`MIN(p.timestamp)`)} as session_start
    FROM
        __pageviews p
    WHERE
      p.timestamp >= ${this.toTimestamp(this.dateOnly(params.from))}
      AND p.timestamp <= ${this.toTimestamp(this.dateOnly(params.to))}
      ${
        params.urlRegex && params.urlRegex !== ".*"
          ? `AND ${this.regexMatch("p.url", params.urlRegex)}`
          : ""
      }
    GROUP BY
      ${userIdCol}
    `;
  }

  private dateOnly(orig: Date) {
    const date = new Date(orig);

    date.setHours(0);
    date.setMinutes(0);
    date.setSeconds(0);
    date.setMilliseconds(0);

    return date;
  }

  private capValue(cap: number | undefined, value: string) {
    if (!cap) {
      return value;
    }

    return `LEAST(${cap}, ${value})`;
  }

  private getMetricColumn(metric: MetricInterface, alias = "m") {
    if (metric.sql) return alias + ".value";

    if (metric.type === "duration") {
      // Custom SQL column expression
      if (metric.column?.match(/\{alias\}/)) {
        return metric.column.replace(/\{alias\}/g, alias);
      }
    }
    return alias + "." + metric.column;
  }

  private getRawMetricSqlValue(metric: MetricInterface, alias: string = "m") {
    if (metric.type === "binomial") {
      return "1";
    } else if (metric.sql) {
      return alias + ".value";
    } else if (metric.type === "count") {
      return metric.column ? this.getMetricColumn(metric, alias) : "1";
    } else if (metric.type === "duration") {
      return this.getMetricColumn(metric, alias);
    } else if (metric.type === "revenue") {
      return this.getMetricColumn(metric, alias);
    }
    return "1";
  }
  private getAggregateMetricSqlValue(
    metric: MetricInterface,
    col: string = "m.value"
  ) {
    if (metric.type === "count") {
      return this.capValue(
        metric.cap,
        metric.sql
          ? `SUM(${col})`
          : `COUNT(${metric.column ? `DISTINCT ${col}` : "*"})`
      );
    } else if (metric.type === "duration") {
      return this.capValue(
        metric.cap,
        metric.sql ? `SUM(${col})` : `MAX(${col})`
      );
    } else if (metric.type === "revenue") {
      return this.capValue(
        metric.cap,
        metric.sql ? `SUM(${col})` : `MAX(${col})`
      );
    }
    return "1";
  }
  private getUserIdColumn(metric: MetricInterface): string {
    return metric.sql ? "user_id" : metric.userIdColumn || "user_id";
  }
  private getAnonymousIdColumn(metric: MetricInterface): string {
    return metric.sql
      ? "anonymous_id"
      : metric.anonymousIdColumn || "anonymous_id";
  }
  private getTimestampColumn(metric: MetricInterface): string {
    return metric.sql ? "timestamp" : metric.timestampColumn || "received_at";
  }
}
