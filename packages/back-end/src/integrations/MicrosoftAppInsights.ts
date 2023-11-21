import cloneDeep from "lodash/cloneDeep";
import { dateStringArrayBetweenDates, getValidDate } from "shared/dates";
import {
  ExperimentMetricInterface,
  getConversionWindowHours,
  getUserIdTypes,
  isBinomialMetric,
  isFactMetric,
  isFunnelMetric,
  isRatioMetric,
} from "shared/experiments";
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
  ProcessedDimensions,
  UserDimension,
  ExperimentDimension,
  ExperimentAggregateUnitsQueryParams,
  ExperimentAggregateUnitsQueryResponse,
} from "../types/Integration";
import { MicrosoftAppInsightsParams } from "../../types/integrations/microsoftappinsights";
import { decryptDataSourceParams } from "../services/datasource";
import {
  DataSourceProperties,
  DataSourceSettings,
  DataSourceType,
  ExposureQuery,
} from "../../types/datasource";
import { IMPORT_LIMIT_DAYS } from "../util/secrets";
import { SegmentInterface } from "../../types/segment";
import {
  getBaseIdTypeAndJoins,
  replaceKustoVars,
  format,
  FormatDialect,
} from "../util/kusto";
import { MetricInterface } from "../../types/metric";
import { ExperimentSnapshotSettings } from "../../types/experiment-snapshot";
import { DimensionInterface } from "../../types/dimension";

import { runApi } from "../services/microsoftappinsights";
import { FactTableMap } from "../models/FactTableModel";
import { replaceCountStar } from "../util/sql";

