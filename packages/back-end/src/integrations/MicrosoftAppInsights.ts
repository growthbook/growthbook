import cloneDeep from "lodash/cloneDeep";
import { getValidDate } from "shared/dates";
import { DimensionInterface } from "../../types/dimension";
import {
  SourceIntegrationInterface,
  MetricValueParams,
  ExperimentMetricQueryParams,
  ExperimentMetricQueryResponse,
  PastExperimentParams,
  MetricValueQueryResponse,
  MetricValueQueryResponseRow,
  ExperimentQueryResponses,
  Dimension,
  MetricAggregationType,
  TestQueryResult,
  PastExperimentQueryResponse,
  MetricValueQueryResponseRows,
  ExperimentUnitsQueryResponse,
  ExperimentUnitsQueryParams,
} from "../types/Integration";
import { MicrosoftAppInsightsParams } from "../../types/integrations/microsoftappinsights";
import { decryptDataSourceParams } from "../services/datasource";
import {
  DataSourceProperties,
  DataSourceSettings,
  DataSourceType,
  ExposureQuery,
} from "../../types/datasource";
import {
  DEFAULT_CONVERSION_WINDOW_HOURS,
  IMPORT_LIMIT_DAYS,
} from "../util/secrets";
import { SegmentInterface } from "../../types/segment";
import {
  getBaseIdTypeAndJoins,
  replaceKustoVars,
  format,
  FormatDialect,
} from "../util/kusto";
import { MetricInterface } from "../../types/metric";
import { ExperimentSnapshotSettings } from "../../types/experiment-snapshot";
import { runApi } from "../services/microsoftappinsights";

