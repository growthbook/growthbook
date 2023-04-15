import cloneDeep from "lodash/cloneDeep";
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
  TestQueryResult,
  MetricAggregationType,
} from "../types/Integration";
import { ExperimentPhase, ExperimentInterface } from "../../types/experiment";
import { DimensionInterface } from "../../types/dimension";
import {
  DEFAULT_CONVERSION_WINDOW_HOURS,
  IMPORT_LIMIT_DAYS,
} from "../util/secrets";
import { getValidDate } from "../util/dates";
import { SegmentInterface } from "../../types/segment";
import {
  getBaseIdTypeAndJoins,
  replaceSQLVars,
  format,
  FormatDialect,
} from "../util/sql";
import { MetricRegressionAdjustmentStatus } from "../../types/report";

export default abstract class SqlIntegration
  implements SourceIntegrationInterface {
  settings: DataSourceSettings;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  datasource: string;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  organization: string;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  decryptionError: boolean;
  // eslint-disable-next-line
  params: any;
  abstract setParams(encryptedParams: string): void;
  // eslint-disable-next-line
  abstract runQuery(sql: string): Promise<any[]>;
  abstract getSensitiveParamKeys(): string[];

  constructor(encryptedParams: string, settings: DataSourceSettings) {
    try {
      this.setParams(encryptedParams);
    } catch (e) {
      this.params = {};
      this.decryptionError = true;
    }
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
      supportsInformationSchema: false,
    };
  }

  async testConnection(): Promise<boolean> {
    await this.runQuery("select 1");
    return true;
  }

  getSchema(): string {
    return "";
  }
  getFormatDialect(): FormatDialect {
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
    return `AVG(${this.ensureFloat(col)})`;
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
  ensureFloat(col: string): string {
    return col;
  }
  castUserDateCol(column: string): string {
    return column;
  }
  useAliasInGroupBy(): boolean {
    return true;
  }
  formatDateTimeString(col: string): string {
    return this.castToString(col);
  }
  selectSampleRows(table: string, limit: number): string {
    return `SELECT * FROM ${table} LIMIT ${limit}`;
  }

  applyMetricOverrides(
    metric: MetricInterface,
    experiment: ExperimentInterface,
    experimentRegressionAdjustmentEnabled?: boolean,
    metricRegressionAdjustmentStatus?: MetricRegressionAdjustmentStatus
  ) {
    if (!metric) return;
    const metricOverride = experiment?.metricOverrides?.find(
      (mo) => mo.id === metric.id
    );
    if (metricOverride) {
      if ("conversionDelayHours" in metricOverride) {
        metric.conversionDelayHours = metricOverride.conversionDelayHours;
      }
      if ("conversionWindowHours" in metricOverride) {
        metric.conversionWindowHours = metricOverride.conversionWindowHours;
      }
      if ("winRisk" in metricOverride) {
        metric.winRisk = metricOverride.winRisk;
      }
      if ("loseRisk" in metricOverride) {
        metric.loseRisk = metricOverride.loseRisk;
      }
    }
    // Apply regression adjustments specifically, not from metric overrides
    if (experimentRegressionAdjustmentEnabled !== undefined) {
      metric.regressionAdjustmentEnabled = experimentRegressionAdjustmentEnabled;
    }
    if (metricRegressionAdjustmentStatus !== undefined) {
      metric.regressionAdjustmentEnabled =
        experimentRegressionAdjustmentEnabled &&
        metricRegressionAdjustmentStatus.regressionAdjustmentEnabled;
      metric.regressionAdjustmentDays =
        metricRegressionAdjustmentStatus.regressionAdjustmentDays ?? 14;
      metric.regressionAdjustmentDays = Math.max(
        metric.regressionAdjustmentDays,
        0
      );
      metric.regressionAdjustmentDays = Math.min(
        metric.regressionAdjustmentDays,
        100
      );
    }
    return;
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
    // TODO: for past experiments, UNION all exposure queries together
    const experimentQueries = (
      this.settings.queries?.exposure || []
    ).map(({ id }) => this.getExposureQuery(id));

    return format(
      `-- Past Experiments
    WITH
      ${experimentQueries
        .map((q, i) => {
          const hasNameCol = q.hasNameCol || false;
          return `
        __exposures${i} as (
          SELECT 
            ${this.castToString(`'${q.id}'`)} as exposure_query,
            experiment_id,
            ${
              hasNameCol ? "MIN(experiment_name)" : "experiment_id"
            } as experiment_name,
            ${this.castToString("variation_id")} as variation_id,
            ${
              hasNameCol
                ? "MIN(variation_name)"
                : this.castToString("variation_id")
            } as variation_name,
            ${this.dateTrunc(this.castUserDateCol("timestamp"))} as date,
            count(distinct ${q.userIdType}) as users
          FROM
            (
              ${replaceSQLVars(q.query, { startDate: params.from })}
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
          MIN(experiment_name) as experiment_name,
          variation_id,
          MIN(variation_name) as variation_name,
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
          MIN(d.experiment_name) as experiment_name,
          d.variation_id,
          MIN(d.variation_name) as variation_name,
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
      -- Skip experiments at start of date range since it's likely missing data
      ${this.dateDiff(this.toTimestamp(params.from), "start_date")} > 2
    ORDER BY
      experiment_id ASC, variation_id ASC`,
      this.getFormatDialect()
    );
  }
  async runPastExperimentQuery(query: string): Promise<PastExperimentResponse> {
    const rows = await this.runQuery(query);

    return rows.map((row) => {
      return {
        exposure_query: row.exposure_query,
        experiment_id: row.experiment_id,
        experiment_name: row.experiment_name,
        variation_id: row.variation_id ?? "",
        variation_name: row.variation_name,
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
    const metricStart = this.getMetricStart(
      params.from,
      this.getMetricMinDelay([params.metric]),
      0
    );
    const metricEnd = this.getMetricEnd([params.metric], params.to);

    const aggregate = this.getAggregateMetricColumn(params.metric, "noWindow");

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
                ? `JOIN segment s ON (s.${baseIdType} = m.${baseIdType}) WHERE s.date <= m.timestamp`
                : ""
            }
          GROUP BY
            m.${baseIdType}
        )
        , __overall as (
          SELECT
            COUNT(*) as count,
            COALESCE(SUM(value), 0) as main_sum,
            COALESCE(SUM(POWER(value, 2)), 0) as main_sum_squares
          from
            __userMetric
        )
        ${
          params.includeByDate
            ? `
          , __userMetricDates as (
            -- Add in the aggregate metric value for each user
            SELECT
              ${this.dateTrunc("m.timestamp")} as date,
              ${aggregate} as value
            FROM
              __metric m
              ${
                params.segment
                  ? `JOIN segment s ON (s.${baseIdType} = m.${baseIdType}) WHERE s.date <= m.timestamp`
                  : ""
              }
            GROUP BY
              ${this.dateTrunc("m.timestamp")},
              m.${baseIdType}
          )
          , __byDateOverall as (
            SELECT
              date,
              COUNT(*) as count,
              COALESCE(SUM(value), 0) as main_sum,
              COALESCE(SUM(POWER(value, 2)), 0) as main_sum_squares
            FROM
              __userMetricDates d
            GROUP BY
              date
          )`
            : ""
        }
      ${
        params.includeByDate
          ? `
        , __union as (
          SELECT 
            null as date,
            o.*
          FROM
            __overall o
          UNION ALL
          SELECT
            d.*
          FROM
            __byDateOverall d
        )
        SELECT
          *
        FROM
          __union
        ORDER BY
          date ASC
      `
          : `
        SELECT
          o.*
        FROM
          __overall o
      `
      }
      
      `,
      this.getFormatDialect()
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
        count: parseInt(row.users) || 0,
        statistic_type: row.statistic_type ?? "",
        main_metric_type: row.main_metric_type ?? "",
        main_sum: parseFloat(row.main_sum) || 0,
        main_sum_squares: parseFloat(row.main_sum_squares) || 0,
        ...(row.denominator_metric_type && {
          denominator_metric_type: row.denominator_metric_type ?? "",
          denominator_sum: parseFloat(row.denominator_sum) || 0,
          denominator_sum_squares: parseFloat(row.denominator_sum_squares) || 0,
          main_denominator_sum_product:
            parseFloat(row.main_denominator_sum_product) || 0,
        }),
        ...(row.covariate_metric_type && {
          covariate_metric_type: row.covariate_metric_type ?? "",
          covariate_sum: parseFloat(row.covariate_sum) || 0,
          covariate_sum_squares: parseFloat(row.covariate_sum_squares) || 0,
          main_covariate_sum_product:
            parseFloat(row.main_covariate_sum_product) || 0,
        }),
      };
    });
  }

  async runMetricValueQuery(query: string): Promise<MetricValueQueryResponse> {
    const rows = await this.runQuery(query);

    return rows.map((row) => {
      const { date, count, main_sum, main_sum_squares } = row;

      const ret: MetricValueQueryResponseRow = {
        date: date ? this.convertDate(date).toISOString() : "",
        count: parseFloat(count) || 0,
        main_sum: parseFloat(main_sum) || 0,
        main_sum_squares: parseFloat(main_sum_squares) || 0,
      };

      return ret;
    });
  }

  getTestQuery(query: string): string {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - IMPORT_LIMIT_DAYS);
    const limitedQuery = replaceSQLVars(
      `WITH __table as (
        ${query}
      )
      ${this.selectSampleRows("__table", 5)}`,
      {
        startDate,
      }
    );
    return format(limitedQuery, this.getFormatDialect());
  }

  async runTestQuery(sql: string): Promise<TestQueryResult> {
    // Calculate the run time of the query
    const queryStartTime = Date.now();
    const results = await this.runQuery(sql);
    const queryEndTime = Date.now();
    const duration = queryEndTime - queryStartTime;
    return { results, duration };
  }

  private getIdentifiesCTE(
    objects: string[][],
    from: Date,
    to?: Date,
    forcedBaseIdType?: string,
    experimentId?: string
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
        ${this.getIdentitiesQuery(
          this.settings,
          baseIdType,
          idType,
          from,
          to,
          experimentId
        )}
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
    isRegressionAdjusted: boolean = false,
    ignoreConversionEnd: boolean = false,
    tablePrefix: string = "__activationMetric",
    initialTable: string = "__experiment"
  ) {
    // Note: the aliases below are needed for clickhouse
    return `
      SELECT
        initial.${baseIdType},
        ${
          isRegressionAdjusted
            ? `
          initial.preexposure_start,
          initial.preexposure_end,`
            : ""
        }
        t${metrics.length - 1}.conversion_start as conversion_start
        ${
          ignoreConversionEnd
            ? ""
            : `, t${metrics.length - 1}.conversion_end as conversion_end`
        }
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
              ${alias}.timestamp >= ${prevAlias}.conversion_start
              ${
                ignoreConversionEnd
                  ? ""
                  : `AND ${alias}.timestamp <= ${prevAlias}.conversion_end`
              }`;
          })
          .join("\n AND ")}`;
  }

  private getDimensionColumn(baseIdType: string, dimension: Dimension | null) {
    const missingDimString = "__NULL_DIMENSION";
    if (!dimension) {
      return this.castToString("'All'");
    } else if (dimension.type === "activation") {
      return `MAX(${this.ifElse(
        `a.${baseIdType} IS NULL`,
        "'Not Activated'",
        "'Activated'"
      )})`;
    } else if (dimension.type === "user") {
      return `COALESCE(MAX(${this.castToString(
        "d.value"
      )}),'${missingDimString}')`;
    } else if (dimension.type === "date") {
      return `MIN(${this.formatDate(this.dateTrunc("e.timestamp"))})`;
    } else if (dimension.type === "experiment") {
      return `SUBSTRING(
        MIN(
          CONCAT(SUBSTRING(${this.formatDateTimeString("e.timestamp")}, 1, 19), 
            coalesce(${this.castToString("e.dimension")}, ${this.castToString(
        `'${missingDimString}'`
      )})
          )
        ),
        20, 
        99999
      )`;
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

  private getMetricMinDelay(metrics: MetricInterface[]) {
    let runningDelay = 0;
    let minDelay = 0;
    metrics.forEach((m) => {
      if (m.conversionDelayHours) {
        const delay = runningDelay + m.conversionDelayHours;
        if (delay < minDelay) minDelay = delay;
        runningDelay = delay;
      }
    });
    return minDelay;
  }

  private getMetricStart(
    initial: Date,
    minDelay: number,
    regressionAdjustmentHours: number
  ) {
    const metricStart = new Date(initial);
    if (minDelay < 0) {
      metricStart.setHours(metricStart.getHours() + minDelay);
    }
    if (regressionAdjustmentHours > 0) {
      metricStart.setHours(metricStart.getHours() - regressionAdjustmentHours);
    }
    return metricStart;
  }

  private getMetricEnd(
    metrics: MetricInterface[],
    initial?: Date,
    ignoreConversionEnd?: boolean
  ): Date | null {
    if (!initial) return null;
    if (ignoreConversionEnd) return initial;

    const metricEnd = new Date(initial);
    let runningHours = 0;
    let maxHours = 0;
    metrics.forEach((m) => {
      const hours =
        runningHours +
        (m.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS) +
        (m.conversionDelayHours || 0);
      if (hours > maxHours) maxHours = hours;
      runningHours = hours;
    });

    if (maxHours > 0) {
      metricEnd.setHours(metricEnd.getHours() + maxHours);
    }

    return metricEnd;
  }

  private getStatisticType(
    isRatio: boolean,
    isRegressionAdjusted: boolean
  ): "mean" | "ratio" | "mean_ra" {
    if (isRatio) {
      return "ratio";
    }
    if (isRegressionAdjusted) {
      return "mean_ra";
    }
    return "mean";
  }

  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string {
    const {
      metric: metricDoc,
      activationMetrics: activationMetricsDocs,
      denominatorMetrics: denominatorMetricsDocs,
      experiment,
      phase,
      segment,
      regressionAdjustmentEnabled,
      metricRegressionAdjustmentStatus,
    } = params;

    // clone the metrics before we mutate them
    const metric = cloneDeep<MetricInterface>(metricDoc);
    const activationMetrics = cloneDeep<MetricInterface[]>(
      activationMetricsDocs
    );
    const denominatorMetrics = cloneDeep<MetricInterface[]>(
      denominatorMetricsDocs
    );

    this.applyMetricOverrides(
      metric,
      experiment,
      regressionAdjustmentEnabled,
      metricRegressionAdjustmentStatus
    );
    activationMetrics.forEach((m) => this.applyMetricOverrides(m, experiment));
    denominatorMetrics.forEach((m) => this.applyMetricOverrides(m, experiment));

    let dimension = params.dimension;
    if (dimension?.type === "activation" && !activationMetrics.length) {
      dimension = null;
    }
    // Replace any placeholders in the user defined dimension SQL
    if (dimension?.type === "user") {
      dimension.dimension.sql = replaceSQLVars(dimension.dimension.sql, {
        startDate: phase.dateStarted,
        endDate: phase.dateEnded,
        experimentId: experiment.trackingKey,
      });
    }
    // Replace any placeholders in the segment SQL
    if (segment?.sql) {
      segment.sql = replaceSQLVars(segment.sql, {
        startDate: phase.dateStarted,
        endDate: phase.dateEnded,
        experimentId: experiment.trackingKey,
      });
    }

    const exposureQuery = this.getExposureQuery(
      experiment.exposureQueryId || "",
      experiment.userIdType
    );

    const denominator = denominatorMetrics[denominatorMetrics.length - 1];
    // If the denominator is a binomial, it's just acting as a filter
    // e.g. "Purchase/Signup" is filtering to users who signed up and then counting purchases
    // When the denominator is a count, it's a real ratio, dividing two quantities
    // e.g. "Pages/Session" is dividing number of page views by number of sessions
    const isRatio = denominator?.type === "count";
    // However, even if we use a count as denominator, GB 1.9 and earlier would
    // filter out users who had 0 values for the denominator. However, we may want
    // to enable more generic ratio metrics where we just sum numerator and denominator
    // across all users. The following flag determines whether to filter out users
    // that have no denominator values
    const ratioIsFunnel = true; // @todo: allow this to be configured

    // redundant checks to make sure configuration makes sense and we only build expensive queries for the cases
    // where RA is actually possible
    const isRegressionAdjusted =
      (metric.regressionAdjustmentDays ?? 0) > 0 &&
      !!metric.regressionAdjustmentEnabled &&
      !isRatio &&
      !metric.aggregation;

    const regressionAdjustmentHours = isRegressionAdjusted
      ? (metric.regressionAdjustmentDays ?? 0) * 24
      : 0;

    const ignoreConversionEnd =
      experiment.attributionModel === "experimentDuration";

    // Get rough date filter for metrics to improve performance
    const orderedMetrics = activationMetrics
      .concat(denominatorMetrics)
      .concat([metric]);
    const minMetricDelay = this.getMetricMinDelay(orderedMetrics);
    const metricStart = this.getMetricStart(
      phase.dateStarted,
      minMetricDelay,
      regressionAdjustmentHours
    );
    const metricEnd = this.getMetricEnd(
      orderedMetrics,
      phase.dateEnded,
      ignoreConversionEnd
    );

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
      exposureQuery.userIdType,
      experiment.trackingKey
    );

    const dimensionCol = this.getDimensionColumn(baseIdType, dimension);

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
        ${replaceSQLVars(exposureQuery.query, {
          startDate: phase.dateStarted,
          endDate: phase.dateEnded,
          experimentId: experiment.trackingKey,
        })}
      ),
      __experiment as (${this.getExperimentCTE({
        experiment,
        phase,
        baseIdType,
        conversionWindowHours: intialMetric.conversionWindowHours || 0,
        conversionDelayHours: intialMetric.conversionDelayHours || 0,
        experimentDimension:
          dimension?.type === "experiment" ? dimension.id : null,
        isRegressionAdjusted: isRegressionAdjusted,
        regressionAdjustmentHours: regressionAdjustmentHours,
        minMetricDelay: minMetricDelay,
        ignoreConversionEnd,
      })})
      , __metric as (${this.getMetricCTE({
        metric,
        baseIdType,
        idJoinMap,
        ignoreConversionEnd: ignoreConversionEnd,
        startDate: metricStart,
        endDate: metricEnd,
        experimentId: experiment.trackingKey,
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
            ignoreConversionEnd: ignoreConversionEnd,
            baseIdType,
            idJoinMap,
            startDate: metricStart,
            endDate: metricEnd,
            experimentId: experiment.trackingKey,
          })})`;
        })
        .join("\n")}
      ${
        activationMetrics.length > 0
          ? `, __activatedUsers as (${this.getActivatedUsersCTE(
              baseIdType,
              activationMetrics,
              isRegressionAdjusted,
              ignoreConversionEnd
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
            ignoreConversionEnd: ignoreConversionEnd,
            baseIdType,
            idJoinMap,
            startDate: metricStart,
            endDate: metricEnd,
            experimentId: experiment.trackingKey,
          })})`;
        })
        .join("\n")}
      ${
        denominatorMetrics.length > 0 && ratioIsFunnel
          ? `, __denominatorUsers as (${this.getActivatedUsersCTE(
              baseIdType,
              denominatorMetrics,
              false, // no regression adjustment for denominators
              ignoreConversionEnd,
              "__denominator",
              dimension?.type !== "activation" && activationMetrics.length > 0
                ? "__activatedUsers"
                : "__experiment"
            )})`
          : ""
      }
      , __distinctUsers as (
        -- One row per user
        SELECT
          e.${baseIdType} as ${baseIdType},
          ${dimensionCol} as dimension,
          ${
            isRegressionAdjusted
              ? `MIN(e.preexposure_start) AS preexposure_start,
                 MIN(e.preexposure_end) AS preexposure_end,`
              : ""
          }
          ${this.ifElse(
            "count(distinct e.variation) > 1",
            "'__multiple__'",
            "max(e.variation)"
          )} as variation,
          MIN(${this.getMetricConversionBase(
            "conversion_start",
            denominatorMetrics.length > 0,
            activationMetrics.length > 0 && dimension?.type !== "activation"
          )}) as conversion_start
          ${
            ignoreConversionEnd
              ? ""
              : `, MIN(${this.getMetricConversionBase(
                  "conversion_end",
                  denominatorMetrics.length > 0,
                  activationMetrics.length > 0 &&
                    dimension?.type !== "activation"
                )}) as conversion_end`
          }
        FROM
          __experiment e
          ${
            segment
              ? `JOIN __segment s ON (s.${baseIdType} = e.${baseIdType})`
              : ""
          }
          ${
            dimension?.type === "user"
              ? `LEFT JOIN __dimension d ON (d.${baseIdType} = e.${baseIdType})`
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
            denominatorMetrics.length > 0 && ratioIsFunnel
              ? `JOIN __denominatorUsers du ON (du.${baseIdType} = e.${baseIdType})`
              : ""
          }
        ${segment ? `WHERE s.date <= e.timestamp` : ""}
        GROUP BY
          e.${baseIdType}
      )
      , __userMetric as (
        -- Add in the aggregate metric value for each user
        SELECT
          d.variation,
          d.dimension,
          d.${baseIdType},
          ${this.getAggregateMetricColumn(
            metric,
            isRegressionAdjusted ? "post" : "noWindow"
          )} as value
          ${
            isRegressionAdjusted
              ? `, ${this.getAggregateMetricColumn(
                  metric,
                  "pre"
                )} as covariate_value`
              : ""
          }
        FROM
          __distinctUsers d
        JOIN __metric m ON (
          m.${baseIdType} = d.${baseIdType}
        )
        WHERE
          ${this.getMetricWindowWhereClause(
            isRegressionAdjusted,
            ignoreConversionEnd,
            "d"
          )}
        GROUP BY
          d.variation,
          d.dimension,
          d.${baseIdType}
      )
      ${
        isRatio
          ? `, __userDenominator as (
              -- Add in the aggregate denominator value for each user
              SELECT
                d.variation,
                d.dimension,
                d.${baseIdType},
                ${this.getAggregateMetricColumn(
                  denominator,
                  "noWindow"
                )} as value
              FROM
                __distinctUsers d
                JOIN __denominator${denominatorMetrics.length - 1} m ON (
                  m.${baseIdType} = d.${baseIdType}
                )
              WHERE
                m.timestamp >= d.conversion_start
                ${
                  ignoreConversionEnd
                    ? ""
                    : "AND m.timestamp <= d.conversion_end"
                }
              GROUP BY
                d.variation,
                d.dimension,
                d.${baseIdType}
            )`
          : ""
      }
      , __stats AS (
        -- One row per variation/dimension with aggregations
        SELECT
          ${isRatio ? `d` : `m`}.variation,
          ${isRatio ? `d` : `m`}.dimension,
          COUNT(*) AS count,
          SUM(COALESCE(m.value, 0)) AS main_sum,
          SUM(POWER(COALESCE(m.value, 0), 2)) AS main_sum_squares
          ${
            isRatio
              ? `,
            SUM(COALESCE(d.value, 0)) AS denominator_sum,
            SUM(POWER(COALESCE(d.value, 0), 2)) AS denominator_sum_squares,
            SUM(COALESCE(d.value, 0) * COALESCE(m.value, 0)) AS main_denominator_sum_product
          `
              : ""
          }
          ${
            isRegressionAdjusted
              ? `,
              SUM(COALESCE(m.covariate_value, 0)) AS covariate_sum,
              SUM(POWER(COALESCE(m.covariate_value, 0), 2)) AS covariate_sum_squares,
              SUM(COALESCE(m.value, 0) * COALESCE(m.covariate_value, 0)) AS main_covariate_sum_product
              `
              : ""
          }
        FROM
        ${
          isRatio
            ? `__userDenominator d
              LEFT JOIN __userMetric m ON (
                d.${baseIdType} = m.${baseIdType}
              )`
            : `__userMetric m`
        }
        ${
          isRegressionAdjusted && metric.ignoreNulls ? `WHERE m.value != 0` : ""
        }
        GROUP BY
          ${isRatio ? `d` : `m`}.variation,
          ${isRatio ? `d` : `m`}.dimension
      )
      , __overallUsers as (
        -- Number of users in each variation/dimension
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
      SELECT
        u.variation,
        u.dimension,
        ${metric.ignoreNulls ? "COALESCE(s.count, 0)" : "u.users"} AS users,
        '${this.getStatisticType(
          isRatio,
          isRegressionAdjusted
        )}' as statistic_type,
        '${metric.type}' as main_metric_type,
        COALESCE(s.main_sum, 0) AS main_sum,
        COALESCE(s.main_sum_squares, 0) AS main_sum_squares
        ${
          isRatio
            ? `,
            '${denominator?.type}' as denominator_metric_type,
            COALESCE(s.denominator_sum, 0) AS denominator_sum,
            COALESCE(s.denominator_sum_squares, 0) AS denominator_sum_squares,
            COALESCE(s.main_denominator_sum_product, 0) AS main_denominator_sum_product
        `
            : ""
        }
        ${
          isRegressionAdjusted
            ? `,
            '${metric.type}' as covariate_metric_type,
            COALESCE(s.covariate_sum, 0) AS covariate_sum,
            COALESCE(s.covariate_sum_squares, 0) AS covariate_sum_squares,
            COALESCE(s.main_covariate_sum_product, 0) AS main_covariate_sum_product
            `
            : ""
        }
      FROM
      __overallUsers u
      LEFT JOIN
        __stats s ON (
          u.variation = s.variation
          AND u.dimension = s.dimension
        )
    `,
      this.getFormatDialect()
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
    ignoreConversionEnd = false,
    baseIdType,
    idJoinMap,
    startDate,
    endDate,
    experimentId,
  }: {
    metric: MetricInterface;
    conversionWindowHours?: number;
    conversionDelayHours?: number;
    ignoreConversionEnd?: boolean;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    startDate: Date;
    endDate: Date | null;
    experimentId?: string;
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
        const userIdType: string = metric.userIdTypes[i];
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
    // endDate is now meaningful if ignoreConversionEnd
    if (endDate) {
      where.push(`${timestampCol} <= ${this.toTimestamp(endDate)}`);
    }

    return `-- Metric (${metric.name})
      SELECT
        ${userIdCol} as ${baseIdType},
        ${cols.value} as value,
        ${timestampCol} as timestamp,
        ${this.addHours(timestampCol, conversionDelayHours)} as conversion_start
        ${
          ignoreConversionEnd
            ? ""
            : `, ${this.addHours(
                timestampCol,
                conversionDelayHours + conversionWindowHours
              )} as conversion_end`
        }
      FROM
        ${
          queryFormat === "sql"
            ? `(
              ${replaceSQLVars(metric.sql || "", {
                startDate,
                endDate: endDate || undefined,
                experimentId,
              })}
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

  private getMetricWindowWhereClause(
    isRegressionAdjusted: boolean,
    ignoreConversionEnd: boolean,
    userAlias: string
  ): string {
    const conversionWindowFilter = `
      m.timestamp >= ${userAlias}.conversion_start
      ${
        ignoreConversionEnd
          ? ""
          : `AND m.timestamp <= ${userAlias}.conversion_end`
      }`;
    if (isRegressionAdjusted) {
      return `(${conversionWindowFilter}) OR (m.timestamp >= ${userAlias}.preexposure_start AND m.timestamp < ${userAlias}.preexposure_end)`;
    }
    return conversionWindowFilter;
  }

  private getExperimentCTE({
    experiment,
    baseIdType,
    phase,
    conversionWindowHours = 0,
    conversionDelayHours = 0,
    experimentDimension = null,
    isRegressionAdjusted = false,
    regressionAdjustmentHours = 0,
    minMetricDelay = 0,
    ignoreConversionEnd = false,
  }: {
    experiment: ExperimentInterface;
    baseIdType: string;
    phase: ExperimentPhase;
    conversionWindowHours: number;
    conversionDelayHours: number;
    experimentDimension: string | null;
    isRegressionAdjusted: boolean;
    regressionAdjustmentHours: number;
    minMetricDelay: number;
    ignoreConversionEnd: boolean;
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
      ${timestampColumn} as timestamp,
      ${
        isRegressionAdjusted
          ? `${this.addHours(
              timestampColumn,
              minMetricDelay
            )} AS preexposure_end,
            ${this.addHours(
              timestampColumn,
              minMetricDelay - regressionAdjustmentHours
            )} AS preexposure_start,`
          : ""
      }
      ${this.addHours(
        timestampColumn,
        conversionDelayHours
      )} as conversion_start
      ${experimentDimension ? `, e.${experimentDimension} as dimension` : ""}
      ${
        ignoreConversionEnd
          ? ""
          : `, ${this.addHours(
              timestampColumn,
              conversionDelayHours + conversionWindowHours
            )} as conversion_end`
      }    
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

  private addPrePostTimeFilter(
    col: string,
    timePeriod: MetricAggregationType
  ): string {
    const mcol = `m.timestamp`;
    if (timePeriod === "pre") {
      return `${this.ifElse(`${mcol} < d.preexposure_end`, `${col}`, `NULL`)}`;
    }
    if (timePeriod === "post") {
      return `${this.ifElse(
        `${mcol} >= d.conversion_start`,
        `${col}`,
        `NULL`
      )}`;
    }
    return `${col}`;
  }

  private getAggregateMetricColumn(
    metric: MetricInterface,
    metricTimeWindow: MetricAggregationType = "post"
  ) {
    // Binomial metrics don't have a value, so use hard-coded "1" as the value
    if (metric.type === "binomial") {
      return `MAX(${this.addPrePostTimeFilter("1", metricTimeWindow)})`;
    }

    // SQL editor
    if (this.getMetricQueryFormat(metric) === "sql") {
      // Custom aggregation that's a hardcoded number (e.g. "1")
      if (metric.aggregation && Number(metric.aggregation)) {
        return `MAX(${this.addPrePostTimeFilter(
          metric.aggregation,
          metricTimeWindow
        )})`;
      }
      // Other custom aggregation
      else if (metric.aggregation) {
        // prePostTimeFilter (and regression adjustment) not implemented for
        // custom aggregate metrics
        return this.capValue(metric.cap, metric.aggregation);
      }
      // Standard aggregation (SUM)
      else {
        return this.capValue(
          metric.cap,
          `SUM(${this.addPrePostTimeFilter(`m.value`, metricTimeWindow)})`
        );
      }
    }
    // Query builder
    else {
      // Count metrics that specify a distinct column to count
      if (metric.type === "count" && metric.column) {
        return this.capValue(
          metric.cap,
          `COUNT(DISTINCT (${this.addPrePostTimeFilter(
            `m.value`,
            metricTimeWindow
          )}))`
        );
      }
      // Count metrics just do a simple count of rows by default
      else if (metric.type === "count") {
        return this.capValue(
          metric.cap,
          `SUM(${this.addPrePostTimeFilter("1", metricTimeWindow)})`
        );
      }
      // Revenue and duration metrics use MAX by default
      else {
        return this.capValue(
          metric.cap,
          `MAX(${this.addPrePostTimeFilter(`m.value`, metricTimeWindow)})`
        );
      }
    }
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
    to: Date | undefined,
    experimentId?: string
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
              ${replaceSQLVars(join.query, {
                startDate: from,
                endDate: to,
                experimentId,
              })}
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
          (${replaceSQLVars(settings.queries.pageviewsQuery, {
            startDate: from,
            endDate: to,
            experimentId,
          })}) i
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