export const MAX_ROWS_UNIT_AGGREGATE_QUERY = 3000;

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
    metric: ExperimentMetricInterface,
    ignoreConversionEnd: boolean
  ): string {
    const conversionDelayHours = metric.conversionDelayHours ?? 0;
    const conversionWindowHours = getConversionWindowHours(metric);
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

  processDimensions(
    dimensions: Dimension[],
    settings: ExperimentSnapshotSettings,
    activationMetric: ExperimentMetricInterface | null
  ): ProcessedDimensions {
    const processedDimensions: ProcessedDimensions = {
      unitDimensions: [],
      experimentDimensions: [],
      activationDimension: null,
    };
    dimensions.forEach((dimension) => {
      if (dimension?.type === "activation") {
        if (activationMetric) {
          processedDimensions.activationDimension = { type: "activation" };
        }
      } else if (dimension?.type === "user") {
        // Replace any placeholders in the user defined dimension SQL
        const clonedDimension = cloneDeep<UserDimension>(dimension);
        clonedDimension.dimension.sql = replaceKustoVars(
          dimension.dimension.sql,
          {
            startDate: settings.startDate,
            endDate: settings.endDate,
            experimentId: settings.experimentId,
          }
        );
        processedDimensions.unitDimensions.push(clonedDimension);
      } else if (dimension?.type === "experiment") {
        processedDimensions.experimentDimensions.push(dimension);
      }
    });
    return processedDimensions;
  }

  getExperimentAggregateUnitsQuery(
    params: ExperimentAggregateUnitsQueryParams
  ): string {
    const {
      activationMetric,
      segment,
      settings,
      factTableMap,
      useUnitsTable,
    } = params;

    // unitDimensions not supported yet
    const { experimentDimensions } = this.processDimensions(
      params.dimensions,
      settings,
      activationMetric
    );

    const exposureQuery = this.getExposureQuery(settings.exposureQueryId || "");

    // Get any required identity join queries
    const { baseIdType, idJoinSQL } = this.getIdentitiesCTE(
      // add idTypes usually handled in units query here in the case where
      // we don't have a separate table for the units query
      // then for this query we just need the activation metric for activation
      // dimensions
      [
        [exposureQuery.userIdType],
        !useUnitsTable && activationMetric
          ? getUserIdTypes(activationMetric, factTableMap)
          : [],
        !useUnitsTable && segment ? [segment.userIdType || "user_id"] : [],
      ],
      settings.startDate,
      settings.endDate,
      exposureQuery.userIdType,
      settings.experimentId
    );

    return format(
      `-- Traffic Query for Health Tab
    WITH
      ${idJoinSQL}
      ${
        !useUnitsTable
          ? `${this.getExperimentUnitsQuery({
              ...params,
              includeIdJoins: false,
            })},`
          : ""
      }
      __distinctUnits AS (
        SELECT
          ${baseIdType}
          , variation
          , ${this.formatDate(
            this.dateTrunc("first_exposure_timestamp")
          )} AS dim_exposure_date
          ${experimentDimensions.map((d) => `, dim_exp_${d.id}`).join("\n")}
          ${
            activationMetric
              ? `, ${this.ifElse(
                  `first_activation_timestamp IS NULL`,
                  "'Not Activated'",
                  "'Activated'"
                )} AS dim_activated`
              : ""
          }
        FROM ${
          useUnitsTable ? `${params.unitsTableFullName}` : "__experimentUnits"
        }
      )
      -- One row per variation per dimension slice
      ${[
        "dim_exposure_date",
        ...experimentDimensions.map((d) => `dim_exp_${d.id}`),
        ...(activationMetric ? ["dim_activated"] : []),
      ]
        .map((d) =>
          this.getUnitCountCTE(
            d,
            activationMetric && d !== "dim_activated"
              ? "WHERE dim_activated = 'Activated'"
              : ""
          )
        )
        .join("\nUNION ALL\n")}
      LIMIT ${MAX_ROWS_UNIT_AGGREGATE_QUERY}
    `,
      this.getFormatDialect()
    );
  }

  getUnitCountCTE(dimensionColumn: string, whereClause: string): string {
    return ` -- ${dimensionColumn}
    (SELECT
      d.variation AS variation
      , d.${dimensionColumn} as dimension_value
      , MAX('${dimensionColumn}') as dimension_name
      , COUNT(*) AS units
    FROM
      __distinctUnits d
    ${whereClause}
    GROUP BY
      d.variation
      , d.${dimensionColumn})`;
  }

  getExperimentUnitsQuery(params: ExperimentUnitsQueryParams): string {
    const {
      settings,
      segment,
      activationMetric: activationMetricDoc,
      factTableMap,
    } = params;

    const activationMetric = this.processActivationMetric(
      activationMetricDoc,
      settings
    );

    const { experimentDimensions, unitDimensions } = this.processDimensions(
      params.dimensions,
      settings,
      activationMetric
    );

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
        activationMetric ? getUserIdTypes(activationMetric, factTableMap) : [],
        ...unitDimensions.map((d) => [d.dimension.userIdType || "user_id"]),
        segment ? [segment.userIdType || "user_id"] : [],
      ],
      settings.startDate,
      settings.endDate,
      exposureQuery.userIdType,
      settings.experimentId
    );

    // Get date range for experiment
    const startDate: Date = settings.startDate;
    const endDate: Date | null = this.getExperimentEndDate(settings, 0);

    const timestampColumn = "e.timestamp";
    // BQ datetime cast for SELECT statements (do not use for where)
    const timestampDateTimeColumn = this.castUserDateCol(timestampColumn);
    let ignoreConversionEnd =
      settings.attributionModel === "experimentDuration";

    // If the fact metric doesn't have a conversion window, always treat like Experiment Duration
    if (
      activationMetric &&
      isFactMetric(activationMetric) &&
      !activationMetric.hasConversionWindow
    ) {
      ignoreConversionEnd = true;
    }

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
        ${experimentDimensions
          .map((d) => `, e.${d.id} AS dim_${d.id}`)
          .join("\n")}
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
            factTableMap,
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
    ${unitDimensions
      .map(
        (d) =>
          `, __dim_unit_${d.dimension.id} as (${this.getDimensionCTE(
            d.dimension,
            baseIdType,
            idJoinMap
          )})`
      )
      .join("\n")}
    , __experimentUnits AS (
      -- One row per user
      SELECT
        e.${baseIdType} AS ${baseIdType},
        , ${this.ifElse(
          "count(distinct e.variation) > 1",
          "'__multiple__'",
          "max(e.variation)"
        )} AS variation
        , MIN(${timestampColumn}) AS first_exposure_timestamp
        ${unitDimensions
          .map(
            (d) => `
          , ${this.getDimensionColumn(baseIdType, d)} AS dim_unit_${
              d.dimension.id
            }`
          )
          .join("\n")}
        ${experimentDimensions
          .map(
            (d) => `
          , ${this.getDimensionColumn(baseIdType, d)} AS dim_exp_${d.id}`
          )
          .join("\n")}
        
        ${
          activationMetric
            ? `, MIN(${this.ifElse(
                this.getConversionWindowClause(
                  "e.timestamp",
                  "a.timestamp",
                  activationMetric,
                  ignoreConversionEnd
                ),
                "a.timestamp",
                "NULL"
              )}) AS first_activation_timestamp
            `
            : ""
        }
      FROM
        __experimentExposures e
        ${
          segment
            ? `JOIN __segment s ON (s.${baseIdType} = e.${baseIdType})`
            : ""
        }
        ${unitDimensions
          .map(
            (d) => `
            LEFT JOIN __dim_unit_${d.dimension.id} __dim_unit_${d.dimension.id} ON (
              __dim_unit_${d.dimension.id}.${baseIdType} = e.${baseIdType}
            )
          `
          )
          .join("\n")}
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

  processActivationMetric(
    activationMetricDoc: null | ExperimentMetricInterface,
    settings: ExperimentSnapshotSettings
  ): null | ExperimentMetricInterface {
    let activationMetric: null | ExperimentMetricInterface = null;
    if (activationMetricDoc) {
      activationMetric = cloneDeep<ExperimentMetricInterface>(
        activationMetricDoc
      );
      this.applyMetricOverrides(activationMetric, settings);
    }
    return activationMetric;
  }
  private getMetricQueryFormat(metric: MetricInterface) {
    return metric.queryFormat || (metric.sql ? "sql" : "builder");
  }

  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string {
    const {
      metric: metricDoc,
      denominatorMetrics: denominatorMetricsDocs,
      activationMetric: activationMetricDoc,
      settings,
      segment,
    } = params;

    const factTableMap = params.factTableMap;

    // clone the metrics before we mutate them
    const metric = cloneDeep<ExperimentMetricInterface>(metricDoc);
    let denominatorMetrics = cloneDeep<ExperimentMetricInterface[]>(
      denominatorMetricsDocs
    );
    const activationMetric = this.processActivationMetric(
      activationMetricDoc,
      settings
    );

    // Fact metrics are self-contained, so they don't need to reference other metrics for the denominator
    if (isFactMetric(metric)) {
      denominatorMetrics = [];
      if (isRatioMetric(metric)) {
        denominatorMetrics.push(metric);
      }
    }

    this.applyMetricOverrides(metric, settings);
    denominatorMetrics.forEach((m) => this.applyMetricOverrides(m, settings));

    // Replace any placeholders in the user defined dimension SQL
    const { unitDimensions } = this.processDimensions(
      params.dimensions,
      settings,
      activationMetric
    );

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
    const ratioMetric = isRatioMetric(metric, denominator);
    const funnelMetric = isFunnelMetric(metric, denominator);

    const cumulativeDate = false; // TODO enable flag for time series

    // redundant checks to make sure configuration makes sense and we only build expensive queries for the cases
    // where RA is actually possible
    const isRegressionAdjusted =
      settings.regressionAdjustmentEnabled &&
      (metric.regressionAdjustmentDays ?? 0) > 0 &&
      !!metric.regressionAdjustmentEnabled &&
      !ratioMetric;

    const regressionAdjustmentHours = isRegressionAdjusted
      ? (metric.regressionAdjustmentDays ?? 0) * 24
      : 0;

    let ignoreConversionEnd =
      settings.attributionModel === "experimentDuration";

    // If a fact metric has disabled conversion windows, always use "Experiment Duration"
    if (isFactMetric(metric) && !metric.hasConversionWindow) {
      ignoreConversionEnd = true;
    }

    // Get capping settings and final coalesce statement
    const isPercentileCapped =
      metric.capping === "percentile" && metric.capValue && metric.capValue < 1;
    const denominatorIsPercentileCapped =
      denominator &&
      denominator.capping === "percentile" &&
      denominator.capValue &&
      denominator.capValue < 1;
    const capCoalesceMetric = this.capCoalesceValue("m.value", metric, "cap");
    const capCoalesceDenominator = this.capCoalesceValue(
      "d.value",
      denominator,
      "capd"
    );
    const capCoalesceCovariate = this.capCoalesceValue(
      "c.value",
      metric,
      "cap"
    );

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
      getUserIdTypes(metric, factTableMap),
      ...denominatorMetrics.map((m) => getUserIdTypes(m, factTableMap, true)),
    ];
    // add idTypes usually handled in units query here in the case where
    // we don't have a separate table for the units query
    if (!params.useUnitsTable) {
      idTypeObjects.push(
        ...unitDimensions.map((d) => [d.dimension.userIdType || "user_id"]),
        segment ? [segment.userIdType || "user_id"] : [],
        activationMetric ? getUserIdTypes(activationMetric, factTableMap) : []
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

    const initialMetric =
      denominatorMetrics.length > 0 ? denominatorMetrics[0] : metric;

    // Get date range for experiment and analysis
    const initialConversionWindowHours = getConversionWindowHours(
      initialMetric
    );
    const initialConversionDelayHours = initialMetric.conversionDelayHours || 0;

    const startDate: Date = settings.startDate;
    const endDate: Date = this.getExperimentEndDate(
      settings,
      initialConversionWindowHours + initialConversionDelayHours
    );

    if (params.dimensions.length > 1) {
      throw new Error(
        "Multiple dimensions not supported in metric analysis yet. Please contact GrowthBook."
      );
    }
    const dimension = params.dimensions[0];
    let dimensionCol = this.castToString("'All'");
    if (dimension?.type === "experiment") {
      dimensionCol = `dim_exp_${dimension.id}`;
    } else if (dimension?.type === "user") {
      dimensionCol = `dim_unit_${dimension.dimension.id}`;
    } else if (dimension?.type === "date") {
      dimensionCol = `${this.formatDate(
        this.dateTrunc("first_exposure_timestamp")
      )}`;
    } else if (dimension?.type === "activation") {
      dimensionCol = this.ifElse(
        `first_activation_timestamp IS NULL`,
        "'Not Activated'",
        "'Activated'"
      );
    }

    const timestampColumn =
      activationMetric && dimension?.type !== "activation"
        ? "first_activation_timestamp"
        : "first_exposure_timestamp";

    const distinctUsersWhere: string[] = [];
    if (activationMetric && dimension?.type !== "activation") {
      distinctUsersWhere.push("first_activation_timestamp IS NOT NULL");
    }
    if (settings.skipPartialData) {
      distinctUsersWhere.push(
        `${timestampColumn} <= ${this.toTimestamp(endDate)}`
      );
    }

    return format(
      `-- ${metric.name} (${
        isFactMetric(metric) ? metric.metricType : metric.type
      })
    WITH
      ${idJoinSQL}
      ${
        !params.useUnitsTable
          ? `${this.getExperimentUnitsQuery({
              ...params,
              includeIdJoins: false,
            })},`
          : ""
      }
      __distinctUsers AS (
        SELECT
          ${baseIdType},
          ${dimensionCol} AS dimension,
          variation,
          ${timestampColumn} AS timestamp,
          ${this.dateTrunc("first_exposure_timestamp")} AS first_exposure_date
          ${
            isRegressionAdjusted
              ? `, ${this.addHours(
                  "first_exposure_timestamp",
                  minMetricDelay
                )} AS preexposure_end
                , ${this.addHours(
                  "first_exposure_timestamp",
                  minMetricDelay - regressionAdjustmentHours
                )} AS preexposure_start`
              : ""
          }
        FROM ${
          params.useUnitsTable
            ? `${params.unitsTableFullName}`
            : "__experimentUnits"
        }
        ${
          distinctUsersWhere.length
            ? `WHERE ${distinctUsersWhere.join(" AND ")}`
            : ""
        }
      )
      , __metric as (${this.getMetricCTE({
        metric,
        baseIdType,
        idJoinMap,
        startDate: metricStart,
        endDate: metricEnd,
        experimentId: settings.experimentId,
        factTableMap,
      })})
      ${denominatorMetrics
        .map((m, i) => {
          return `, __denominator${i} as (${this.getMetricCTE({
            metric: m,
            baseIdType,
            idJoinMap,
            startDate: metricStart,
            endDate: metricEnd,
            experimentId: settings.experimentId,
            factTableMap,
            useDenominator: true,
          })})`;
        })
        .join("\n")}
      ${
        funnelMetric
          ? `, __denominatorUsers as (${this.getFunnelUsersCTE(
              baseIdType,
              denominatorMetrics,
              isRegressionAdjusted,
              ignoreConversionEnd,
              "__denominator",
              "__distinctUsers"
            )})`
          : ""
      }
      ${
        cumulativeDate
          ? `, __dateRange AS (
        ${this.getDateTable(
          dateStringArrayBetweenDates(startDate, endDate || new Date())
        )}
      )`
          : ""
      }
      , __userMetricJoin as (
        SELECT
          d.variation AS variation,
          d.dimension AS dimension,
          ${cumulativeDate ? `dr.day AS day,` : ""}
          d.${baseIdType} AS ${baseIdType},
          ${this.addCaseWhenTimeFilter(
            "m.value",
            metric,
            ignoreConversionEnd,
            cumulativeDate
          )} as value
        FROM
          ${funnelMetric ? "__denominatorUsers" : "__distinctUsers"} d
        LEFT JOIN __metric m ON (
          m.${baseIdType} = d.${baseIdType}
        )
        ${
          cumulativeDate
            ? `
            CROSS JOIN __dateRange dr
            WHERE d.first_exposure_date <= dr.day
          `
            : ""
        }
      )
      , __userMetricAgg as (
        -- Add in the aggregate metric value for each user
        SELECT
          variation,
          dimension,
          ${cumulativeDate ? "day," : ""}
          ${baseIdType},
          ${this.getAggregateMetricColumn(metric)} as value
        FROM
          __userMetricJoin
        GROUP BY
          variation,
          dimension,
          ${cumulativeDate ? "day," : ""}
          ${baseIdType}
      )
      ${
        isPercentileCapped
          ? `
        , __capValue AS (
            ${this.percentileCapSelectClause(
              metric.capValue ?? 1,
              "__userMetricAgg"
            )}
        )
        `
          : ""
      }
      ${
        ratioMetric
          ? `, __userDenominatorAgg AS (
              SELECT
                d.variation AS variation,
                d.dimension AS dimension,
                ${cumulativeDate ? `dr.day AS day,` : ""}
                d.${baseIdType} AS ${baseIdType},
                ${this.getAggregateMetricColumn(denominator, true)} as value
              FROM
                __distinctUsers d
                JOIN __denominator${denominatorMetrics.length - 1} m ON (
                  m.${baseIdType} = d.${baseIdType}
                )
                ${cumulativeDate ? "CROSS JOIN __dateRange dr" : ""}
              WHERE
                ${this.getConversionWindowClause(
                  "d.timestamp",
                  "m.timestamp",
                  denominator,
                  ignoreConversionEnd
                )}
                ${
                  cumulativeDate
                    ? `AND ${this.castToDate(
                        "m.timestamp"
                      )} <= dr.day AND d.first_exposure_date <= dr.day`
                    : ""
                }
              GROUP BY
                d.variation,
                d.dimension,
                ${cumulativeDate ? `dr.day,` : ""}
                d.${baseIdType}
            )
            ${
              denominatorIsPercentileCapped
                ? `
              , __capValueDenominator AS (
                ${this.percentileCapSelectClause(
                  denominator.capValue ?? 1,
                  "__userDenominatorAgg"
                )}
              )
              `
                : ""
            }`
          : ""
      }
      ${
        isRegressionAdjusted
          ? `
        , __userCovariateMetric as (
          SELECT
            d.variation AS variation,
            d.dimension AS dimension,
            d.${baseIdType} AS ${baseIdType},
            ${this.getAggregateMetricColumn(metric)} as value
          FROM
            __distinctUsers d
          JOIN __metric m ON (
            m.${baseIdType} = d.${baseIdType}
          )
          WHERE 
            m.timestamp >= d.preexposure_start
            AND m.timestamp < d.preexposure_end
          GROUP BY
            d.variation,
            d.dimension,
            d.${baseIdType}
        )
        `
          : ""
      }
      -- One row per variation/dimension with aggregations
      SELECT
        m.variation AS variation,
        ${
          cumulativeDate ? `${this.formatDate("m.day")}` : "m.dimension"
        } AS dimension,
        COUNT(*) AS users,
        '${this.getStatisticType(
          ratioMetric,
          isRegressionAdjusted
        )}' as statistic_type,
        '${
          isBinomialMetric(metric) ? "binomial" : "count"
        }' as main_metric_type,
        ${
          isPercentileCapped
            ? "MAX(COALESCE(cap.cap_value, 0)) as main_cap_value,"
            : ""
        }
        SUM(${capCoalesceMetric}) AS main_sum,
        SUM(POWER(${capCoalesceMetric}, 2)) AS main_sum_squares
        ${
          ratioMetric
            ? `,
          '${
            isBinomialMetric(denominator) ? "binomial" : "count"
          }' as denominator_metric_type,
          ${
            denominatorIsPercentileCapped
              ? "MAX(COALESCE(capd.cap_value, 0)) as denominator_cap_value,"
              : ""
          }
          SUM(${capCoalesceDenominator}) AS denominator_sum,
          SUM(POWER(${capCoalesceDenominator}, 2)) AS denominator_sum_squares,
          SUM(${capCoalesceDenominator} * ${capCoalesceMetric}) AS main_denominator_sum_product
        `
            : ""
        }
        ${
          isRegressionAdjusted
            ? `,
          '${
            isBinomialMetric(metric) ? "binomial" : "count"
          }' as covariate_metric_type,
          SUM(${capCoalesceCovariate}) AS covariate_sum,
          SUM(POWER(${capCoalesceCovariate}, 2)) AS covariate_sum_squares,
          SUM(${capCoalesceMetric} * ${capCoalesceCovariate}) AS main_covariate_sum_product
          `
            : ""
        }
      FROM
        __userMetricAgg m
      ${
        ratioMetric
          ? `LEFT JOIN __userDenominatorAgg d ON (
              d.${baseIdType} = m.${baseIdType}
              ${cumulativeDate ? "AND d.day = m.day" : ""}
            )
            ${
              denominatorIsPercentileCapped
                ? "CROSS JOIN __capValueDenominator capd"
                : ""
            }`
          : ""
      }
      ${
        isRegressionAdjusted
          ? `
          LEFT JOIN __userCovariateMetric c
          ON (c.${baseIdType} = m.${baseIdType})
          `
          : ""
      }
      ${isPercentileCapped ? `CROSS JOIN __capValue cap` : ""}
      ${
        "ignoreNulls" in metric && metric.ignoreNulls
          ? `WHERE m.value != 0`
          : ""
      }
      GROUP BY
        m.variation,
        ${cumulativeDate ? `${this.formatDate("m.day")}` : "m.dimension"}
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

  async runExperimentAggregateUnitsQuery(
    query: string
  ): Promise<ExperimentAggregateUnitsQueryResponse> {
    const kustoResult = await this.runQuery(query);
    return {
      rows: (kustoResult?.tables?.[0]?.rows || []).map((row: any) => {
        return {
          variation: row.variation ?? "",
          units: parseInt(row.units) || 0,
          dimension_value: row.dimension_value ?? "",
          dimension_name: row.dimension_name ?? "",
        };
      }),
    };
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

    const aggregate = this.getAggregateMetricColumn(params.metric);

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
        // Facts tables are not supported for this query yet
        factTableMap: new Map(),
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

  castToDate(col: string): string {
    return `CAST(${col} AS DATE)`;
  }

  ensureFloat(col: string): string {
    return col;
  }

  getSensitiveParamKeys(): string[] {
    return [];
  }

  percentileCapSelectClause(capPercentile: number, metricTable: string) {
    return `
      SELECT
        PERCENTILE_CONT(${capPercentile}) WITHIN GROUP (ORDER BY value) AS cap_value
      FROM ${metricTable}
      WHERE value IS NOT NULL
      `;
  }

  private capCoalesceValue(
    valueCol: string,
    metric: ExperimentMetricInterface,
    capTablePrefix: string = "c"
  ): string {
    if (metric?.capping === "absolute" && metric.capValue) {
      return `LEAST(
        ${this.ensureFloat(`COALESCE(${valueCol}, 0)`)},
        ${metric.capValue}
      )`;
    }
    if (
      metric?.capping === "percentile" &&
      metric.capValue &&
      metric.capValue < 1
    ) {
      return `LEAST(
        ${this.ensureFloat(`COALESCE(${valueCol}, 0)`)},
        ${capTablePrefix}.cap_value
      )`;
    }
    return `COALESCE(${valueCol}, 0)`;
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

  private getFunnelUsersCTE(
    baseIdType: string,
    metrics: ExperimentMetricInterface[],
    isRegressionAdjusted: boolean = false,
    ignoreConversionEnd: boolean = false,
    tablePrefix: string = "__denominator",
    initialTable: string = "__experiment"
  ) {
    // Note: the aliases below are needed for clickhouse
    return `
      -- one row per user
      SELECT
        initial.${baseIdType} AS ${baseIdType},
        MIN(initial.dimension) AS dimension,
        MIN(initial.variation) AS variation,
        MIN(initial.first_exposure_date) AS first_exposure_date,
        ${
          isRegressionAdjusted
            ? `
            MIN(initial.preexposure_start) AS preexposure_start,
            MIN(initial.preexposure_end) AS preexposure_end,`
            : ""
        }
        MIN(t${metrics.length - 1}.timestamp) AS timestamp
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
            return this.getConversionWindowClause(
              `${prevAlias}.timestamp`,
              `${alias}.timestamp`,
              m,
              ignoreConversionEnd
            );
          })
          .join("\n AND ")}
      GROUP BY
        initial.${baseIdType}`;
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

  private getMetricMinDelay(metrics: ExperimentMetricInterface[]) {
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
    metrics: ExperimentMetricInterface[],
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
        getConversionWindowHours(m) +
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
    metric: ExperimentMetricInterface,
    useDenominator?: boolean
  ) {
    // Fact Metrics
    if (isFactMetric(metric)) {
      const columnRef = useDenominator ? metric.denominator : metric.numerator;
      if (
        metric.metricType === "proportion" ||
        columnRef?.column === "$$distinctUsers"
      ) {
        return `MAX(COALESCE(value, 0))`;
      } else if (columnRef?.column === "$$count") {
        return `COUNT(value)`;
      } else {
        return `SUM(COALESCE(value, 0))`;
      }
    }

    // Non-fact Metrics

    // Binomial metrics don't have a value, so use hard-coded "1" as the value
    if (metric.type === "binomial") {
      return `MAX(COALESCE(value, 0))`;
    }

    // SQL editor
    if (this.getMetricQueryFormat(metric) === "sql") {
      // Custom aggregation that's a hardcoded number (e.g. "1")
      if (metric.aggregation && Number(metric.aggregation)) {
        // Note that if user has conversion row but value IS NULL, this will
        // return 0 for that user rather than `metric.aggregation`
        return this.ifElse("value IS NOT NULL", metric.aggregation, "0");
      }
      // Other custom aggregation
      else if (metric.aggregation) {
        return replaceCountStar(metric.aggregation, `value`);
      }
      // Standard aggregation (SUM)
      else {
        return `SUM(COALESCE(value, 0))`;
      }
    }
    // Query builder
    else {
      // Count metrics that specify a distinct column to count
      if (metric.type === "count" && metric.column) {
        return `COUNT(DISTINCT (value))`;
      }
      // Count metrics just do a simple count of rows by default
      else if (metric.type === "count") {
        return `COUNT(value)`;
      }
      // Revenue and duration metrics use MAX by default
      else {
        return `MAX(COALESCE(value, 0))`;
      }
    }
  }

  getDateTable(dateArray: string[]): string {
    const dateString = dateArray
      .map((d) => `SELECT ${d} AS day`)
      .join("\nUNION ALL\n");
    return `
      SELECT ${this.dateTrunc(this.castToDate("t.day"))} AS day
      FROM
        (
          ${dateString}
        ) t
     `;
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
    factTableMap,
    useDenominator,
  }: {
    metric: ExperimentMetricInterface;
    conversionWindowHours?: number;
    conversionDelayHours?: number;
    ignoreConversionEnd?: boolean;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    startDate: Date;
    endDate: Date | null;
    experimentId?: string;
    factTableMap: FactTableMap;
    useDenominator?: boolean;
  }) {
    const cols = this.getMetricColumns(
      metric,
      factTableMap,
      "m",
      useDenominator
    );

    // Determine the identifier column to select from
    let userIdCol = cols.userIds[baseIdType] || "user_id";
    let join = "";

    const userIdTypes = getUserIdTypes(metric, factTableMap, useDenominator);

    const isFact = isFactMetric(metric);
    const queryFormat = isFact ? "fact" : this.getMetricQueryFormat(metric);
    const columnRef = isFact
      ? useDenominator
        ? metric.denominator
        : metric.numerator
      : null;

    // For fact metrics with a WHERE clause
    const factTable = isFact
      ? factTableMap.get(columnRef?.factTableId || "")
      : undefined;

    if (isFact && !factTable) {
      throw new Error("Could not find fact table");
    }

    if (userIdTypes.includes(baseIdType)) {
      userIdCol = baseIdType;
    } else if (userIdTypes.length > 0) {
      for (let i = 0; i < userIdTypes.length; i++) {
        const userIdType: string = userIdTypes[i];
        if (userIdType in idJoinMap) {
          userIdCol = `i.${baseIdType}`;
          join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = m.${userIdType})`;
          break;
        }
      }
    }

    // BQ datetime cast for SELECT statements (do not use for where)
    const timestampDateTimeColumn = this.castUserDateCol(cols.timestamp);

    const where: string[] = [];
    let sql = "";

    // Add filters from the Metric
    if (isFact && factTable && columnRef) {
      const filterIds: Set<string> = new Set();
      if (columnRef.filters) {
        columnRef.filters.forEach((f) => filterIds.add(f));
      }
      filterIds.forEach((filterId) => {
        const filter = factTable.filters.find((f) => f.id === filterId);
        if (filter) {
          where.push(filter.value);
        }
      });

      sql = factTable.sql;
    }

    if (!isFact && queryFormat === "sql") {
      sql = metric.sql || "";
    }

    // Add a rough date filter to improve query performance
    if (startDate) {
      where.push(
        `${timestampDateTimeColumn} >= datetime(${this.toTimestamp(startDate)})`
      );
    }
    // endDate is now meaningful if ignoreConversionEnd
    if (endDate) {
      where.push(
        `${timestampDateTimeColumn} <= datetime(${this.toTimestamp(endDate)})`
      );
    }

    return `// Metric (${metric.name})
      ${replaceKustoVars(sql || "", {
        startDate,
        endDate: endDate || undefined,
        experimentId,
      })}
      | project
        ${baseIdType} = ${userIdCol},
        value = ${cols.value},
        timestamp = ${timestampDateTimeColumn},
        conversion_start = ${this.addHours(
          timestampDateTimeColumn,
          conversionDelayHours
        )}
        ${
          ignoreConversionEnd
            ? ""
            : `, conversion_end = ${this.addHours(
                timestampDateTimeColumn,
                conversionDelayHours + conversionWindowHours
              )}`
        }
        ${join}
        ${where.length ? `| where ${where.join(" and ")}` : ""}
    `;
  }

  private getMetricColumns(
    metric: ExperimentMetricInterface,
    factTableMap: FactTableMap,
    alias = "m",
    useDenominator?: boolean
  ) {
    if (isFactMetric(metric)) {
      const userIds: Record<string, string> = {};
      getUserIdTypes(metric, factTableMap, useDenominator).forEach(
        (userIdType) => {
          userIds[userIdType] = `${alias}.${userIdType}`;
        }
      );

      const columnRef = useDenominator ? metric.denominator : metric.numerator;

      const value =
        metric.metricType === "proportion" ||
        !columnRef ||
        columnRef.column === "$$distinctUsers" ||
        columnRef.column === "$$count"
          ? "1"
          : `${alias}.${columnRef.column}`;

      return {
        userIds,
        timestamp: `${alias}.timestamp`,
        value,
      };
    }

    // Directly inputting SQL (preferred)
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
    metric: ExperimentMetricInterface,
    settings: ExperimentSnapshotSettings
  ) {
    if (!metric) return;

    const computed = settings.metricSettings.find((s) => s.id === metric.id)
      ?.computedSettings;
    if (!computed) return;

    metric.conversionDelayHours = computed.conversionDelayHours;

    if (isFactMetric(metric)) {
      metric.conversionWindowUnit = "hours";
      metric.conversionWindowValue = computed.conversionWindowHours;
    } else {
      metric.conversionWindowHours = computed.conversionWindowHours;
    }

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

  private getDimensionColumn(
    baseIdType: string,
    dimension: UserDimension | ExperimentDimension | null
  ) {
    const missingDimString = "__NULL_DIMENSION";
    if (!dimension) {
      return this.castToString("'All'");
    } else if (dimension.type === "user") {
      return `COALESCE(MAX(${this.castToString(
        `__dim_unit_${dimension.dimension.id}.value`
      )}),'${missingDimString}')`;
    } else if (dimension.type === "experiment") {
      return `SUBSTRING(
        MIN(
          CONCAT(SUBSTRING(${this.formatDateTimeString("e.timestamp")}, 1, 19), 
            coalesce(${this.castToString(
              `e.dim_${dimension.id}`
            )}, ${this.castToString(`'${missingDimString}'`)})
          )
        ),
        20, 
        99999
      )`;
    }

    throw new Error("Unknown dimension type: " + (dimension as Dimension).type);
  }

  // Only include users who entered the experiment before this timestamp
  private getExperimentEndDate(
    settings: ExperimentSnapshotSettings,
    conversionWindowHours: number
  ): Date {
    // If we need to wait until users have had a chance to fully convert
    if (settings.skipPartialData) {
      // The last date allowed to give enough time for users to convert
      const conversionWindowEndDate = new Date();
      conversionWindowEndDate.setHours(
        conversionWindowEndDate.getHours() - conversionWindowHours
      );

      // Use the earliest of either the conversion end date or the phase end date
      return new Date(
        Math.min(settings.endDate.getTime(), conversionWindowEndDate.getTime())
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

  private addCaseWhenTimeFilter(
    col: string,
    metric: ExperimentMetricInterface,
    ignoreConversionEnd: boolean,
    cumulativeDate: boolean
  ): string {
    return `${this.ifElse(
      `
        ${this.getConversionWindowClause(
          "d.timestamp",
          "m.timestamp",
          metric,
          ignoreConversionEnd
        )}
        ${
          cumulativeDate ? `AND ${this.dateTrunc("m.timestamp")} <= dr.day` : ""
        }
      `,
      `${col}`,
      `NULL`
    )}`;
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
