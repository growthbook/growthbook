import { MetricInterface } from "../../types/metric";
import {
  DataSourceSettings,
  DataSourceProperties,
  ExposureQuery,
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
  Dimension,
} from "../types/Integration";
import { ExperimentPhase, ExperimentInterface } from "../../types/experiment";
import { DimensionInterface } from "../../types/dimension";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";
import { getValidDate } from "../util/dates";
import { SegmentInterface } from "../../types/segment";
import { getBaseIdTypeAndJoins, replaceDateVars, format } from "../util/sql";

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
      exposureQueries: true,
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
  useAliasInGroupBy(): boolean {
    return true;
  }

  private getExposureQuery(
    exposureQueryId: string,
    userIdType?: "anonymous" | "user"
  ): ExposureQuery {
    if (!exposureQueryId) {
      exposureQueryId = userIdType === "user" ? "user_id" : "anonymous_id";
    }

    const queries = this.settings?.queries?.exposure || [];

    const match = queries.find((q) => q.id === exposureQueryId);

    if (!match) {
      throw new Error(
        "Unknown experiment assignment table - " + exposureQueryId
      );
    }

    return match;
  }

  getPastExperimentQuery(params: PastExperimentParams) {
    const minLength = params.minLength ?? 6;

    const now = new Date();

    // TODO: for past experiments, UNION all exposure queries together
    const experimentQueries = (
      this.settings.queries?.exposure || []
    ).map(({ id }) => this.getExposureQuery(id));

    return format(
      `-- Past Experiments
    WITH
      ${experimentQueries
        .map((q, i) => {
          return `
        __exposures${i} as (
          SELECT 
            ${this.castToString(`'${q.id}'`)} as exposure_query, 
            experiment_id,
            variation_id,
            ${this.dateTrunc(this.castUserDateCol("timestamp"))} as date,
            count(distinct ${q.userIdType}) as users
          FROM
            (
              ${replaceDateVars(q.query, params.from)}
            ) e${i}
          WHERE
            ${this.castUserDateCol("timestamp")} > ${this.toTimestamp(
            params.from
          )}
          GROUP BY
            experiment_id,
            variation_id,
            ${this.dateTrunc(this.castUserDateCol("timestamp"))}
        ),`;
        })
        .join("\n")}
      __experiments as (
        ${experimentQueries
          .map((q, i) => `SELECT * FROM __exposures${i}`)
          .join("\nUNION ALL\n")}
      ),
      __userThresholds as (
        SELECT
          exposure_query,
          experiment_id,
          variation_id,
          -- It's common for a small number of tracking events to continue coming in
          -- long after an experiment ends, so limit to days with enough traffic
          max(users)*0.05 as threshold
        FROM
          __experiments
        WHERE
          -- Skip days where a variation got 5 or fewer visitors since it's probably not real traffic
          users > 5
        GROUP BY
          exposure_query, experiment_id, variation_id
      ),
      __variations as (
        SELECT
          d.exposure_query,
          d.experiment_id,
          d.variation_id,
          MIN(d.date) as start_date,
          MAX(d.date) as end_date,
          SUM(d.users) as users
        FROM
          __experiments d
          JOIN __userThresholds u ON (
            d.exposure_query = u.exposure_query
            AND d.experiment_id = u.experiment_id
            AND d.variation_id = u.variation_id
          )
        WHERE
          d.users > u.threshold
        GROUP BY
          d.exposure_query, d.experiment_id, d.variation_id
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
      experiment_id ASC, variation_id ASC`
    );
  }
  async runPastExperimentQuery(query: string): Promise<PastExperimentResponse> {
    const rows = await this.runQuery(query);

    return rows.map((row) => {
      return {
        exposure_query: row.exposure_query,
        experiment_id: row.experiment_id,
        variation_id: row.variation_id ?? "",
        users: parseInt(row.users) || 0,
        end_date: this.convertDate(row.end_date).toISOString(),
        start_date: this.convertDate(row.start_date).toISOString(),
      };
    });
  }

  getMetricValueQuery(params: MetricValueParams): string {
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentifiesCTE(
      [
        params.metric.userIdTypes || [],
        params.segment ? [params.segment.userIdType || "user_id"] : [],
      ],
      params.from,
      params.to
    );

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

    const aggregate = this.getAggregateMetricColumn(params.metric, "m");

    return format(
      `-- ${params.name} - ${params.metric.name} Metric
      WITH
        ${idJoinSQL}
        ${
          params.segment
            ? `segment as (${this.getSegmentCTE(
                params.segment,
                baseIdType,
                idJoinMap
              )}),`
            : ""
        }
        __metric as (${this.getMetricCTE({
          metric: params.metric,
          baseIdType,
          idJoinMap,
          startDate: metricStart,
          endDate: metricEnd,
        })})
        , __userMetric as (
          -- Add in the aggregate metric value for each user
          SELECT
            ${aggregate} as value
          FROM
            __metric m
            ${
              params.segment
                ? `JOIN segment s ON (s.${baseIdType} = m.${baseIdType}) WHERE s.date <= m.conversion_start`
                : ""
            }
          GROUP BY
            m.${baseIdType}
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
              ${aggregate} as value
            FROM
              __metric m
              ${
                params.segment
                  ? `JOIN segment s ON (s.${baseIdType} = m.${baseIdType}) WHERE s.date <= m.conversion_start`
                  : ""
              }
            GROUP BY
              ${this.dateTrunc("m.conversion_start")},
              m.${baseIdType}
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
      `
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

  private getIdentifiesCTE(
    objects: string[][],
    from: Date,
    to?: Date,
    forcedBaseIdType?: string
  ) {
    const { baseIdType, joinsRequired } = getBaseIdTypeAndJoins(
      objects,
      forcedBaseIdType
    );

    // Joins for when an object doesn't support the baseIdType
    const joins: string[] = [];
    const idJoinMap: Record<string, string> = {};

    // Generate table names and SQL for each of the required joins
    joinsRequired.forEach((idType, i) => {
      const table = `__identities${i}`;
      idJoinMap[idType] = table;
      joins.push(
        `${table} as (
        ${this.getIdentitiesQuery(this.settings, baseIdType, idType, from, to)}
      ),`
      );
    });

    return {
      baseIdType,
      idJoinSQL: joins.join("\n"),
      idJoinMap,
    };
  }

  private getActivatedUsersCTE(
    baseIdType: string,
    metrics: MetricInterface[],
    tablePrefix: string = "__activationMetric",
    initialTable: string = "__experiment"
  ) {
    // Note: the conversion_start/end alias below is needed for clickhouse
    return `
      SELECT
        initial.${baseIdType},
        t${metrics.length - 1}.conversion_start as conversion_start,
        t${metrics.length - 1}.conversion_end as conversion_end
      FROM
        ${initialTable} initial
        ${metrics
          .map((m, i) => {
            const prevAlias = i ? `t${i - 1}` : "initial";
            const alias = `t${i}`;
            return `JOIN ${tablePrefix}${i} ${alias} ON (
            ${alias}.${baseIdType} = ${prevAlias}.${baseIdType}
          )`;
          })
          .join("\n")}
      WHERE
        ${metrics
          .map((m, i) => {
            const prevAlias = i ? `t${i - 1}` : "initial";
            const alias = `t${i}`;
            return `
              ${alias}.conversion_start >= ${prevAlias}.conversion_start
              AND ${alias}.conversion_start <= ${prevAlias}.conversion_end`;
          })
          .join("\n AND ")}`;
  }

  private ifNullFallback(nullable: string | null, fallback: string) {
    if (!nullable) return fallback;
    return `COALESCE(${nullable}, ${fallback})`;
  }

  private getDimensionColumn(baseIdType: string, dimension: Dimension | null) {
    if (!dimension) {
      return this.castToString("'All'");
    } else if (dimension.type === "activation") {
      return this.ifElse(
        `a.${baseIdType} IS NULL`,
        "'Not Activated'",
        "'Activated'"
      );
    } else if (dimension.type === "user") {
      return "d.value";
    } else if (dimension.type === "date") {
      return this.formatDate(this.dateTrunc("e.conversion_start"));
    } else if (dimension.type === "experiment") {
      return "e.dimension";
    }

    throw new Error("Unknown dimension type: " + (dimension as Dimension).type);
  }

  private getMetricConversionBase(
    col: string,
    denominatorMetrics: boolean,
    activationMetrics: boolean
  ): string {
    if (denominatorMetrics) {
      return `du.${col}`;
    }
    if (activationMetrics) {
      return `a.${col}`;
    }
    return `e.${col}`;
  }

  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string {
    const {
      metric,
      experiment,
      phase,
      activationMetrics,
      denominatorMetrics,
      segment,
    } = params;

    let dimension = params.dimension;
    if (dimension?.type === "activation" && !activationMetrics.length) {
      dimension = null;
    }

    const exposureQuery = this.getExposureQuery(
      experiment.exposureQueryId || "",
      experiment.userIdType
    );

    // Get rough date filter for metrics to improve performance
    const metricStart = new Date(phase.dateStarted);
    const metricEnd = phase.dateEnded ? new Date(phase.dateEnded) : null;
    if (metricEnd) {
      let additionalHours = 0;
      activationMetrics.concat(denominatorMetrics).forEach((m) => {
        additionalHours +=
          m.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS;
      });

      metricEnd.setHours(
        metricEnd.getHours() +
          // Add conversion window so metric has time to convert after experiment ends
          (metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS) +
          // If using activation or denominator metrics, also need to allow for that conversion time
          additionalHours
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

    // Get any required identity join queries
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentifiesCTE(
      [
        [exposureQuery.userIdType],
        dimension?.type === "user"
          ? [dimension.dimension.userIdType || "user_id"]
          : [],
        segment ? [segment.userIdType || "user_id"] : [],
        metric.userIdTypes || [],
        ...activationMetrics.map((m) => m.userIdTypes || []),
        ...denominatorMetrics.map((m) => m.userIdTypes || []),
      ],
      phase.dateStarted,
      phase.dateEnded,
      exposureQuery.userIdType
    );

    const removeMultipleExposures = !!experiment.removeMultipleExposures;

    const aggregate = this.getAggregateMetricColumn(metric, "m");

    const dimensionCol = this.getDimensionColumn(baseIdType, dimension);
    const dimensionGroupBy = this.useAliasInGroupBy()
      ? "dimension"
      : dimensionCol;

    const intialMetric =
      activationMetrics.length > 0
        ? activationMetrics[0]
        : denominatorMetrics.length > 0
        ? denominatorMetrics[0]
        : metric;

    return format(
      `-- ${metric.name} (${metric.type})
    WITH
      ${idJoinSQL}
      __rawExperiment as (
        ${replaceDateVars(
          exposureQuery.query,
          phase.dateStarted,
          phase.dateEnded
        )}
      ),
      __experiment as (${this.getExperimentCTE({
        experiment,
        phase,
        baseIdType,
        conversionWindowHours: intialMetric.conversionWindowHours || 0,
        conversionDelayHours: intialMetric.conversionDelayHours || 0,
        experimentDimension:
          dimension?.type === "experiment" ? dimension.id : null,
      })})
      , __metric as (${this.getMetricCTE({
        metric,
        baseIdType,
        idJoinMap,
        startDate: metricStart,
        endDate: metricEnd,
      })})
      ${
        segment
          ? `, __segment as (${this.getSegmentCTE(
              segment,
              baseIdType,
              idJoinMap
            )})`
          : ""
      }
      ${
        dimension?.type === "user"
          ? `, __dimension as (${this.getDimensionCTE(
              dimension.dimension,
              baseIdType,
              idJoinMap
            )})`
          : ""
      }
      ${activationMetrics
        .map((m, i) => {
          const nextMetric =
            activationMetrics[i + 1] || denominatorMetrics[0] || metric;
          return `, __activationMetric${i} as (${this.getMetricCTE({
            metric: m,
            conversionWindowHours:
              nextMetric.conversionWindowHours ||
              DEFAULT_CONVERSION_WINDOW_HOURS,
            conversionDelayHours: nextMetric.conversionDelayHours,
            baseIdType,
            idJoinMap,
            startDate: metricStart,
            endDate: metricEnd,
          })})`;
        })
        .join("\n")}
      ${
        activationMetrics.length > 0
          ? `, __activatedUsers as (${this.getActivatedUsersCTE(
              baseIdType,
              activationMetrics
            )})`
          : ""
      }
      ${denominatorMetrics
        .map((m, i) => {
          const nextMetric = denominatorMetrics[i + 1] || metric;
          return `, __denominator${i} as (${this.getMetricCTE({
            metric: m,
            conversionWindowHours:
              nextMetric.conversionWindowHours ||
              DEFAULT_CONVERSION_WINDOW_HOURS,
            conversionDelayHours: nextMetric.conversionDelayHours,
            baseIdType,
            idJoinMap,
            startDate: metricStart,
            endDate: metricEnd,
          })})`;
        })
        .join("\n")}
      ${
        denominatorMetrics.length > 0
          ? `, __denominatorUsers as (${this.getActivatedUsersCTE(
              baseIdType,
              denominatorMetrics,
              "__denominator",
              dimension?.type !== "activation" && activationMetrics.length > 0
                ? "__activatedUsers"
                : "__experiment"
            )})`
          : ""
      }
      , __distinctUsers as (
        -- One row per user/dimension${
          removeMultipleExposures ? "" : "/variation"
        }
        SELECT
          e.${baseIdType},
          ${dimensionCol} as dimension,
          ${
            removeMultipleExposures
              ? this.ifElse(
                  "count(distinct e.variation) > 1",
                  "'__multiple__'",
                  "max(e.variation)"
                )
              : "e.variation"
          } as variation,
          MIN(${this.getMetricConversionBase(
            "conversion_start",
            denominatorMetrics.length > 0,
            activationMetrics.length > 0 && dimension?.type !== "activation"
          )}) as conversion_start,
          MIN(${this.getMetricConversionBase(
            "conversion_end",
            denominatorMetrics.length > 0,
            activationMetrics.length > 0 && dimension?.type !== "activation"
          )}) as conversion_end
        FROM
          __experiment e
          ${
            segment
              ? `JOIN __segment s ON (s.${baseIdType} = e.${baseIdType})`
              : ""
          }
          ${
            dimension?.type === "user"
              ? `JOIN __dimension d ON (d.${baseIdType} = e.${baseIdType})`
              : ""
          }
          ${
            activationMetrics.length > 0
              ? `
          ${
            dimension?.type === "activation" ? "LEFT " : ""
          }JOIN __activatedUsers a ON (
            a.${baseIdType} = e.${baseIdType}
          )`
              : ""
          }
          ${
            denominatorMetrics.length > 0
              ? `JOIN __denominatorUsers du ON (du.${baseIdType} = e.${baseIdType})`
              : ""
          }
        ${segment ? `WHERE s.date <= e.conversion_start` : ""}
        GROUP BY
        ${dimension ? dimensionGroupBy + ", " : ""}e.${baseIdType}${
        removeMultipleExposures ? "" : ", e.variation"
      }
      )
      , __userMetric as (
        -- Add in the aggregate metric value for each user
        SELECT
          d.variation,
          d.dimension,
          ${aggregate} as value
        FROM
          __distinctUsers d
          JOIN __metric m ON (
            m.${baseIdType} = d.${baseIdType}
          )
          WHERE
            m.conversion_start >= d.conversion_start
            AND m.conversion_start <= d.conversion_end
        GROUP BY
          variation, dimension, d.${baseIdType}
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
    `
    );
  }
  getExperimentResultsQuery(): string {
    throw new Error("Not implemented");
  }
  async getExperimentResults(): Promise<ExperimentQueryResponses> {
    throw new Error("Not implemented");
  }

  private getMetricQueryFormat(metric: MetricInterface) {
    return metric.queryFormat || (metric.sql ? "sql" : "builder");
  }

  private getMetricCTE({
    metric,
    conversionWindowHours = 0,
    conversionDelayHours = 0,
    baseIdType,
    idJoinMap,
    startDate,
    endDate,
  }: {
    metric: MetricInterface;
    conversionWindowHours?: number;
    conversionDelayHours?: number;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    startDate: Date;
    endDate: Date | null;
  }) {
    const queryFormat = this.getMetricQueryFormat(metric);

    const cols = this.getMetricColumns(metric, "m");

    // Determine the identifier column to select from
    let userIdCol = cols.userIds[baseIdType] || "user_id";
    let join = "";
    if (metric.userIdTypes?.includes(baseIdType)) {
      userIdCol = baseIdType;
    } else if (metric.userIdTypes) {
      for (let i = 0; i < metric.userIdTypes.length; i++) {
        const userIdType = metric.userIdTypes[i];
        if (userIdType in idJoinMap) {
          userIdCol = `i.${baseIdType}`;
          join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = m.${userIdType})`;
          break;
        }
      }
    }

    const timestampCol = this.castUserDateCol(cols.timestamp);

    const schema = this.getSchema();

    const where: string[] = [];

    // From old, deprecated query builder UI
    if (queryFormat === "builder" && metric.conditions?.length) {
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
        ${userIdCol} as ${baseIdType},
        ${cols.value} as value,
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
          queryFormat === "sql"
            ? `(
              ${replaceDateVars(
                metric.sql || "",
                startDate,
                endDate || undefined
              )}
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
    baseIdType,
    phase,
    conversionWindowHours = 0,
    conversionDelayHours = 0,
    experimentDimension = null,
  }: {
    experiment: ExperimentInterface;
    baseIdType: string;
    phase: ExperimentPhase;
    conversionWindowHours: number;
    conversionDelayHours: number;
    experimentDimension: string | null;
  }) {
    conversionWindowHours =
      conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS;

    const endDate = this.getExperimentEndDate(
      experiment,
      phase,
      conversionWindowHours + conversionDelayHours
    );

    const timestampColumn = this.castUserDateCol("e.timestamp");

    return `-- Viewed Experiment
    SELECT
      e.${baseIdType} as ${baseIdType},
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
  private getSegmentCTE(
    segment: SegmentInterface,
    baseIdType: string,
    idJoinMap: Record<string, string>
  ) {
    const dateCol = this.castUserDateCol("s.date");

    const userIdType = segment.userIdType || "user_id";

    // Need to use an identity join table
    if (userIdType !== baseIdType) {
      return `-- Segment (${segment.name})
      SELECT
        i.${baseIdType},
        ${dateCol} as date
      FROM
        (
          ${segment.sql}
        ) s
        JOIN ${idJoinMap[userIdType]} i ON ( i.${userIdType} = s.${userIdType} )
      `;
    }

    if (dateCol !== "s.date") {
      return `-- Segment (${segment.name})
      SELECT
        s.${userIdType},
        ${dateCol} as date
      FROM
        (
          ${segment.sql}
        ) s`;
    }

    return `-- Segment (${segment.name})
    ${segment.sql}
    `;
  }

  private getDimensionCTE(
    dimension: DimensionInterface,
    baseIdType: string,
    idJoinMap: Record<string, string>
  ) {
    const userIdType = dimension.userIdType || "user_id";

    // Need to use an identity join table
    if (userIdType !== baseIdType) {
      return `-- Dimension (${dimension.name})
      SELECT
        i.${baseIdType},
        d.value
      FROM
        (
          ${dimension.sql}
        ) d
        JOIN ${idJoinMap[userIdType]} i ON ( i.${userIdType} = d.${userIdType} )
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

  private getAggregateMetricColumn(metric: MetricInterface, alias = "m") {
    if (metric.type === "binomial") {
      return "1";
    }

    const queryFormat = this.getMetricQueryFormat(metric);
    if (queryFormat === "sql") {
      return this.capValue(
        metric.cap,
        metric.aggregation || `SUM(${alias}.value)`
      );
    }

    return this.capValue(
      metric.cap,
      metric.type === "count"
        ? `COUNT(${metric.column ? `DISTINCT ${alias}.value` : "*"})`
        : `MAX(${alias}.value)`
    );
  }

  private getMetricColumns(metric: MetricInterface, alias = "m") {
    const queryFormat = this.getMetricQueryFormat(metric);

    // Directly inputting SQL (preferred)
    if (queryFormat === "sql") {
      const userIds: Record<string, string> = {};
      metric.userIdTypes?.forEach((userIdType) => {
        userIds[userIdType] = `${alias}.${userIdType}`;
      });
      return {
        userIds: userIds,
        timestamp: `${alias}.timestamp`,
        value: metric.type === "binomial" ? "1" : `${alias}.value`,
      };
    }

    // Using the query builder (legacy)
    let valueCol = metric.column || "value";
    if (metric.type === "duration" && valueCol.match(/\{alias\}/)) {
      valueCol = valueCol.replace(/\{alias\}/g, alias);
    } else {
      valueCol = alias + "." + valueCol;
    }
    const value = metric.type !== "binomial" && metric.column ? valueCol : "1";

    const userIds: Record<string, string> = {};
    metric.userIdTypes?.forEach((userIdType) => {
      userIds[userIdType] = `${alias}.${
        metric.userIdColumns?.[userIdType] || userIdType
      }`;
    });

    return {
      userIds,
      timestamp: `${alias}.${metric.timestampColumn || "received_at"}`,
      value,
    };
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

    throw new Error(`Missing identifier join table for '${id1}' and '${id2}'.`);
  }
}