export default class MicrosoftAppInsights
  implements SourceIntegrationInterface {
  params: MicrosoftAppInsightsParams;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  datasource: string;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  organization: string;
  settings: DataSourceSettings;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  decryptionError: boolean;
  type!: DataSourceType;

  constructor(encryptedParams: string, settings: DataSourceSettings) {
    try {
      // logStorageContainer
      this.params = decryptDataSourceParams<MicrosoftAppInsightsParams>(
        encryptedParams
      );
    } catch (e) {
      this.params = {
        appId: "",
        apiKey: "",
        logStorageConnectionString: "",
        logStorageContainer: "",
      };
      this.decryptionError = true;
    }
    this.settings = {
      ...settings,
    };
  }

  async runQuery(query: string): Promise<any> {
    const result = await runApi(
      this.params,
      query !== "" ? `?query=${encodeURIComponent(query)}` : ""
    );

    return result;
  }

  createUnitsTableOptions() {
    return "";
  }

  getExperimentUnitsTableQuery(params: ExperimentUnitsQueryParams): string {
    return format(
      `
    CREATE OR REPLACE TABLE ${params.unitsTableFullName}
    ${this.createUnitsTableOptions()}
    AS (
      WITH
        ${this.getExperimentUnitsQuery(params)}
      SELECT * FROM __experimentUnits
    );
    `,
      this.getFormatDialect()
    );
  }

  private getConversionWindowClause(
    baseCol: string,
    metricCol: string,
    metric: MetricInterface,
    ignoreConversionEnd: boolean
  ): string {
    const conversionDelayHours = metric.conversionDelayHours ?? 0;
    const conversionWindowHours =
      metric.conversionWindowHours ?? DEFAULT_CONVERSION_WINDOW_HOURS;
    return `
      ${metricCol} >= ${this.addHours(baseCol, conversionDelayHours)}
      ${
        ignoreConversionEnd
          ? ""
          : `AND ${metricCol} <= ${this.addHours(
              baseCol,
              conversionDelayHours + conversionWindowHours
            )}`
      }`;
  }

  getExperimentUnitsQuery(params: ExperimentUnitsQueryParams): string {
    const { settings, segment, activationMetric: activationMetricDoc } = params;

    let activationMetric = null;
    if (activationMetricDoc) {
      activationMetric = cloneDeep<MetricInterface>(activationMetricDoc);
      this.applyMetricOverrides(activationMetric, settings);
    }

    const dimension = params.dimension;
    // Replace any placeholders in the user defined dimension SQL
    if (dimension?.type === "user") {
      dimension.dimension.sql = replaceKustoVars(dimension.dimension.sql, {
        startDate: settings.startDate,
        endDate: settings.endDate,
        experimentId: settings.experimentId,
      });
    }
    // Replace any placeholders in the segment SQL
    if (segment?.sql) {
      segment.sql = replaceKustoVars(segment.sql, {
        startDate: settings.startDate,
        endDate: settings.endDate,
        experimentId: settings.experimentId,
      });
    }

    const exposureQuery = this.getExposureQuery(settings.exposureQueryId || "");

    // Get any required identity join queries
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE(
      [
        [exposureQuery.userIdType],
        activationMetric?.userIdTypes ?? [],
        dimension?.type === "user"
          ? [dimension.dimension.userIdType || "user_id"]
          : [],
        segment ? [segment.userIdType || "user_id"] : [],
      ],
      settings.startDate,
      settings.endDate,
      exposureQuery.userIdType,
      settings.experimentId
    );

    const dimensionCol = this.getDimensionColumn(baseIdType, dimension);

    // Get date range for experiment
    const startDate: Date = settings.startDate;
    const endDate: Date | null = this.getExperimentEndDate(settings, 0);

    const timestampColumn = "e.timestamp";
    // BQ datetime cast for SELECT statements (do not use for where)
    const timestampDateTimeColumn = this.castUserDateCol(timestampColumn);

    const experimentDimension =
      dimension?.type === "experiment" ? dimension.id : null;

    const ignoreConversionEnd =
      settings.attributionModel === "experimentDuration";

    return `
    ${params.includeIdJoins ? idJoinSQL : ""}
    __rawExperiment AS (
      ${replaceKustoVars(exposureQuery.query, {
        startDate: settings.startDate,
        endDate: settings.endDate,
        experimentId: settings.experimentId,
      })}
    ),
    __experimentExposures AS (
      -- Viewed Experiment
      SELECT
        e.${baseIdType} as ${baseIdType},
        ${this.castToString("e.variation_id")} as variation,
        ${timestampDateTimeColumn} as timestamp
        ${experimentDimension ? `, e.${experimentDimension} as dimension` : ""}
      FROM
          __rawExperiment e
      WHERE
          e.experiment_id = '${settings.experimentId}'
          AND ${timestampColumn} >= ${this.toTimestamp(startDate)}
          ${
            endDate
              ? `AND ${timestampColumn} <= ${this.toTimestamp(endDate)}`
              : ""
          }
          ${settings.queryFilter ? `AND (\n${settings.queryFilter}\n)` : ""}
    )
    ${
      activationMetric
        ? `, __activationMetric as (${this.getMetricCTE({
            metric: activationMetric,
            baseIdType,
            idJoinMap,
            startDate: this.getMetricStart(
              settings.startDate,
              activationMetric.conversionDelayHours || 0,
              0
            ),
            endDate: this.getMetricEnd([activationMetric], settings.endDate),
            experimentId: settings.experimentId,
          })})
        `
        : ""
    }
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
    , __experimentUnits AS (
      -- One row per user
      SELECT
        e.${baseIdType} AS ${baseIdType},
        ${dimensionCol} AS dimension,
        MIN(${timestampColumn}) AS first_exposure_timestamp,
        ${
          activationMetric
            ? `MIN(${this.ifElse(
                this.getConversionWindowClause(
                  "e.timestamp",
                  "a.timestamp",
                  activationMetric,
                  ignoreConversionEnd
                ),
                "a.timestamp",
                "NULL"
              )}) AS first_activation_timestamp,
            `
            : ""
        }
        ${this.ifElse(
          "count(distinct e.variation) > 1",
          "'__multiple__'",
          "max(e.variation)"
        )} AS variation
      FROM
        __experimentExposures e
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
          activationMetric
            ? `LEFT JOIN __activationMetric a ON (a.${baseIdType} = e.${baseIdType})`
            : ""
        }
      ${segment ? `WHERE s.date <= e.timestamp` : ""}
      GROUP BY
        e.${baseIdType}
    )`;
  }

  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string {
    const {
      metric: metricDoc,
      denominatorMetrics: denominatorMetricsDocs,
      activationMetric: activationMetricDoc,
      settings,
      segment,
    } = params;

    // clone the metrics before we mutate them
    const metric = cloneDeep<MetricInterface>(metricDoc);
    const denominatorMetrics = cloneDeep<MetricInterface[]>(
      denominatorMetricsDocs
    );
    let activationMetric = null;
    if (activationMetricDoc) {
      activationMetric = cloneDeep<MetricInterface>(activationMetricDoc);
      this.applyMetricOverrides(activationMetric, settings);
    }

    this.applyMetricOverrides(metric, settings);
    denominatorMetrics.forEach((m: MetricInterface) =>
      this.applyMetricOverrides(m, settings)
    );

    const dimension = params.dimension;
    // Replace any placeholders in the user defined dimension SQL
    if (dimension?.type === "user") {
      dimension.dimension.sql = replaceKustoVars(dimension.dimension.sql, {
        startDate: settings.startDate,
        endDate: settings.endDate,
        experimentId: settings.experimentId,
      });
    }
    // Replace any placeholders in the segment SQL
    if (segment?.sql) {
      segment.sql = replaceKustoVars(segment.sql, {
        startDate: settings.startDate,
        endDate: settings.endDate,
        experimentId: settings.experimentId,
      });
    }

    const exposureQuery = this.getExposureQuery(settings.exposureQueryId || "");

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
      settings.attributionModel === "experimentDuration";

    // Get rough date filter for metrics to improve performance
    const orderedMetrics = (activationMetric ? [activationMetric] : [])
      .concat(denominatorMetrics)
      .concat([metric]);
    const minMetricDelay = this.getMetricMinDelay(orderedMetrics);
    const metricStart = this.getMetricStart(
      settings.startDate,
      minMetricDelay,
      regressionAdjustmentHours
    );
    const metricEnd = this.getMetricEnd(
      orderedMetrics,
      settings.endDate,
      ignoreConversionEnd
    );

    // Get any required identity join queries
    const idTypeObjects = [
      [exposureQuery.userIdType],
      metric.userIdTypes || [],
      ...denominatorMetrics.map((m: MetricInterface) => m.userIdTypes || []),
    ];
    // add idTypes usually handled in units query here in the case where
    // we don't have a separate table for the units query
    if (!params.useUnitsTable) {
      idTypeObjects.push(
        dimension?.type === "user"
          ? [dimension.dimension.userIdType || "user_id"]
          : [],
        segment ? [segment.userIdType || "user_id"] : [],
        activationMetric?.userIdTypes || []
      );
    }

    // Get any required identity join queries
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE(
      idTypeObjects,
      settings.startDate,
      settings.endDate,
      exposureQuery.userIdType,
      settings.experimentId
    );

    const dimensionCol = this.getDimensionColumn(baseIdType, dimension);

    const intialMetric =
      denominatorMetrics.length > 0 ? denominatorMetrics[0] : metric;

    return format(
      `// ${metric.name} (${metric.type})
      ${idJoinSQL}
      let rawExperiment = (
        ${replaceKustoVars(exposureQuery.query, {
          startDate: settings.startDate,
          endDate: settings.endDate,
          experimentId: settings.experimentId,
        })}
      );
      let experiment = (${this.getExperimentCTE({
        settings,
        baseIdType,
        conversionWindowHours: intialMetric.conversionWindowHours || 0,
        conversionDelayHours: intialMetric.conversionDelayHours || 0,
        experimentDimension:
          dimension?.type === "experiment" ? dimension.id : null,
        isRegressionAdjusted: isRegressionAdjusted,
        regressionAdjustmentHours: regressionAdjustmentHours,
        minMetricDelay: minMetricDelay,
        ignoreConversionEnd,
      })});
      let metric = (${this.getMetricCTE({
        metric,
        baseIdType,
        idJoinMap,
        ignoreConversionEnd: ignoreConversionEnd,
        startDate: metricStart,
        endDate: metricEnd,
        experimentId: settings.experimentId,
      })});
      ${
        segment
          ? `let segment = (${this.getSegmentCTE(
              segment,
              baseIdType,
              idJoinMap
            )});`
          : ""
      }
      ${
        dimension?.type === "user"
          ? `let dimension = (${this.getDimensionCTE(
              dimension.dimension,
              baseIdType,
              idJoinMap
            )});`
          : ""
      }
      
      ${denominatorMetrics
        .map((m: MetricInterface, i: number) => {
          const nextMetric = denominatorMetrics[i + 1] || metric;
          return `let denominator${i} = (${this.getMetricCTE({
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
            experimentId: settings.experimentId,
          })});`;
        })
        .join("\n")}
      ${
        denominatorMetrics.length > 0 && ratioIsFunnel
          ? `let denominatorUsers = (${this.getActivatedUsersCTE(
              baseIdType,
              denominatorMetrics,
              false, // no regression adjustment for denominators
              ignoreConversionEnd,
              "denominator",
              dimension?.type !== "activation" && activationMetric
                ? "activatedUsers"
                : "experiment"
            )});`
          : ""
      }
      let distinctUsers = (
        // One row per user
        experiment
          ${
            segment
              ? `| join kind=fullouter (segment) on ($left.${baseIdType} == $right.${baseIdType})`
              : ""
          }
          ${
            dimension?.type === "user"
              ? `| join kind=leftouter (dimension) on ($left.${baseIdType} == $right.${baseIdType})`
              : ""
          }
          ${
            activationMetric
              ? `
          | join kind=${
            dimension?.type === "activation" ? "leftouter" : "fullouter"
          } (activatedUsers) on (
            $left.${baseIdType} == $right.${baseIdType}
          )`
              : ""
          }
          ${
            denominatorMetrics.length > 0 && ratioIsFunnel
              ? `| join kind=fullouter (denominatorUsers) on ($left.${baseIdType} = $right.${baseIdType})`
              : ""
          }
        ${segment ? `| where ['date'] <= timestamp` : ""}
        | summarize
          dimension = ${dimensionCol},
          ${
            isRegressionAdjusted
              ? `preexposure_start = min(preexposure_start),
              preexposure_end = min(preexposure_end),`
              : ""
          }
          variation = ${this.ifElse(
            "dcount(variation) > 1",
            "'__multiple__'",
            "max(variation)"
          )},
          conversion_start = min(${this.getMetricConversionBase(
            "conversion_start",
            denominatorMetrics.length > 0,
            Boolean(activationMetric && dimension?.type !== "activation")
          )})
          ${
            ignoreConversionEnd
              ? ""
              : `, conversion_end = min(${this.getMetricConversionBase(
                  "conversion_end",
                  denominatorMetrics.length > 0,
                  Boolean(activationMetric && dimension?.type !== "activation")
                )})`
          }
          by ${baseIdType}
      );
      let userMetric = (
        // Add in the aggregate metric value for each user
        distinctUsers
        | project
            variation = variation,
            dimension = dimension,
            ${baseIdType} = ${baseIdType}
        | join kind=fullouter (metric) on $left.user_id == $right.user_id
        | where
          ${this.getMetricWindowWhereClause(
            isRegressionAdjusted,
            ignoreConversionEnd
          )}
        | summarize 
          value = ${this.getAggregateMetricColumn(
            metric,
            isRegressionAdjusted ? "post" : "noWindow"
          )}
          ${
            isRegressionAdjusted
              ? `, covariate_value = ${this.getAggregateMetricColumn(
                  metric,
                  "pre"
                )}`
              : ""
          } by
          variation,
          dimension,
          ${baseIdType}
      );
      ${
        isRatio
          ? `let userDenominator = (
              // Add in the aggregate denominator value for each user
              distinctUsers
              | join kind=fullouter (denominator${
                denominatorMetrics.length - 1
              }) on (
                $left.${baseIdType} == $right.${baseIdType}
              )
              | where
                timestamp >= conversion_start
                ${ignoreConversionEnd ? "" : "and timestamp <= conversion_end"}
              | summarize
                value = ${this.getAggregateMetricColumn(
                  denominator,
                  "noWindow"
                )} by 
                variation,
                dimension,
                ${baseIdType}
            );`
          : ""
      }
      let stats = (
        // One row per variation/dimension with aggregations
        ${
          isRatio
            ? `userDenominator
              | join kind=leftouter (userMetric) on (
                $left.${baseIdType} = $right.${baseIdType}
              )`
            : `userMetric`
        }
        | summarize 
          count = count(),
          main_sum = sum(coalesce(value, 0)),
          main_sum_squares = sum(pow(coalesce(value, 0), 2))
          ${
            isRatio
              ? `,
            denominator_sum = sum(coalesce(value, 0)),
            denominator_sum_squares = sum(pow(coalesce(value, 0), 2)),
            main_denominator_sum_product = sum(coalesce(value, 0) * coalesce(value, 0))
          `
              : ""
          }
          ${
            isRegressionAdjusted
              ? `,
              covariate_sum = sum(coalesce(covariate_value, 0)),
              covariate_sum_squares = sum(pow(coalesce(covariate_value, 0), 2)),
              main_covariate_sum_product = sum(coalesce(value, 0) * coalesce(covariate_value, 0))
              `
              : ""
          }
          by variation, dimension
        ${
          isRegressionAdjusted && metric.ignoreNulls ? `| where value != 0` : ""
        }
      );
      let overallUsers = (
        // Number of users in each variation/dimension
        distinctUsers
        | summarize users = count() by variation, dimension
      );
      overallUsers
      | join kind=leftouter (
        stats
      ) on $left.variation == $right.variation and $left.dimension == $right.dimension
      | project
        variation,
        dimension,
        users = ${metric.ignoreNulls ? "coalesce(count, 0)" : "users"},
        statistic_type = '${this.getStatisticType(
          isRatio,
          isRegressionAdjusted
        )}',
        main_metric_type = '${metric.type}',
        main_sum = coalesce(main_sum, 0),
        main_sum_squares = coalesce(main_sum_squares, 0.0)
        ${
          isRatio
            ? `,
            denominator_metric_type = '${denominator?.type}',
            denominator_sum = coalesce(denominator_sum, 0),
            denominator_sum_squares = coalesce(denominator_sum_squares, 0.0),
            main_denominator_sum_product = coalesce(main_denominator_sum_product, 0.0)
        `
            : ""
        }
        ${
          isRegressionAdjusted
            ? `,
            covariate_metric_type = '${metric.type}',
            covariate_sum = coalesce(covariate_sum, 0),
            covariate_sum_squares = coalesce(covariate_sum_squares, 0.0),
            main_covariate_sum_product = coalesce(main_covariate_sum_product, 0.0)
            `
            : ""
        }
    `,
      this.getFormatDialect()
    );
  }

  async runExperimentMetricQuery(
    query: string
  ): Promise<ExperimentMetricQueryResponse> {
    const kustoResult = await this.runQuery(query);

    return (
      (kustoResult?.tables?.[0]?.rows &&
        kustoResult?.tables?.[0]?.rows.map((row: any) => {
          return {
            variation: row[0] ?? "",
            dimension: row[1] || "",
            users: parseInt(row[2]) || 0,
            count: parseInt(row[2]) || 0,
            statistic_type: row[3] ?? "",
            main_metric_type: row[4] ?? "",
            main_sum: parseFloat(row[5]) || 0,
            main_sum_squares: parseFloat(row[6]) || 0,
            ...(row.denominator_metric_type && {
              denominator_metric_type: row[7] ?? "",
              denominator_sum: parseFloat(row[8]) || 0,
              denominator_sum_squares: parseFloat(row[9]) || 0,
              main_denominator_sum_product: parseFloat(row[10]) || 0,
            }),
            ...(row.covariate_metric_type && {
              covariate_metric_type: row[11] ?? "",
              covariate_sum: parseFloat(row[12]) || 0,
              covariate_sum_squares: parseFloat(row[13]) || 0,
              main_covariate_sum_product: parseFloat(row[14]) || 0,
            }),
          };
        })) ||
      []
    );
  }

  async runExperimentUnitsQuery(
    query: string
  ): Promise<ExperimentUnitsQueryResponse> {
    return await this.runQuery(query);
  }

  getPastExperimentQuery(params: PastExperimentParams) {
    // TODO: for past experiments, UNION all exposure queries together
    const experimentQueries = (
      this.settings.queries?.exposure || []
    ).map(({ id }) => this.getExposureQuery(id));

    return format(
      `// Past Experiments
      ${experimentQueries
        .map((q, i) => {
          const hasNameCol = q.hasNameCol || false;
          return `
        let exposures${i} = (
          ${replaceKustoVars(q.query, { startDate: params.from })}
          | where ${this.castUserDateCol(
            "timestamp"
          )} > datetime(${this.toTimestamp(params.from)})
          | summarize
            exposure_query = ${this.castToString(`'${q.id}'`)},
            experiment_name = ${
              hasNameCol ? "min(experiment_name)" : "experiment_id"
            },
            variation_name = ${
              hasNameCol
                ? "min(variation_name)"
                : this.castToString("variation_id")
            },
            ['date'] = ${this.dateTrunc(this.castUserDateCol("timestamp"))},
            users = dcount(${q.userIdType})
            by
            experiment_id,
            variation_id,
            ${this.dateTrunc(this.castUserDateCol("timestamp"))}
        );`;
        })
        .join("\n")}
      let experiments = (
        union 
        ${experimentQueries.map((q, i) => `exposures${i}`).join(",")}
      );
      let userThresholds = (
        experiments
        | where users > 5
        // Skip days where a variation got 5 or fewer visitors since it's probably not real traffic
        | summarize
          experiment_name = min(experiment_name),
          variation_name = min(variation_name),
          // It's common for a small number of tracking events to continue coming in
          // long after an experiment ends, so limit to days with enough traffic
          threshold = max(users) * 0.05
        by
        exposure_query, experiment_id, variation_id
      );
      let variations = (
        experiments
        | join kind=leftouter (userThresholds) on (
          $left.exposure_query == $right.exposure_query
          and $left.experiment_id == $right.experiment_id
          and $left.variation_id == $right.variation_id
        )
        | where users > threshold
        | summarize
          experiment_name = min(experiment_name),
          variation_name = min(variation_name),
          start_date = min(date),
          end_date = max(date),
          users = sum(users)
        by exposure_query, experiment_id, variation_id
      );
    variations
    | where
      // Skip experiments at start of date range since it's likely missing data
      ${this.dateDiff(this.toTimestamp(params.from), "start_date")} > 2
    | sort by experiment_id asc, variation_id asc`,
      this.getFormatDialect()
    );
  }

  async runPastExperimentQuery(): Promise<PastExperimentQueryResponse> {
    return { rows: [] };
  }

  getMetricValueQuery(params: MetricValueParams): string {
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE(
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

    const query = format(
      `// ${params.name} - ${params.metric.name} Metric
      ${idJoinSQL}
      ${
        params.segment
          ? `let segment = (${this.getSegmentCTE(
              params.segment,
              baseIdType,
              idJoinMap
            )}),`
          : ""
      }
      let metric = (${this.getMetricCTE({
        metric: params.metric,
        baseIdType,
        idJoinMap,
        startDate: metricStart,
        endDate: metricEnd,
      })});
      let userMetric = (
        // Add in the aggregate metric value for each user
        metric
        | project
          user_id = ${baseIdType},
          value = value
        | summarize value = ${aggregate} by ${baseIdType}
      );
      let overall = (
        userMetric
        | summarize
          count = count(),
          main_sum = coalesce(sum(value), 0),
          main_sum_squares = coalesce(sum(pow(value, 2)), 0.0)
      );
      ${
        params.includeByDate
          ? `
        let userMetricDates = (
          // Add in the aggregate metric value for each user
          metric
          | summarize
            value = ${aggregate}
            by ['date'] = ${this.dateTrunc("timestamp")}, ${baseIdType}
          | sort by ['date']
        );
        let byDateOverall = (
          userMetricDates
          | summarize
            count = count(),
            main_sum = coalesce(sum(value), 0),
            main_sum_squares = coalesce(sum(pow(value, 2)), 0.0)
            by ['date']
          | sort by ['date']
        );`
          : ""
      }
      ${
        params.includeByDate
          ? `
          overall;
          byDateOverall;`
          : `
          overall;`
      }
      `,
      this.getFormatDialect()
    );

    return query;
  }

  getFormatDialect(): FormatDialect {
    return "mysql";
  }

  async runMetricValueQuery(query: string): Promise<MetricValueQueryResponse> {
    const kustoResult: any = await this.runQuery(query);

    const result: MetricValueQueryResponseRows = [];
    const overall: MetricValueQueryResponseRow = {
      date: "",
      count: 0,
      main_sum: 0,
      main_sum_squares: 0,
    };

    if (kustoResult?.tables?.[0]?.rows.length === 1) {
      const overallRow = kustoResult?.tables?.[0]?.rows?.[0];
      overall.count = parseFloat(overallRow[0]) || 0;
      overall.main_sum = parseFloat(overallRow[1]) || 0;
      overall.main_sum_squares = parseFloat(overallRow[2]) || 0;
    }
    if (kustoResult?.tables?.[1]?.rows.length > 0) {
      kustoResult?.tables?.[1]?.rows.forEach((row: any[]) => {
        result.push({
          date: this.convertDate(row[0]).toISOString(),
          count: parseFloat(row[1]) || 0,
          main_sum: parseFloat(row[2]) || 0,
          main_sum_squares: parseFloat(row[3]) || 0,
        });
      });
    }

    return { rows: [overall, ...result] };
  }

  getSourceProperties(): DataSourceProperties {
    return {
      queryLanguage: "kusto",
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
    await runApi(this.params, "?timespan=PT1M");
    return true;
  }

  getSensitiveParamKeys(): string[] {
    return [];
  }

  getExperimentResultsQuery(): string {
    throw new Error("Not implemented");
  }

  async getExperimentResults(): Promise<ExperimentQueryResponses> {
    throw new Error("Not implemented");
  }

  private getIdentitiesCTE(
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
              ${replaceKustoVars(join.query, {
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
          (${replaceKustoVars(settings.queries.pageviewsQuery, {
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

  castUserDateCol(column: string): string {
    return column;
  }

  ifElse(condition: string, ifTrue: string, ifFalse: string) {
    return `iff(${condition}, ${ifTrue}, ${ifFalse})`;
  }

  toTimestamp(date: Date) {
    return `'${date.toISOString().substr(0, 19).replace("T", " ")}'`;
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

  private capValue(cap: number | undefined, value: string) {
    if (!cap) {
      return value;
    }

    return `LEAST(${cap}, ${value})`;
  }

  private getSegmentCTE(
    segment: SegmentInterface,
    baseIdType: string,
    idJoinMap: Record<string, string>
  ) {
    const dateCol = this.castUserDateCol("['date']");

    const userIdType = segment.userIdType || "user_id";

    // Need to use an identity join table
    if (userIdType !== baseIdType) {
      return `// Segment (${segment.name})
      ${segment.sql}
      | project
        ${baseIdType},
        ['date'] = ${dateCol}
      | join kind=fullouter (${idJoinMap[userIdType]}) on ($left.${userIdType} == $right.${userIdType})
      `;
    }

    if (dateCol !== "s.date") {
      return `// Segment (${segment.name})
      ${segment.sql}
      | project
        ${userIdType},
        ['date'] = ${dateCol}
      `;
    }

    return `// Segment (${segment.name})
    ${segment.sql}
    `;
  }

  private getAggregateMetricColumn(
    metric: MetricInterface,
    metricTimeWindow: MetricAggregationType = "post"
  ) {
    // Binomial metrics don't have a value, so use hard-coded "1" as the value
    if (metric.type === "binomial") {
      return `max(${this.addPrePostTimeFilter("1", metricTimeWindow)})`;
    }

    // Custom aggregation that's a hardcoded number (e.g. "1")
    if (metric.aggregation && Number(metric.aggregation)) {
      return `max(${this.addPrePostTimeFilter(
        metric.aggregation,
        metricTimeWindow
      )})`;
    }
    // Other custom aggregation
    else if (metric.aggregation) {
      // prePostTimeFilter (and regression adjustment) not implemented for
      // custom aggregate metrics
      return this.capValue(metric.capValue, metric.aggregation);
    }
    // Standard aggregation (SUM)
    else {
      return this.capValue(
        metric.capValue,
        `sum(${this.addPrePostTimeFilter("value", metricTimeWindow)})`
      );
    }
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
    const cols = this.getMetricColumns(metric);

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

    const where: string[] = [];

    // Add a rough date filter to improve query performance
    if (startDate) {
      where.push(`${timestampCol} >= datetime(${this.toTimestamp(startDate)})`);
    }
    // endDate is now meaningful if ignoreConversionEnd
    if (endDate) {
      where.push(`${timestampCol} <= datetime(${this.toTimestamp(endDate)})`);
    }

    return `// Metric (${metric.name})
      ${replaceKustoVars(metric.sql || "", {
        startDate,
        endDate: endDate || undefined,
        experimentId,
      })}
      | project
        ${baseIdType} = ${userIdCol},
        value = ${cols.value},
        timestamp = ${timestampCol},
        conversion_start = ${this.addHours(timestampCol, conversionDelayHours)}
        ${
          ignoreConversionEnd
            ? ""
            : `, conversion_end = ${this.addHours(
                timestampCol,
                conversionDelayHours + conversionWindowHours
              )}`
        }
        ${join}
        ${where.length ? `| where ${where.join(" and ")}` : ""}
    `;
  }

  private getMetricColumns(metric: MetricInterface) {
    // Directly inputting SQL (preferred)
    const userIds: Record<string, string> = {};
    metric.userIdTypes?.forEach((userIdType) => {
      userIds[userIdType] = `${userIdType}`;
    });
    return {
      userIds: userIds,
      timestamp: `timestamp`,
      value: metric.type === "binomial" ? "1" : `value`,
    };
  }

  getSchema(): string {
    return "";
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
    return `datetime_add('${unit}', ${sign}${amount}, ${col})`;
  }

  dateTrunc(col: string) {
    return `bin(${col}, 1d)`;
  }

  // eslint-disable-next-line
  convertDate(fromDB: any): Date {
    return getValidDate(fromDB);
  }

  applyMetricOverrides(
    metric: MetricInterface,
    settings: ExperimentSnapshotSettings
  ) {
    if (!metric) return;

    const computed = settings.metricSettings.find((s) => s.id === metric.id)
      ?.computedSettings;
    if (!computed) return;

    metric.conversionDelayHours = computed.conversionDelayHours;
    metric.conversionWindowHours = computed.conversionWindowHours;
    metric.regressionAdjustmentEnabled = computed.regressionAdjustmentEnabled;
    metric.regressionAdjustmentDays = computed.regressionAdjustmentDays;
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

  private getDimensionColumn(baseIdType: string, dimension: Dimension | null) {
    const missingDimString = "__NULL_DIMENSION";
    if (!dimension) {
      return this.castToString("'All'");
    } else if (dimension.type === "activation") {
      return `max(${this.ifElse(
        `isnull(${baseIdType})`,
        "'Not Activated'",
        "'Activated'"
      )})`;
    } else if (dimension.type === "user") {
      return `coalesce(max(${this.castToString(
        "value"
      )}),'${missingDimString}')`;
    } else if (dimension.type === "date") {
      return `min(${this.formatDate(this.dateTrunc("timestamp"))})`;
    } else if (dimension.type === "experiment") {
      return `substring(
        min(
          CONCAT(substring(${this.formatDateTimeString("timestamp")}, 1, 19), 
            coalesce(${this.castToString("dimension")}, ${this.castToString(
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

  private getExperimentCTE({
    settings,
    baseIdType,
    conversionWindowHours = 0,
    conversionDelayHours = 0,
    experimentDimension = null,
    isRegressionAdjusted = false,
    regressionAdjustmentHours = 0,
    minMetricDelay = 0,
    ignoreConversionEnd = false,
  }: {
    settings: ExperimentSnapshotSettings;
    baseIdType: string;
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
      settings,
      conversionWindowHours + conversionDelayHours
    );

    const timestampColumn = this.castUserDateCol("timestamp");

    return `// Viewed Experiment
    rawExperiment
    | project
      ${baseIdType} = ${baseIdType},
      experiment_id = ${this.castToString("experiment_id")},
      variation = ${this.castToString("variation_id")},
      timestamp = ${timestampColumn},
      ${
        isRegressionAdjusted
          ? `preexposure_end = ${this.addHours(
              timestampColumn,
              minMetricDelay
            )},
            preexposure_start = ${this.addHours(
              timestampColumn,
              minMetricDelay - regressionAdjustmentHours
            )},`
          : ""
      }
      conversion_start = ${this.addHours(timestampColumn, conversionDelayHours)}
      ${experimentDimension ? `, dimension = ${experimentDimension}` : ""}
      ${
        ignoreConversionEnd
          ? ""
          : `, conversion_end = ${this.addHours(
              timestampColumn,
              conversionDelayHours + conversionWindowHours
            )}`
      }
    | where experiment_id == '${settings.experimentId}'
        and ${timestampColumn} >= datetime(${this.toTimestamp(
      settings.startDate
    )})
        ${
          endDate
            ? `and ${timestampColumn} <= datetime(${this.toTimestamp(endDate)})`
            : ""
        }
        ${settings.queryFilter ? `and (\n${settings.queryFilter}\n)` : ""}
    `;
  }

  // Only include users who entered the experiment before this timestamp
  private getExperimentEndDate(
    settings: ExperimentSnapshotSettings,
    conversionWindowHours: number
  ): Date | null {
    // If we need to wait until users have had a chance to full convert
    if (settings.skipPartialData) {
      // The last date allowed to give enough time for users to convert
      const conversionWindowEndDate = new Date();
      conversionWindowEndDate.setHours(
        conversionWindowEndDate.getHours() - conversionWindowHours
      );

      // Use the earliest of either the conversion end date or the phase end date
      return new Date(
        Math.min(settings?.endDate.getTime(), conversionWindowEndDate.getTime())
      );
    }

    // Otherwise, use the actual end date
    return settings.endDate;
  }

  castToString(col: string): string {
    return `tostring(${col})`;
  }

  private getDimensionCTE(
    dimension: DimensionInterface,
    baseIdType: string,
    idJoinMap: Record<string, string>
  ) {
    const userIdType = dimension.userIdType || "user_id";

    // Need to use an identity join table
    if (userIdType !== baseIdType) {
      return `// Dimension (${dimension.name})
      ${dimension.sql}
      | project 
          ${baseIdType},
          value
      | join kind=fullouter (${idJoinMap[userIdType]}) on ($left.${userIdType} == $right.${userIdType})
      `;
    }

    return `// Dimension (${dimension.name})
    ${dimension.sql}
    `;
  }

  private getActivatedUsersCTE(
    baseIdType: string,
    metrics: MetricInterface[],
    isRegressionAdjusted: boolean = false,
    ignoreConversionEnd: boolean = false,
    tablePrefix: string = "activationMetric",
    initialTable: string = "experiment"
  ) {
    // Note: the aliases below are needed for clickhouse
    return `
      ${initialTable}
      | project
        ${baseIdType},
        ${
          isRegressionAdjusted
            ? `
          preexposure_start,
          preexposure_end,`
            : ""
        }
        conversion_start = conversion_start
        ${ignoreConversionEnd ? "" : `, conversion_end = conversion_end`}
        ${metrics
          .map((m, i) => {
            return `| join kind=fullouter (${tablePrefix}${i}) on ($left.${baseIdType} == $right.${baseIdType})`;
          })
          .join("\n")}
      | where
        ${metrics
          .map((m, i) => {
            return `
              timestamp >= conversion_start
              ${ignoreConversionEnd ? "" : `and timestamp <= conversion_end`}`;
          })
          .join("\n and ")}`;
  }

  private getMetricConversionBase(
    col: string,
    denominatorMetrics: boolean,
    activationMetrics: boolean
  ): string {
    if (denominatorMetrics) {
      return `${col}`;
    }
    if (activationMetrics) {
      return `${col}`;
    }
    return `${col}`;
  }

  private getMetricWindowWhereClause(
    isRegressionAdjusted: boolean,
    ignoreConversionEnd: boolean
  ): string {
    const conversionWindowFilter = `
      timestamp >= conversion_start
      ${ignoreConversionEnd ? "" : `and timestamp <= conversion_end`}`;
    if (isRegressionAdjusted) {
      return `(${conversionWindowFilter}) or (timestamp >= preexposure_start and timestamp < preexposure_end)`;
    }
    return conversionWindowFilter;
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

  formatDate(col: string): string {
    return col;
  }

  formatDateTimeString(col: string): string {
    return this.castToString(col);
  }

  dateDiff(startCol: string, endCol: string) {
    return `datetime_diff('day', ${startCol}, ${endCol})`;
  }

  getTestQuery(query: string): string {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - IMPORT_LIMIT_DAYS);
    const limitedQuery = replaceKustoVars(
      `${query}
      ${this.selectSampleRows(5)}`,
      {
        startDate,
      }
    );
    const finalQuery = format(limitedQuery, this.getFormatDialect());
    return finalQuery;
  }

  async runTestQuery(kql: string): Promise<TestQueryResult> {
    const queryStartTime = Date.now();
    const kustoResult = await this.runQuery(kql);
    const queryEndTime = Date.now();
    const duration = queryEndTime - queryStartTime;
    const results = kustoResult?.tables[0].rows.map((row: any) => {
      const mapped: any = {};
      kustoResult?.tables[0].columns.forEach((column: any, index: number) => {
        mapped[column.name] = row[index];
      });
      return mapped;
    });
    return { results, duration };
  }

  selectSampleRows(limit: number): string {
    return `| take ${limit}`;
  }
}
