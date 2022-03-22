import { MetricInterface } from "../../types/metric";
import {
  DataSourceSettings,
  DataSourceProperties,
} from "../../types/datasource";
import {
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
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";
import { getValidDate } from "../util/dates";

// Replace vars in SQL queries (e.g. '{{startDate}}')
export function replaceDateVars(sql: string, startDate: Date, endDate?: Date) {
  // If there's no end date, use a near future date by default
  // We want to use at least 24 hours in the future in case of timezone issues
  // Set hours, minutes, seconds, ms to 0 so SQL can be more easily cached
  if (!endDate) {
    const now = new Date();
    endDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 2,
      0,
      0,
      0,
      0
    );
  }

  const replacements: Record<string, string> = {
    startDate: startDate.toISOString().substr(0, 19).replace("T", " "),
    startYear: startDate.toISOString().substr(0, 4),
    startMonth: startDate.toISOString().substr(5, 2),
    startDay: startDate.toISOString().substr(8, 2),
    endDate: endDate.toISOString().substr(0, 19).replace("T", " "),
    endYear: endDate.toISOString().substr(0, 4),
    endMonth: endDate.toISOString().substr(5, 2),
    endDay: endDate.toISOString().substr(8, 2),
  };

  Object.keys(replacements).forEach((key) => {
    const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    sql = sql.replace(re, replacements[key]);
  });

  return sql;
}

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
      pastExperiments: true,
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
    if (!hours) return col;
    let unit: "hour" | "minute" = "hour";
    const sign = hours > 0 ? "+" : "-";
    hours = Math.abs(hours);

    const roundedHours = Math.round(hours);
    const roundedMinutes = Math.round(hours * 60);

    let amount = roundedHours;

    // If not within a few minutes of an even hour, go with minutes as the unit instead
    if (Math.round(roundedMinutes / 15) % 4 > 0) {
      unit = "minute";
      amount = roundedMinutes;
    }

    if (amount === 0) {
      return col;
    }

    return this.addTime(col, unit, sign, amount);
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `${col} ${sign} INTERVAL '${amount} ${unit}s'`;
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
  castToString(col: string): string {
    return `cast(${col} as varchar)`;
  }
  castUserDateCol(column: string): string {
    return column;
  }

  getPastExperimentQuery(params: PastExperimentParams) {
    const minLength = params.minLength ?? 6;

    const now = new Date();

    return format(
      `-- Past Experiments
    WITH
      __experiments as (
        ${replaceDateVars(
          getExperimentQuery(this.settings, this.getSchema()),
          params.from
        )}
      ),
      __experimentDates as (
        SELECT
          experiment_id,
          variation_id,
          ${this.dateTrunc(this.castUserDateCol("timestamp"))} as date,
          count(distinct anonymous_id) as users
        FROM
          __experiments
        WHERE
          ${this.castUserDateCol("timestamp")} > ${this.toTimestamp(
        params.from
      )}
        GROUP BY
          experiment_id,
          variation_id,
          ${this.dateTrunc(this.castUserDateCol("timestamp"))}
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
      -- Experiment was started recently
      ${this.dateDiff("start_date", this.toTimestamp(now))} < ${minLength} OR
      -- OR it ran for long enough and had enough users
      (
        ${this.dateDiff("start_date", "end_date")} >= ${minLength} AND
        users > 100 AND
        -- Skip experiments at start of date range since it's likely missing data
        ${this.dateDiff(this.toTimestamp(params.from), "start_date")} > 2
      )
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
    const metricEnd = new Date(params.to);
    metricEnd.setHours(
      metricEnd.getHours() +
        (params.metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS)
    );
    if (params.metric.conversionDelayHours) {
      metricStart.setHours(
        metricStart.getHours() + params.metric.conversionDelayHours
      );
      metricEnd.setHours(
        metricEnd.getHours() + params.metric.conversionDelayHours
      );
    }

    return format(
      `-- ${params.name} - ${params.metric.name} Metric
      WITH
        ${this.getIdentifiesCTE(userId, {
          from: params.from,
          to: params.to,
          segment: !!params.segmentQuery,
          metrics: [params.metric],
        })}
        ${
          params.segmentQuery
            ? `segment as (${this.getSegmentCTE(
                params.segmentQuery,
                params.segmentName || "",
                userId
              )}),`
            : ""
        }
        __metric as (${this.getMetricCTE({
          metric: params.metric,
          userId,
          startDate: metricStart,
          endDate: metricEnd,
        })})
        , __userMetric as (
          -- Add in the aggregate metric value for each user
          SELECT
            ${this.getAggregateMetricSqlValue(params.metric)} as value
          FROM
            __metric m
            ${
              params.segmentQuery
                ? "JOIN segment s ON (s.user_id = m.user_id) WHERE s.date <= m.conversion_start"
                : ""
            }
          GROUP BY
            m.user_id
        )
        , __overall as (
          SELECT
            COUNT(*) as count,
            ${this.avg("value")} as mean,
            ${this.stddev("value")} as stddev
          from
            __userMetric
        )
        ${
          params.includeByDate
            ? `
          , __userMetricDates as (
            -- Add in the aggregate metric value for each user
            SELECT
              ${this.dateTrunc("m.conversion_start")} as date,
              ${this.getAggregateMetricSqlValue(params.metric)} as value
            FROM
              __metric m
              ${
                params.segmentQuery
                  ? "JOIN segment s ON (s.user_id = m.user_id) WHERE s.date <= m.conversion_start"
                  : ""
              }
            GROUP BY
              ${this.dateTrunc("m.conversion_start")},
              m.user_id
          )
          , __byDateOverall as (
            SELECT
              date,
              COUNT(*) as count,
              ${this.avg("value")} as mean,
              ${this.stddev("value")} as stddev
            FROM
              __userMetricDates d
            GROUP BY
              date
          )`
            : ""
        }
      SELECT
        ${params.includeByDate ? "null as date," : ""}
        o.*
      FROM
        __overall o
      ${
        params.includeByDate
          ? `
        UNION ALL SELECT
          o.*
        FROM
          __byDateOverall o
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
      const { date, count, mean, stddev } = row;

      const ret: MetricValueQueryResponseRow = {
        date: date ? this.convertDate(date).toISOString() : "",
        count: parseFloat(count) || 0,
        mean: parseFloat(mean) || 0,
        stddev: parseFloat(stddev) || 0,
      };

      return ret;
    });
  }

  getFormatOptions(): FormatOptions {
    return {
      language: "redshift",
    };
  }

  private getUserIdTypes(
    userId: boolean,
    metrics: (MetricInterface | null)[],
    dimension: boolean,
    segment: boolean
  ) {
    const types = new Set<string>();

    types.add(userId ? "user_id" : "anonymous_id");

    metrics.forEach((m) => {
      if (!m) return;
      if (userId && m.userIdType === "anonymous") {
        types.add("anonymous_id");
      }
      if (!userId && m.userIdType === "user") {
        types.add("user_id");
      }
    });

    if (segment || dimension) {
      types.add("user_id");
    }

    return Array.from(types);
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
    const idTypes = this.getUserIdTypes(
      userId,
      metrics || [],
      !!dimension,
      !!segment
    );

    // Don't need a join table, everything uses the same type of id
    if (idTypes.length < 2) {
      return "";
    }

    // TODO: handle case when there are more than 2 required id types
    return `__identities as (
      ${this.getIdentitiesQuery(
        this.settings,
        idTypes[0],
        idTypes[1],
        from,
        to
      )}
    ),`;
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
        a.conversion_start,
        a.conversion_end
      FROM
        __experiment e
        JOIN __activationMetric a ON (
          a.user_id = e.user_id
        )
      WHERE
        a.conversion_start >= e.conversion_start
        AND a.conversion_start <= e.conversion_end`;
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

    // Add conversion delay
    if (metric.conversionDelayHours) {
      metricStart.setHours(
        metricStart.getHours() + metric.conversionDelayHours
      );
      if (metricEnd) {
        metricEnd.setHours(metricEnd.getHours() + metric.conversionDelayHours);
      }
    }

    const removeMultipleExposures = !!experiment.removeMultipleExposures;

    return format(
      `-- ${metric.name} (${metric.type})
    WITH
      ${this.getIdentifiesCTE(userId, {
        from: phase.dateStarted,
        to: phase.dateEnded,
        dimension: dimension?.type === "user",
        segment: !!segment,
        metrics: [metric, activationMetric],
      })}
      __rawExperiment as (
        ${replaceDateVars(
          getExperimentQuery(this.settings, this.getSchema()),
          phase.dateStarted,
          phase.dateEnded
        )}
      ),
      __experiment as (${this.getExperimentCTE({
        experiment,
        phase,
        conversionWindowHours:
          (activationMetric
            ? activationMetric.conversionWindowHours
            : metric.conversionWindowHours) || 0,
        conversionDelayHours:
          (activationMetric
            ? activationMetric.conversionDelayHours
            : metric.conversionDelayHours) || 0,
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
              conversionWindowHours:
                metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS,
              conversionDelayHours: metric.conversionDelayHours,
              userId,
              startDate: metricStart,
              endDate: metricEnd,
            })})
            , __activatedUsers as (${this.getActivatedUsersCTE()})`
          : ""
      }
      , __distinctUsers as (
        -- One row per user/dimension${
          removeMultipleExposures ? "" : "/variation"
        }
        SELECT
          e.user_id,
          ${
            dimension?.type === "user"
              ? "d.value"
              : dimension?.type === "experiment"
              ? "e.dimension"
              : dimension?.type === "date"
              ? this.formatDate(this.dateTrunc("e.conversion_start"))
              : activationDimension
              ? this.ifElse(
                  "a.user_id IS NULL",
                  "'Not Activated'",
                  "'Activated'"
                )
              : "'All'"
          } as dimension,
          ${
            removeMultipleExposures
              ? this.ifElse(
                  "count(distinct e.variation) > 1",
                  "'__multiple__'",
                  "max(e.variation)"
                )
              : "e.variation"
          } as variation,
          MIN(${this.ifNullFallback(
            activationMetric ? "a.conversion_start" : null,
            "e.conversion_start"
          )}) as conversion_start,
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
        ${segment ? `WHERE s.date <= e.conversion_start` : ""}
        GROUP BY
          dimension, e.user_id${removeMultipleExposures ? "" : ", e.variation"}
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
            m.conversion_start >= d.conversion_start
            AND m.conversion_start <= d.conversion_end
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
    conversionWindowHours = 0,
    conversionDelayHours = 0,
    userId = true,
    startDate,
    endDate,
  }: {
    metric: MetricInterface;
    conversionWindowHours?: number;
    conversionDelayHours?: number;
    userId?: boolean;
    startDate: Date;
    endDate: Date | null;
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

    const timestampCol = this.castUserDateCol(
      "m." + this.getTimestampColumn(metric)
    );

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
        ${this.addHours(
          timestampCol,
          conversionDelayHours
        )} as conversion_start,
        ${this.addHours(
          timestampCol,
          conversionDelayHours + conversionWindowHours
        )} as conversion_end
      FROM
        ${
          metric.sql
            ? `(
              ${replaceDateVars(metric.sql, startDate, endDate || undefined)}
              )`
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
    conversionDelayHours = 0,
    experimentDimension = null,
  }: {
    experiment: ExperimentInterface;
    phase: ExperimentPhase;
    conversionWindowHours: number;
    conversionDelayHours: number;
    experimentDimension: string | null;
  }) {
    conversionWindowHours =
      conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS;

    const userIdCol =
      experiment.userIdType === "user" ? "e.user_id" : "e.anonymous_id";

    const endDate = this.getExperimentEndDate(
      experiment,
      phase,
      conversionWindowHours + conversionDelayHours
    );

    const timestampColumn = this.castUserDateCol("e.timestamp");

    return `-- Viewed Experiment
    SELECT
      ${userIdCol} as user_id,
      ${this.castToString("e.variation_id")} as variation,
      ${this.addHours(
        timestampColumn,
        conversionDelayHours
      )} as conversion_start,
      ${experimentDimension ? `e.${experimentDimension} as dimension,` : ""}
      ${this.addHours(
        timestampColumn,
        conversionDelayHours + conversionWindowHours
      )} as conversion_end
    FROM
        __rawExperiment e
    WHERE
        e.experiment_id = '${experiment.trackingKey}'
        AND ${timestampColumn} >= ${this.toTimestamp(phase.dateStarted)}
        ${
          endDate
            ? `AND ${timestampColumn} <= ${this.toTimestamp(endDate)}`
            : ""
        }
        ${experiment.queryFilter ? `AND (\n${experiment.queryFilter}\n)` : ""}
    `;
  }
  private getSegmentCTE(sql: string, name: string, userId: boolean = true) {
    const dateCol = this.castUserDateCol("s.date");

    // Need to map user_id to anonymous_id
    if (!userId) {
      return `-- Segment (${name})
      SELECT
        i.anonymous_id as user_id,
        ${dateCol} as date
      FROM
        (
          ${sql}
        ) s
        ${this.getIdentifiesJoinSql("s.user_id", true)}
      `;
    }

    if (dateCol !== "s.date") {
      return `-- Segment (${name})
      SELECT
        s.user_id,
        ${dateCol} as date
      FROM
        (
          ${sql}
        ) s`;
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
        (
          ${dimension.sql}
        ) d
        ${this.getIdentifiesJoinSql("d.user_id", true)}
      `;
    }

    return `-- Dimension (${dimension.name})
    ${dimension.sql}
    `;
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
  private getAggregateMetricSqlValue(metric: MetricInterface) {
    // For binomial metrics, a user having at least 1 row means they converted
    // No need for aggregations
    if (metric.type === "binomial") {
      return "1";
    }

    // Custom aggregation
    if (metric.aggregation) {
      return this.capValue(metric.cap, metric.aggregation);
    }

    if (metric.type === "count") {
      return this.capValue(
        metric.cap,
        metric.sql
          ? `SUM(value)`
          : `COUNT(${metric.column ? `DISTINCT value` : "*"})`
      );
    } else if (metric.type === "duration") {
      return this.capValue(
        metric.cap,
        metric.sql ? `SUM(value)` : `MAX(value)`
      );
    } else if (metric.type === "revenue") {
      return this.capValue(
        metric.cap,
        metric.sql ? `SUM(value)` : `MAX(value)`
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

  private getIdentitiesQuery(
    settings: DataSourceSettings,
    id1: string,
    id2: string,
    from: Date,
    to: Date | undefined
  ) {
    if (settings?.queries?.identityJoins) {
      for (let i = 0; i < settings.queries.identityJoins.length; i++) {
        const join = settings?.queries?.identityJoins[i];
        if (
          join.query.length > 6 &&
          join.ids.includes(id1) &&
          join.ids.includes(id2)
        ) {
          return `
          SELECT
            ${id1},
            ${id2}
          FROM
            (
              ${replaceDateVars(join.query, from, to)}
            ) i
          GROUP BY
            ${id1}, ${id2}
          `;
        }
      }
    }

    if (settings?.queries?.pageviewsQuery) {
      const timestampColumn = this.castUserDateCol("i.timestamp");

      if (
        ["user_id", "anonymous_id"].includes(id1) &&
        ["user_id", "anonymous_id"].includes(id2)
      ) {
        return `
        SELECT
          user_id,
          anonymous_id
        FROM
          (${replaceDateVars(settings.queries.pageviewsQuery, from, to)}) i
        WHERE
          ${timestampColumn} >= ${this.toTimestamp(from)}
          ${to ? `AND ${timestampColumn} <= ${this.toTimestamp(to)}` : ""}
        GROUP BY
          user_id, anonymous_id
        `;
      }
    }

    return `
    -- ERROR: Missing User Id Join Table!
    SELECT '' as ${id1}, '' as ${id2}`;
  }
}
