import bs58 from "bs58";
import cloneDeep from "lodash/cloneDeep";
import { getValidDate } from "shared/dates";
import normal from "@stdlib/stats/base/dists/normal";
import { format as formatDate, subDays } from "date-fns";
import {
  getMetricWindowHours,
  getUserIdTypes,
  isFactMetric,
  isFunnelMetric,
  isRatioMetric,
  isRegressionAdjusted,
  ExperimentMetricInterface,
  getMetricTemplateVariables,
  quantileMetricType,
  getColumnRefWhereClause,
  getAggregateFilters,
  isBinomialMetric,
  getDelayWindowHours,
  getColumnExpression,
  isCappableMetricType,
  getFactTableTemplateVariables,
  isPercentileCappedMetric,
  parseSliceMetricId,
  eligibleForUncappedMetric,
} from "shared/experiments";
import {
  AUTOMATIC_DIMENSION_OTHER_NAME,
  DEFAULT_TEST_QUERY_DAYS,
  DEFAULT_METRIC_HISTOGRAM_BINS,
  BANDIT_SRM_DIMENSION_NAME,
  SAFE_ROLLOUT_TRACKING_KEY_PREFIX,
  NULL_DIMENSION_VALUE,
} from "shared/constants";
import { PIPELINE_MODE_SUPPORTED_DATA_SOURCE_TYPES } from "shared/enterprise";
import {
  ensureLimit,
  format,
  isMultiStatementSQL,
  SQL_ROW_LIMIT,
} from "shared/sql";
import {
  PhaseSQLVar,
  SQLVars,
  TemplateVariables,
  FormatDialect,
} from "shared/types/sql";
import { SegmentInterface } from "shared/types/segment";
import {
  MetricValueParams,
  ExperimentMetricQueryParams,
  PastExperimentParams,
  PastExperimentQueryResponse,
  ExperimentMetricQueryResponse,
  ExperimentMetricQueryResponseRows,
  MetricValueQueryResponse,
  MetricValueQueryResponseRow,
  ExperimentQueryResponses,
  Dimension,
  TestQueryResult,
  InformationSchema,
  RawInformationSchema,
  ExperimentUnitsQueryParams,
  QueryResponse,
  TrackedEventResponseRow,
  ExperimentUnitsQueryResponse,
  ProcessedDimensions,
  ExperimentAggregateUnitsQueryResponse,
  ExperimentAggregateUnitsQueryParams,
  UserDimension,
  ExperimentDimension,
  ExternalIdCallback,
  DimensionSlicesQueryResponse,
  DimensionSlicesQueryParams,
  ExperimentFactMetricsQueryParams,
  ExperimentFactMetricsQueryResponse,
  FactMetricData,
  BanditMetricData,
  MetricAnalysisParams,
  MetricAnalysisQueryResponse,
  MetricAnalysisQueryResponseRow,
  TrackedEventData,
  AutoMetricTrackedEvent,
  AutoMetricToCreate,
  DropTableQueryResponse,
  DropTableQueryParams,
  TestQueryParams,
  ColumnTopValuesParams,
  ColumnTopValuesResponse,
  PopulationMetricQueryParams,
  PopulationFactMetricsQueryParams,
  VariationPeriodWeight,
  DataType,
  IncrementalWithNoOutputQueryResponse,
  CreateExperimentIncrementalUnitsQueryParams,
  UpdateExperimentIncrementalUnitsQueryParams,
  DropOldIncrementalUnitsQueryParams,
  AlterNewIncrementalUnitsQueryParams,
  FeatureEvalDiagnosticsQueryParams,
  MaxTimestampIncrementalUnitsQueryParams,
  MaxTimestampMetricSourceQueryParams,
  CreateMetricSourceTableQueryParams,
  InsertMetricSourceDataQueryParams,
  DimensionColumnData,
  DropMetricSourceCovariateTableQueryParams,
  MaxTimestampQueryResponse,
  ExperimentFactMetricsQueryResponseRows,
  IncrementalRefreshStatisticsQueryParams,
  FactMetricQuantileData,
  FactMetricPercentileData,
  FactMetricAggregationMetadata,
  FeatureEvalDiagnosticsQueryResponse,
  UserExperimentExposuresQueryParams,
  UserExperimentExposuresQueryResponse,
  CovariateWindowType,
  InsertMetricSourceCovariateDataQueryParams,
  FactMetricSourceData,
  CreateMetricSourceCovariateTableQueryParams,
  CovariatePhaseStartSettings,
  PipelineIntegration,
} from "shared/types/integrations";
import { MetricAnalysisSettings } from "shared/types/metric-analysis";
import { MetricInterface, MetricType } from "shared/types/metric";
import {
  DataSourceSettings,
  DataSourceProperties,
  ExposureQuery,
  SchemaFormatConfig,
  DataSourceInterface,
  AutoFactTableSchemas,
  SchemaFormat,
} from "shared/types/datasource";
import { DimensionInterface } from "shared/types/dimension";
import {
  ExperimentSnapshotSettings,
  SnapshotBanditSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import {
  ColumnRef,
  FactMetricInterface,
  FactTableInterface,
  MetricQuantileSettings,
} from "shared/types/fact-table";
import type { PopulationDataQuerySettings } from "shared/types/query";
import { AdditionalQueryMetadata, QueryMetadata } from "shared/types/query";
import { MissingDatasourceParamsError } from "back-end/src/util/errors";
import { UNITS_TABLE_PREFIX } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ReqContext } from "back-end/types/request";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  getBaseIdTypeAndJoins,
  compileSqlTemplate,
  replaceCountStar,
} from "back-end/src/util/sql";
import { formatInformationSchema } from "back-end/src/util/informationSchemas";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { logger } from "back-end/src/util/logger";
import { applyMetricOverrides } from "back-end/src/util/integration";
import { ReqContextClass } from "back-end/src/services/context";
import {
  INCREMENTAL_METRICS_TABLE_PREFIX,
  INCREMENTAL_UNITS_TABLE_PREFIX,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import {
  ALL_NON_QUANTILE_METRIC_FLOAT_COLS,
  MAX_METRICS_PER_QUERY,
  N_STAR_VALUES,
} from "back-end/src/services/experimentQueries/constants";

export const MAX_ROWS_UNIT_AGGREGATE_QUERY = 3000;
export const MAX_ROWS_PAST_EXPERIMENTS_QUERY = 3000;
export const TEST_QUERY_SQL = "SELECT 1";

const supportedEventTrackers: Record<AutoFactTableSchemas, true> = {
  segment: true,
  rudderstack: true,
  amplitude: true,
};

export default abstract class SqlIntegration
  implements SourceIntegrationInterface, PipelineIntegration
{
  datasource: DataSourceInterface;
  context: ReqContext;
  additionalMetadata?: AdditionalQueryMetadata;
  decryptionError: boolean;
  // eslint-disable-next-line
  params: any;
  abstract setParams(encryptedParams: string): void;
  abstract runQuery(
    sql: string,
    setExternalId?: ExternalIdCallback,
    metadata?: QueryMetadata,
  ): Promise<QueryResponse>;
  async cancelQuery(externalId: string): Promise<void> {
    logger.debug(`Cancel query: ${externalId} - not implemented`);
  }
  abstract getSensitiveParamKeys(): string[];

  constructor(context: ReqContextClass, datasource: DataSourceInterface) {
    this.wrapRunQuery();
    this.datasource = datasource;
    this.context = context;
    this.decryptionError = false;
    try {
      this.setParams(datasource.params);
    } catch (e) {
      this.params = {};
      this.decryptionError = true;
    }
  }

  private wrapRunQuery() {
    const originalRunQuery = this.runQuery;
    this.runQuery = async (
      sql: string,
      setExternalId?: ExternalIdCallback,
      metadata?: QueryMetadata,
    ) => {
      if (isMultiStatementSQL(sql)) {
        throw new Error("Multi-statement queries are not supported");
      }
      metadata = {
        ...metadata,
        userId: this.context.userId,
        userName: this.context.userName,
        ...this.additionalMetadata,
      };
      return originalRunQuery.call(this, sql, setExternalId, metadata);
    };
  }

  setAdditionalQueryMetadata(additionalQueryMetadata: AdditionalQueryMetadata) {
    this.additionalMetadata = additionalQueryMetadata;
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
      supportsInformationSchema: true,
      supportsAutoGeneratedMetrics: this.isAutoGeneratingMetricsSupported(),
      supportsWritingTables: this.isWritingTablesSupported(),
      dropUnitsTable: this.dropUnitsTable(),
      hasQuantileTesting: this.hasQuantileTesting(),
      hasEfficientPercentiles: this.hasEfficientPercentile(),
      hasCountDistinctHLL: this.hasCountDistinctHLL(),
      hasIncrementalRefresh: this.canRunIncrementalRefreshQueries(),
      maxColumns: 1000,
    };
  }

  canRunIncrementalRefreshQueries(): boolean {
    return PIPELINE_MODE_SUPPORTED_DATA_SOURCE_TYPES["incremental"].includes(
      this.datasource.type,
    );
  }

  async testConnection(): Promise<boolean> {
    await this.runQuery(TEST_QUERY_SQL);
    return true;
  }

  isAutoGeneratingFactTablesSupported(): boolean {
    if (
      this.datasource.settings.schemaFormat &&
      supportedEventTrackers[
        this.datasource.settings.schemaFormat as AutoFactTableSchemas
      ]
    ) {
      return true;
    }
    return false;
  }

  // Currently, if auto generating fact tables is supported, so is generating auto metrics
  isAutoGeneratingMetricsSupported(): boolean {
    return this.isAutoGeneratingFactTablesSupported();
  }

  schemaFormatisAutoFactTablesSchemas(
    schemaFormat: SchemaFormat,
  ): schemaFormat is AutoFactTableSchemas {
    return (
      supportedEventTrackers[schemaFormat as AutoFactTableSchemas] || false
    );
  }

  isWritingTablesSupported(): boolean {
    return false;
  }

  dropUnitsTable(): boolean {
    return false;
  }

  requiresDatabase = true;
  requiresSchema = true;
  escapePathCharacter: string | null = null;

  getSchema(): string {
    return "";
  }
  getFormatDialect(): FormatDialect {
    return "";
  }
  toTimestamp(date: Date) {
    return `'${date.toISOString().substr(0, 19).replace("T", " ")}'`;
  }
  toTimestampWithMs(date: Date) {
    return `'${date.toISOString().substring(0, 23).replace("T", " ")}'`;
  }
  addHours(col: string, hours: number) {
    if (!hours) return col;
    let unit: "hour" | "minute" = "hour";
    const sign = hours > 0 ? "+" : "-";
    hours = Math.abs(hours);

    const roundedHours = Math.round(hours);
    const roundedMinutes = Math.round(hours * 60);

    let amount = roundedHours;

    // If minutes are needed, use them
    if (roundedMinutes % 60 > 0) {
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
    amount: number,
  ): string {
    return `${col} ${sign} INTERVAL '${amount} ${unit}s'`;
  }
  dateTrunc(col: string) {
    return `date_trunc('day', ${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `datediff(day, ${startCol}, ${endCol})`;
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
  castToDate(col: string): string {
    return `CAST(${col} AS DATE)`;
  }
  castToTimestamp(col: string): string {
    return `CAST(${col} AS TIMESTAMP)`;
  }
  castToHllDataType(col: string): string {
    return `CAST(${col} AS ${this.getDataType("hll")})`;
  }
  ensureFloat(col: string): string {
    return col;
  }
  escapeStringLiteral(value: string): string {
    return value.replace(/'/g, `''`);
  }
  castUserDateCol(column: string): string {
    return column;
  }
  formatDateTimeString(col: string): string {
    return this.castToString(col);
  }
  selectStarLimit(table: string, limit: number): string {
    return `SELECT * FROM ${table} LIMIT ${limit}`;
  }

  ensureMaxLimit(sql: string, limit: number): string {
    return ensureLimit(sql, limit);
  }

  hasQuantileTesting(): boolean {
    return true;
  }
  hasEfficientPercentile(): boolean {
    return true;
  }
  hasCountDistinctHLL(): boolean {
    return false;
  }
  supportsLimitZeroColumnValidation(): boolean {
    return false;
  }
  // eslint-disable-next-line
  hllAggregate(col: string): string {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source.",
    );
  }
  // eslint-disable-next-line
  hllReaggregate(col: string): string {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source.",
    );
  }
  // eslint-disable-next-line
  hllCardinality(col: string): string {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source.",
    );
  }

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `json_extract_scalar(${jsonCol}, '$.${path}')`;
    return isNumeric ? this.ensureFloat(raw) : raw;
  }

  evalBoolean(col: string, value: boolean): string {
    return `${col} IS ${value ? "TRUE" : "FALSE"}`;
  }

  private getExposureQuery(
    exposureQueryId: string,
    userIdType?: "anonymous" | "user",
  ): ExposureQuery {
    if (!exposureQueryId) {
      exposureQueryId = userIdType === "user" ? "user_id" : "anonymous_id";
    }

    const queries = this.datasource.settings?.queries?.exposure || [];

    const match = queries.find((q) => q.id === exposureQueryId);

    if (!match) {
      throw new Error(
        "Unknown experiment assignment table - " + exposureQueryId,
      );
    }

    return match;
  }

  getPastExperimentQuery(params: PastExperimentParams): string {
    // TODO: for past experiments, UNION all exposure queries together
    const experimentQueries = (
      this.datasource.settings.queries?.exposure || []
    ).map(({ id }) => this.getExposureQuery(id));

    const end = new Date();

    return format(
      `-- Past Experiments
    WITH
      ${experimentQueries
        .map((q, i) => {
          const hasNameCol = q.hasNameCol || false;
          const userCountColumn = this.hasCountDistinctHLL()
            ? this.hllCardinality(this.hllAggregate(q.userIdType))
            : `COUNT(distinct ${q.userIdType})`;
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
            ${userCountColumn} as users,
            MAX(${this.castUserDateCol("timestamp")}) as latest_data
          FROM
            (
              ${compileSqlTemplate(q.query, { startDate: params.from })}
            ) e${i}
          WHERE
            timestamp > ${this.toTimestamp(params.from)}
            AND timestamp <= ${this.toTimestamp(end)}
            AND SUBSTRING(experiment_id, 1, ${
              SAFE_ROLLOUT_TRACKING_KEY_PREFIX.length
            }) != '${SAFE_ROLLOUT_TRACKING_KEY_PREFIX}'
            AND experiment_id IS NOT NULL
            AND variation_id IS NOT NULL
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
          SUM(d.users) as users,
          MAX(latest_data) as latest_data
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
    ${this.selectStarLimit(
      `
      __variations
    ORDER BY
      start_date DESC, experiment_id ASC, variation_id ASC
      `,
      MAX_ROWS_PAST_EXPERIMENTS_QUERY,
    )}`,
      this.getFormatDialect(),
    );
  }
  async runPastExperimentQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<PastExperimentQueryResponse> {
    const { rows, statistics } = await this.runQuery(query, setExternalId);

    return {
      rows: rows.map((row) => {
        return {
          exposure_query: row.exposure_query,
          experiment_id: row.experiment_id,
          experiment_name: row.experiment_name,
          variation_id: row.variation_id ?? "",
          variation_name: row.variation_name,
          users: parseInt(row.users) || 0,
          end_date: getValidDate(row.end_date).toISOString(),
          start_date: getValidDate(row.start_date).toISOString(),
          latest_data: getValidDate(row.latest_data).toISOString(),
        };
      }),
      statistics: statistics,
    };
  }

  getMetricValueQuery(params: MetricValueParams): string {
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE({
      objects: [
        params.metric.userIdTypes || [],
        params.segment ? [params.segment.userIdType || "user_id"] : [],
      ],
      from: params.from,
      to: params.to,
    });

    // Get rough date filter for metrics to improve performance
    const metricStart = this.getMetricStart(
      params.from,
      this.getMetricMinDelay([params.metric]),
      0,
    );
    const metricEnd = this.getMetricEnd([params.metric], params.to);

    const aggregate = this.getAggregateMetricColumnLegacyMetrics({
      metric: params.metric,
    });

    // TODO query is broken if segment has template variables
    return format(
      `-- ${params.name} - ${params.metric.name} Metric
      WITH
        ${idJoinSQL}
        ${
          params.segment
            ? `segment as (${this.getSegmentCTE(
                params.segment,
                baseIdType,
                idJoinMap,
                params.factTableMap,
              )}),`
            : ""
        }
        __metric as (${this.getMetricCTE({
          metric: params.metric,
          baseIdType,
          idJoinMap,
          startDate: metricStart,
          endDate: metricEnd,
          // Facts tables are not supported for this query yet
          factTableMap: new Map(),
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
      this.getFormatDialect(),
    );
  }

  getPowerPopulationSourceCTE({
    settings,
    factTableMap,
    segment,
  }: {
    settings: PopulationDataQuerySettings;
    factTableMap: FactTableMap;
    segment: SegmentInterface | null;
  }) {
    switch (settings.sourceType) {
      case "segment": {
        if (segment) {
          const factTable = segment.factTableId
            ? factTableMap.get(segment.factTableId)
            : undefined;
          return `
          __source AS (${this.getSegmentCTE(
            segment,
            settings.userIdType,
            {}, // no id join map needed as id type is segment id type
            factTableMap,
            {
              startDate: settings.startDate,
              endDate: settings.endDate ?? undefined,
              templateVariables: { eventName: factTable?.eventName },
            },
          )})`;
        } else {
          throw new Error("Segment not found");
        }
      }
      case "factTable": {
        const factTable = factTableMap.get(settings.sourceId);
        if (factTable) {
          const sql = factTable.sql;
          return compileSqlTemplate(
            `
          __source AS (
            SELECT
              ${settings.userIdType}
              , timestamp
            FROM (
              ${sql}
            ) ft
          )`,
            {
              startDate: settings.startDate,
              endDate: settings.endDate ?? undefined,
              templateVariables: { eventName: factTable.eventName },
            },
          );
        } else {
          throw new Error("Fact Table not found");
        }
      }
    }
  }

  getPowerPopulationCTEs({
    settings,
    factTableMap,
    segment,
  }: {
    settings: PopulationDataQuerySettings;
    factTableMap: FactTableMap;
    segment: SegmentInterface | null;
  }): string {
    const timestampColumn =
      settings.sourceType === "segment" ? "date" : "timestamp";
    // BQ datetime cast for SELECT statements (do not use for where)
    const timestampDateTimeColumn = this.castUserDateCol(timestampColumn);

    const firstQuery = this.getPowerPopulationSourceCTE({
      settings,
      factTableMap,
      segment,
    });

    return `
      ${firstQuery}
      , __experimentUnits AS (
        SELECT
          ${settings.userIdType}
          , MIN(${timestampDateTimeColumn}) AS first_exposure_timestamp
          , ${this.castToString("''")} as variation
        FROM
          __source
        WHERE
            ${timestampColumn} >= ${this.toTimestamp(settings.startDate)}
            AND ${timestampColumn} <= ${this.toTimestamp(settings.endDate)}
        GROUP BY ${settings.userIdType}
      ),`;
  }

  getMetricAnalysisPopulationCTEs({
    settings,
    idJoinMap,
    factTableMap,
    segment,
  }: {
    settings: MetricAnalysisSettings;
    idJoinMap: Record<string, string>;
    factTableMap: FactTableMap;
    segment: SegmentInterface | null;
  }): string {
    // get population query
    if (settings.populationType === "exposureQuery") {
      const exposureQuery = this.getExposureQuery(settings.populationId || "");

      return `
      __rawExperiment AS (
        ${compileSqlTemplate(exposureQuery.query, {
          startDate: settings.startDate,
          endDate: settings.endDate ?? undefined,
        })}
      ),
      __population AS (
        -- All recent users
        SELECT DISTINCT
          ${settings.userIdType}
        FROM
            __rawExperiment
        WHERE
            timestamp >= ${this.toTimestamp(settings.startDate)}
            ${
              settings.endDate
                ? `AND timestamp <= ${this.toTimestamp(settings.endDate)}`
                : ""
            }
        ),`;
    }

    if (settings.populationType === "segment" && segment) {
      // TODO segment missing
      return `
      __segment as (${this.getSegmentCTE(
        segment,
        settings.userIdType,
        idJoinMap,
        factTableMap,
        {
          startDate: settings.startDate,
          endDate: settings.endDate ?? undefined,
        },
      )}),
      __population AS (
        SELECT DISTINCT
          ${settings.userIdType}
        FROM
          __segment e
        WHERE
            date >= ${this.toTimestamp(settings.startDate)}
            ${
              settings.endDate
                ? `AND date <= ${this.toTimestamp(settings.endDate)}`
                : ""
            }
      ),`;
    }

    return "";
  }

  getMetricAnalysisStatisticClauses(
    finalValueColumn: string,
    finalDenominatorColumn: string,
    ratioMetric: boolean,
  ): string {
    return `, COUNT(*) as units
            , SUM(${finalValueColumn}) as main_sum
            , SUM(POWER(${finalValueColumn}, 2)) as main_sum_squares
            ${
              ratioMetric
                ? `
            , SUM(${finalDenominatorColumn}) as denominator_sum
            , SUM(POWER(${finalDenominatorColumn}, 2)) as denominator_sum_squares
            , SUM(${finalDenominatorColumn} * ${finalValueColumn}) as main_denominator_sum_product
            `
                : ""
            }`;
  }

  getMetricAnalysisQuery(
    metric: FactMetricInterface,
    params: Omit<MetricAnalysisParams, "metric">,
  ): string {
    const { settings } = params;

    // Get any required identity join queries; only use same id type for now,
    // so not needed
    const idTypeObjects = [
      getUserIdTypes(metric, params.factTableMap),
      //...unitDimensions.map((d) => [d.dimension.userIdType || "user_id"]),
      //settings.segment ? [settings.segment.userIdType || "user_id"] : [],
    ];
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE({
      objects: idTypeObjects,
      from: settings.startDate,
      to: settings.endDate ?? undefined,
      forcedBaseIdType: settings.userIdType,
    });

    const factTable = params.factTableMap.get(
      metric.numerator?.factTableId || "",
    );
    if (!factTable) {
      throw new Error("Unknown fact table");
    }

    const metricData = this.getMetricData(
      { metric, index: 0 },
      {
        // Ignore conversion windows in aggregation functions
        attributionModel: "experimentDuration",
        regressionAdjustmentEnabled: false,
        startDate: settings.startDate,
        endDate: settings.endDate ?? undefined,
      },
      null,
      [{ factTable, index: 0 }],
      "m0",
    );

    // TODO(sql): Support analyses for cross-table ratio metrics
    if (
      isRatioMetric(metric) &&
      metric.denominator &&
      metric.denominator.factTableId !== factTable.id
    ) {
      throw new Error(
        "Metric analyses for cross-table ratio metrics are not supported yet",
      );
    }

    if (metric.metricType === "dailyParticipation") {
      throw new Error(
        "Metric analyses for daily participation metrics are not supported yet",
      );
    }

    const createHistogram = metric.metricType === "mean";

    const finalValueColumn = this.capCoalesceValue({
      valueCol: "value",
      metric,
      capTablePrefix: "cap",
      capValueCol: "value_capped",
      columnRef: metric.numerator,
    });
    const finalDenominatorColumn = this.capCoalesceValue({
      valueCol: "denominator",
      metric,
      capTablePrefix: "cap",
      capValueCol: "denominator_capped",
      columnRef: metric.denominator,
    });

    const populationSQL = this.getMetricAnalysisPopulationCTEs({
      settings,
      idJoinMap,
      factTableMap: params.factTableMap,
      segment: params.segment,
    });

    // TODO check if query broken if segment has template variables
    // TODO return cap numbers
    return format(
      `-- ${metric.name} Metric Analysis
      WITH
        ${idJoinSQL}
        ${populationSQL}
      __factTable AS (${this.getFactMetricCTE({
        baseIdType,
        idJoinMap,
        metricsWithIndices: [{ metric: metric, index: 0 }],
        factTable,
        endDate: metricData.metricEnd,
        startDate: metricData.metricStart,
        addFiltersToWhere: settings.populationType == "metric",
      })})
        , __userMetricDaily AS (
          -- Get aggregated metric per user by day
          SELECT
          ${populationSQL ? "p" : "f"}.${baseIdType} AS ${baseIdType}
            , ${this.dateTrunc("f.timestamp")} AS date
            , ${metricData.numeratorAggFns.fullAggregationFunction(`f.${metricData.alias}_value`)} AS value
            , ${metricData.numeratorAggFns.partialAggregationFunction(`f.${metricData.alias}_value`)} AS value_for_reaggregation
                  ${
                    metricData.ratioMetric
                      ? `, ${metricData.denominatorAggFns.fullAggregationFunction(`f.${metricData.alias}_denominator`)} AS denominator
                      , ${metricData.denominatorAggFns.partialAggregationFunction(`f.${metricData.alias}_denominator`)} AS denominator_for_reaggregation`
                      : ""
                  }
          
          ${
            populationSQL
              ? `
            FROM __population p 
            LEFT JOIN __factTable f ON (f.${baseIdType} = p.${baseIdType})`
              : `
            FROM __factTable f`
          } 
          GROUP BY
            ${this.dateTrunc("f.timestamp")}
            , ${populationSQL ? "p" : "f"}.${baseIdType}
        )
        , __userMetricOverall AS (
          SELECT
            ${baseIdType}
            , ${metricData.aggregatedValueTransformation({
              column: metricData.numeratorAggFns.reAggregationFunction(
                "value_for_reaggregation",
              ),
              initialTimestampColumn: this.toTimestamp(settings.startDate),
              analysisEndDate: settings.endDate,
            })} AS value
            ${
              metricData.ratioMetric
                ? `, ${metricData.aggregatedValueTransformation({
                    column: metricData.denominatorAggFns.reAggregationFunction(
                      "denominator_for_reaggregation",
                    ),
                    initialTimestampColumn: this.toTimestamp(
                      settings.startDate,
                    ),
                    analysisEndDate: settings.endDate,
                  })} AS denominator`
                : ""
            }
          FROM
            __userMetricDaily
          GROUP BY
            ${baseIdType}
        )
        ${
          metricData.isPercentileCapped
            ? `
        , __capValue AS (
            ${this.percentileCapSelectClause(
              [
                {
                  valueCol: "value",
                  outputCol: "value_capped",
                  percentile: metricData.metric.cappingSettings.value ?? 1,
                  ignoreZeros:
                    metricData.metric.cappingSettings.ignoreZeros ?? false,
                  sourceIndex: metricData.numeratorSourceIndex,
                },
                ...(metricData.ratioMetric
                  ? [
                      {
                        valueCol: "denominator",
                        outputCol: "denominator_capped",
                        percentile:
                          metricData.metric.cappingSettings.value ?? 1,
                        ignoreZeros:
                          metricData.metric.cappingSettings.ignoreZeros ??
                          false,
                        sourceIndex: metricData.denominatorSourceIndex,
                      },
                    ]
                  : []),
              ],
              "__userMetricOverall",
            )}
        )
        `
            : ""
        }
        , __statisticsDaily AS (
          SELECT
            date
            , MAX(${this.castToString("'date'")}) AS data_type
            , ${this.castToString(
              `'${metric.cappingSettings.type ? "capped" : "uncapped"}'`,
            )} AS capped
            ${this.getMetricAnalysisStatisticClauses(
              finalValueColumn,
              finalDenominatorColumn,
              metricData.ratioMetric,
            )}
            ${
              createHistogram
                ? `
            , MIN(${finalValueColumn}) as value_min
            , MAX(${finalValueColumn}) as value_max
            , ${this.ensureFloat("NULL")} AS bin_width
            ${[...Array(DEFAULT_METRIC_HISTOGRAM_BINS).keys()]
              .map((i) => `, ${this.ensureFloat("NULL")} AS units_bin_${i}`)
              .join("\n")}`
                : ""
            }
          FROM __userMetricDaily
          ${metricData.isPercentileCapped ? "CROSS JOIN __capValue cap" : ""}
          GROUP BY date
        )
        , __statisticsOverall AS (
          SELECT
            ${this.castToDate("NULL")} AS date
            , MAX(${this.castToString("'overall'")}) AS data_type
            , ${this.castToString(
              `'${metric.cappingSettings.type ? "capped" : "uncapped"}'`,
            )} AS capped
            ${this.getMetricAnalysisStatisticClauses(
              finalValueColumn,
              finalDenominatorColumn,
              metricData.ratioMetric,
            )}
            ${
              createHistogram
                ? `
            , MIN(${finalValueColumn}) as value_min
            , MAX(${finalValueColumn}) as value_max
            , (MAX(${finalValueColumn}) - MIN(${finalValueColumn})) / ${DEFAULT_METRIC_HISTOGRAM_BINS}.0 as bin_width
            `
                : ""
            }
          FROM __userMetricOverall
        ${metricData.isPercentileCapped ? "CROSS JOIN __capValue cap" : ""}
        )
        ${
          createHistogram
            ? `
        , __histogram AS (
          SELECT
            SUM(${this.ifElse(
              "m.value < (s.value_min + s.bin_width)",
              "1",
              "0",
            )}) as units_bin_0
            ${[...Array(DEFAULT_METRIC_HISTOGRAM_BINS - 2).keys()]
              .map(
                (i) =>
                  `, SUM(${this.ifElse(
                    `m.value >= (s.value_min + s.bin_width*${
                      i + 1
                    }.0) AND m.value < (s.value_min + s.bin_width*${i + 2}.0)`,
                    "1",
                    "0",
                  )}) as units_bin_${i + 1}`,
              )
              .join("\n")}
            , SUM(${this.ifElse(
              `m.value >= (s.value_min + s.bin_width*${
                DEFAULT_METRIC_HISTOGRAM_BINS - 1
              }.0)`,
              "1",
              "0",
            )}) as units_bin_${DEFAULT_METRIC_HISTOGRAM_BINS - 1}
          FROM
            __userMetricOverall m
          CROSS JOIN
            __statisticsOverall s
        ) `
            : ""
        }
        SELECT
            *
        FROM __statisticsOverall
        ${createHistogram ? `CROSS JOIN __histogram` : ""}
        UNION ALL
        SELECT
            *
        FROM __statisticsDaily
      `,
      this.getFormatDialect(),
    );
  }

  async runMetricAnalysisQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<MetricAnalysisQueryResponse> {
    const { rows, statistics } = await this.runQuery(query, setExternalId);

    function parseUnitsBinData(
      // eslint-disable-next-line
      row: Record<string, any>,
    ): Partial<MetricAnalysisQueryResponseRow> {
      const data: Record<string, number> = {};

      for (let i = 0; i < DEFAULT_METRIC_HISTOGRAM_BINS; i++) {
        const key = `units_bin_${i}`;
        const parsed = parseFloat(row[key]);
        if (parsed) {
          data[key] = parsed;
        }
      }

      return data as Partial<MetricAnalysisQueryResponseRow>;
    }

    return {
      rows: rows.map((row) => {
        const {
          date,
          data_type,
          units,
          capped,
          main_sum,
          main_sum_squares,
          denominator_sum,
          denominator_sum_squares,
          main_denominator_sum_product,
          value_min,
          value_max,
        } = row;

        const ret: MetricAnalysisQueryResponseRow = {
          date: date ? getValidDate(date).toISOString() : "",
          data_type: data_type ?? "",
          capped: (capped ?? "uncapped") == "capped",
          units: parseFloat(units) || 0,
          main_sum: parseFloat(main_sum) || 0,
          main_sum_squares: parseFloat(main_sum_squares) || 0,
          denominator_sum: parseFloat(denominator_sum) || 0,
          denominator_sum_squares: parseFloat(denominator_sum_squares) || 0,
          main_denominator_sum_product:
            parseFloat(main_denominator_sum_product) || 0,

          value_min: parseFloat(value_min) || 0,
          value_max: parseFloat(value_max) || 0,
          ...(parseFloat(row.bin_width) && {
            bin_width: parseFloat(row.bin_width),
          }),
          ...parseUnitsBinData(row),
        };
        return ret;
      }),
      statistics: statistics,
    };
  }

  getQuantileBoundsFromQueryResponse(
    // eslint-disable-next-line
    row: Record<string, any>,
    prefix: string,
  ) {
    // Finds the lower and upper bounds that correspond to the largest
    // nstar that is smaller than the actual quantile n
    const quantileData: {
      [key: string]: number;
    } = {};
    if (row[`${prefix}quantile`] !== undefined) {
      quantileData[`${prefix}quantile`] =
        parseFloat(row[`${prefix}quantile`]) || 0;
      quantileData[`${prefix}quantile_n`] =
        parseFloat(row[`${prefix}quantile_n`]) || 0;

      const smallestNStar = Math.min(...N_STAR_VALUES);

      // process grid for quantile data
      N_STAR_VALUES.forEach((n) => {
        const lowerColumn = `${prefix}quantile_lower_${n}`;
        const upperColumn = `${prefix}quantile_upper_${n}`;
        if (row[lowerColumn] === undefined || row[upperColumn] === undefined)
          return;

        if (
          // if nstar is smaller, or if it's the smallest nstar, proceed
          (n < quantileData[`${prefix}quantile_n`] || n == smallestNStar) &&
          // if N_STAR_VALUES isn't ascending need to make sure
          // this n is the largest n we've seen so far
          n > (Number(quantileData[`${prefix}quantile_nstar`]) || 0)
        ) {
          quantileData[`${prefix}quantile_lower`] =
            parseFloat(row[lowerColumn]) || 0;
          quantileData[`${prefix}quantile_upper`] =
            parseFloat(row[upperColumn]) || 0;
          quantileData[`${prefix}quantile_nstar`] = n;
        }
      });
    }
    return quantileData;
  }

  async runPopulationFactMetricsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentFactMetricsQueryResponse> {
    return this.runExperimentFactMetricsQuery(query, setExternalId);
  }

  processExperimentFactMetricsQueryRows(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: Record<string, any>[],
  ): ExperimentFactMetricsQueryResponseRows {
    return rows.map((row) => {
      let metricData: {
        [key: string]: number | string;
      } = {};
      for (let i = 0; i < MAX_METRICS_PER_QUERY; i++) {
        const prefix = `m${i}_`;
        // Reached the end
        if (!row[prefix + "id"]) break;

        metricData[prefix + "id"] = row[prefix + "id"];
        ALL_NON_QUANTILE_METRIC_FLOAT_COLS.forEach((col) => {
          if (row[prefix + col] !== undefined) {
            metricData[prefix + col] = parseFloat(row[prefix + col]) || 0;
          }
        });

        metricData = {
          ...metricData,
          ...this.getQuantileBoundsFromQueryResponse(row, prefix),
        };
      }

      const dimensionData: Record<string, string> = {};
      Object.entries(row)
        .filter(([key, _]) => key.startsWith("dim_") || key === "dimension")
        .forEach(([key, value]) => {
          dimensionData[key] = value;
        });

      return {
        variation: row.variation ?? "",
        ...dimensionData,
        users: parseInt(row.users) || 0,
        count: parseInt(row.users) || 0,
        ...metricData,
      };
    });
  }

  async runExperimentFactMetricsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentFactMetricsQueryResponse> {
    const { rows, statistics } = await this.runQuery(query, setExternalId);

    return {
      rows: this.processExperimentFactMetricsQueryRows(rows),
      statistics: statistics,
    };
  }

  async runPopulationMetricQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentMetricQueryResponse> {
    return this.runExperimentMetricQuery(query, setExternalId);
  }

  async runExperimentMetricQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentMetricQueryResponse> {
    const { rows, statistics } = await this.runQuery(query, setExternalId);

    // Helper function to parse a single float field
    const parseFloatField = (
      row: Record<string, unknown>,
      field: string,
    ): Record<string, number> => {
      return row[field] !== undefined
        ? { [field]: parseFloat(row[field] as string) || 0 }
        : {};
    };

    // Helper function to parse non-float fields (cap values)
    const parseNonFloatField = (
      row: Record<string, unknown>,
      field: string,
    ): Record<string, unknown> => {
      return row[field] !== undefined ? { [field]: row[field] } : {};
    };

    return {
      rows: rows.map((row) => {
        const dimensionData: Record<string, string> = {};
        Object.entries(row)
          .filter(([key, _]) => key.startsWith("dim_") || key === "dimension")
          .forEach(([key, value]) => {
            dimensionData[key] = value;
          });

        // Build result object by processing all field types
        const result: ExperimentMetricQueryResponseRows[number] = {
          variation: row.variation ?? "",
          ...dimensionData,
          users: parseInt(row.users as string) || 0,
          count: parseInt(row.users as string) || 0,
          main_sum: parseFloat(row.main_sum as string) || 0,
          main_sum_squares: parseFloat(row.main_sum_squares as string) || 0,
        };

        // Quantile case
        if (row.quantile !== undefined) {
          result.quantile = parseFloat(row.quantile as string) || 0;
          Object.assign(
            result,
            this.getQuantileBoundsFromQueryResponse(row, ""),
          );
        }

        Object.assign(
          result,
          // Ratio case
          parseFloatField(row, "denominator_sum"),
          parseFloatField(row, "denominator_sum_squares"),
          parseFloatField(row, "main_denominator_sum_product"),
          // CUPED case
          parseFloatField(row, "covariate_sum"),
          parseFloatField(row, "covariate_sum_squares"),
          parseFloatField(row, "main_covariate_sum_product"),
          // Ratio CUPED case
          parseFloatField(row, "denominator_pre_sum"),
          parseFloatField(row, "denominator_pre_sum_squares"),
          parseFloatField(row, "main_post_denominator_pre_sum_product"),
          parseFloatField(row, "main_pre_denominator_post_sum_product"),
          parseFloatField(row, "main_pre_denominator_pre_sum_product"),
          parseFloatField(row, "denominator_post_denominator_pre_sum_product"),
          // Capping case
          parseNonFloatField(row, "main_cap_value"),
          parseNonFloatField(row, "denominator_cap_value"),
          // Bandits case
          parseFloatField(row, "theta"),
          // Uncapped main case
          parseFloatField(row, "main_sum_uncapped"),
          parseFloatField(row, "main_sum_squares_uncapped"),
          // Uncapped ratio case
          parseFloatField(row, "denominator_sum_uncapped"),
          parseFloatField(row, "denominator_sum_squares_uncapped"),
          parseFloatField(row, "main_denominator_sum_product_uncapped"),
          // Uncapped CUPED case
          parseFloatField(row, "covariate_sum_uncapped"),
          parseFloatField(row, "covariate_sum_squares_uncapped"),
          parseFloatField(row, "main_covariate_sum_product_uncapped"),
          // Uncapped CUPED ratio case
          parseFloatField(row, "denominator_pre_sum_uncapped"),
          parseFloatField(row, "denominator_pre_sum_squares_uncapped"),
          parseFloatField(
            row,
            "main_post_denominator_pre_sum_product_uncapped",
          ),
          parseFloatField(
            row,
            "main_pre_denominator_post_sum_product_uncapped",
          ),
          parseFloatField(row, "main_pre_denominator_pre_sum_product_uncapped"),
          parseFloatField(
            row,
            "denominator_post_denominator_pre_sum_product_uncapped",
          ),
        );
        return result;
      }),
      statistics: statistics,
    };
  }

  async runExperimentAggregateUnitsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentAggregateUnitsQueryResponse> {
    const { rows, statistics } = await this.runQuery(query, setExternalId);
    return {
      rows: rows.map((row) => {
        return {
          variation: row.variation ?? "",
          units: parseFloat(row.units) || 0,
          dimension_value: row.dimension_value ?? "",
          dimension_name: row.dimension_name ?? "",
        };
      }),
      statistics: statistics,
    };
  }

  async runExperimentUnitsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentUnitsQueryResponse> {
    return await this.runQuery(query, setExternalId);
  }

  async runMetricValueQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<MetricValueQueryResponse> {
    const { rows, statistics } = await this.runQuery(query, setExternalId);

    return {
      rows: rows.map((row) => {
        const { date, count, main_sum, main_sum_squares } = row;

        const ret: MetricValueQueryResponseRow = {
          date: date ? getValidDate(date).toISOString() : "",
          count: parseFloat(count) || 0,
          main_sum: parseFloat(main_sum) || 0,
          main_sum_squares: parseFloat(main_sum_squares) || 0,
        };

        return ret;
      }),
      statistics: statistics,
    };
  }

  //Test the validity of a query as cheaply as possible
  getTestValidityQuery(
    query: string,
    testDays?: number,
    templateVariables?: TemplateVariables,
  ): string {
    // Use LIMIT 0 for datasources that support column metadata without data
    const limit = this.supportsLimitZeroColumnValidation() ? 0 : 1;
    return this.getTestQuery({
      query,
      templateVariables,
      testDays: testDays ?? DEFAULT_TEST_QUERY_DAYS,
      limit,
    });
  }

  getFreeFormQuery(sql: string, limit?: number): string {
    const limitedQuery = this.ensureMaxLimit(sql, limit ?? SQL_ROW_LIMIT);
    return format(limitedQuery, this.getFormatDialect());
  }

  getTestQuery(params: TestQueryParams): string {
    const { query, templateVariables } = params;
    const limit = params.limit ?? 5;
    const testDays = params.testDays ?? DEFAULT_TEST_QUERY_DAYS;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - testDays);
    const limitedQuery = compileSqlTemplate(
      `WITH __table as (
        ${query}
      )
      ${this.selectStarLimit("__table", limit)}`,
      {
        startDate,
        templateVariables,
      },
    );
    return format(limitedQuery, this.getFormatDialect());
  }

  async runTestQuery(
    sql: string,
    timestampCols?: string[],
  ): Promise<TestQueryResult> {
    // Calculate the run time of the query
    const queryStartTime = Date.now();
    const results = await this.runQuery(sql);
    const queryEndTime = Date.now();
    const duration = queryEndTime - queryStartTime;

    if (timestampCols) {
      results.rows.forEach((row) => {
        timestampCols.forEach((col) => {
          if (row[col]) {
            row[col] = getValidDate(row[col]);
          }
        });
      });
    }

    return { results: results.rows, columns: results.columns, duration };
  }

  getDropUnitsTableQuery(params: DropTableQueryParams): string {
    // valdidate units table query follows expected name to help
    // prevent dropping other tables
    if (!params.fullTablePath.includes(UNITS_TABLE_PREFIX)) {
      throw new Error(
        "Unable to drop table that is not temporary units table.",
      );
    }
    return `DROP TABLE IF EXISTS ${params.fullTablePath}`;
  }

  async runDropTableQuery(
    sql: string,
    setExternalId: ExternalIdCallback,
  ): Promise<DropTableQueryResponse> {
    const results = await this.runQuery(sql, setExternalId);
    return results;
  }

  private getIdentitiesCTE({
    objects,
    from,
    to,
    forcedBaseIdType,
    experimentId,
  }: {
    objects: string[][];
    from: Date;
    to?: Date;
    forcedBaseIdType?: string;
    experimentId?: string;
  }) {
    const { baseIdType, joinsRequired } = getBaseIdTypeAndJoins(
      objects,
      forcedBaseIdType,
    );

    // Joins for when an object doesn't support the baseIdType
    const joins: string[] = [];
    const idJoinMap: Record<string, string> = {};

    // Generate table names and SQL for each of the required joins
    joinsRequired.forEach((idType) => {
      const table = `__identities_${idType.replace(/[^a-zA-Z0-9_]/g, "")}`;
      idJoinMap[idType] = table;
      joins.push(
        `${table} as (
        ${this.getIdentitiesQuery(
          this.datasource.settings,
          baseIdType,
          idType,
          from,
          to,
          experimentId,
        )}
      ),`,
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
    endDate: Date,
    dimensionCols: DimensionColumnData[],
    regressionAdjusted: boolean = false,
    overrideConversionWindows: boolean = false,
    banditDates: Date[] | undefined = undefined,
    tablePrefix: string = "__denominator",
    initialTable: string = "__experiment",
  ) {
    // Note: the aliases below are needed for clickhouse
    return `
      -- one row per user
      SELECT
        initial.${baseIdType} AS ${baseIdType}
        ${dimensionCols
          .map((c) => `, MIN(initial.${c.alias}) AS ${c.alias}`)
          .join("")}
        , MIN(initial.variation) AS variation
        , MIN(initial.first_exposure_date) AS first_exposure_date
        ${
          banditDates?.length
            ? `, MIN(initial.bandit_period) AS bandit_period`
            : ""
        }
        ${
          regressionAdjusted
            ? `
            , MIN(initial.preexposure_start) AS preexposure_start
            , MIN(initial.preexposure_end) AS preexposure_end`
            : ""
        }
        , MIN(t${metrics.length - 1}.timestamp) AS timestamp
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
              endDate,
              overrideConversionWindows,
            );
          })
          .join("\n AND ")}
      GROUP BY
        initial.${baseIdType}`;
  }

  private getDimensionValuePerUnit(
    dimension: UserDimension | ExperimentDimension | null,
    experimentDimensionPrefix?: string,
  ) {
    if (!dimension) {
      return this.castToString("''");
    } else if (dimension.type === "user") {
      return `COALESCE(MAX(${this.castToString(
        `__dim_unit_${dimension.dimension.id}.value`,
      )}),'${NULL_DIMENSION_VALUE}')`;
    } else if (dimension.type === "experiment") {
      return `SUBSTRING(
        MIN(
          CONCAT(SUBSTRING(${this.formatDateTimeString("e.timestamp")}, 1, 19), 
            coalesce(${this.castToString(
              `e.${experimentDimensionPrefix ?? "dim_"}${dimension.id}`,
            )}, ${this.castToString(`'${NULL_DIMENSION_VALUE}'`)})
          )
        ),
        20, 
      99999
      )`;
    }

    throw new Error("Unknown dimension type: " + (dimension as Dimension).type);
  }

  private getConversionWindowClause(
    baseCol: string,
    metricCol: string,
    metric: ExperimentMetricInterface,
    endDate: Date,
    overrideConversionWindows: boolean,
  ): string {
    let windowHours = getMetricWindowHours(metric.windowSettings);
    const delayHours = getDelayWindowHours(metric.windowSettings);

    // all metrics have to be after the base timestamp +- delay hours
    let metricWindow = `${metricCol} >= ${this.addHours(baseCol, delayHours)}`;

    if (
      metric.windowSettings.type === "conversion" &&
      !overrideConversionWindows
    ) {
      // if conversion window, then count metrics before window ends
      // which can extend beyond experiment end date
      metricWindow = `${metricWindow}
        AND ${metricCol} <= ${this.addHours(
          baseCol,
          delayHours + windowHours,
        )}`;
    } else {
      // otherwise, it must be before the experiment end date
      metricWindow = `${metricWindow}
      AND ${metricCol} <= ${this.toTimestamp(endDate)}`;
    }

    if (metric.windowSettings.type === "lookback") {
      // ensure windowHours is positive
      windowHours = windowHours < 0 ? windowHours * -1 : windowHours;
      // also ensure for lookback windows that metric happened in last
      // X hours of the experiment
      metricWindow = `${metricWindow}
      AND ${this.addHours(metricCol, windowHours)} >= ${this.toTimestamp(
        endDate,
      )}`;
    }

    return metricWindow;
  }

  private getMetricMinDelay(metrics: ExperimentMetricInterface[]) {
    let runningDelay = 0;
    let minDelay = 0;
    metrics.forEach((m) => {
      if (getDelayWindowHours(m.windowSettings)) {
        const delay = runningDelay + getDelayWindowHours(m.windowSettings);
        if (delay < minDelay) minDelay = delay;
        runningDelay = delay;
      }
    });
    return minDelay;
  }

  private getMetricStart(
    initial: Date,
    minDelay: number,
    regressionAdjustmentHours: number,
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
    overrideConversionWindows?: boolean,
  ): Date | null {
    if (!initial) return null;
    if (overrideConversionWindows) return initial;

    const metricEnd = new Date(initial);
    let runningHours = 0;
    let maxHours = 0;
    metrics.forEach((m) => {
      if (m.windowSettings.type === "conversion") {
        const hours =
          runningHours +
          getMetricWindowHours(m.windowSettings) +
          getDelayWindowHours(m.windowSettings);
        if (hours > maxHours) maxHours = hours;
        runningHours = hours;
      }
    });

    if (maxHours > 0) {
      metricEnd.setHours(metricEnd.getHours() + maxHours);
    }

    return metricEnd;
  }

  private getMaxHoursToConvert(
    funnelMetric: boolean,
    metricAndDenominatorMetrics: ExperimentMetricInterface[],
    activationMetric: ExperimentMetricInterface | null,
  ): number {
    // Used to set an experiment end date to filter out users
    // who have not had enough time to convert (if experimenter
    // has selected `skipPartialData`)
    let neededHoursForConversion = 0;
    metricAndDenominatorMetrics.forEach((m) => {
      if (m.windowSettings.type === "conversion") {
        const metricHours =
          getDelayWindowHours(m.windowSettings) +
          getMetricWindowHours(m.windowSettings);
        if (funnelMetric) {
          // funnel metric windows can cascade, so sum each metric hours to get max
          neededHoursForConversion += metricHours;
        } else if (metricHours > neededHoursForConversion) {
          neededHoursForConversion = metricHours;
        }
      }
    });
    // activation metrics windows always cascade
    if (
      activationMetric &&
      activationMetric.windowSettings.type == "conversion"
    ) {
      neededHoursForConversion +=
        getDelayWindowHours(activationMetric.windowSettings) +
        getMetricWindowHours(activationMetric.windowSettings);
    }
    return neededHoursForConversion;
  }

  processDimensions(
    dimensions: Dimension[],
    settings: ExperimentSnapshotSettings,
    activationMetric: ExperimentMetricInterface | null,
  ): ProcessedDimensions {
    const processedDimensions: ProcessedDimensions = {
      unitDimensions: [],
      experimentDimensions: [],
      activationDimension: null,
      dateDimension: null,
    };

    dimensions.forEach((dimension) => {
      if (dimension?.type === "activation") {
        if (activationMetric) {
          processedDimensions.activationDimension = { type: "activation" };
        }
      } else if (dimension?.type === "user") {
        // Replace any placeholders in the user defined dimension SQL
        const clonedDimension = cloneDeep<UserDimension>(dimension);
        clonedDimension.dimension.sql = compileSqlTemplate(
          dimension.dimension.sql,
          {
            startDate: settings.startDate,
            endDate: settings.endDate,
            experimentId: settings.experimentId,
          },
        );
        processedDimensions.unitDimensions.push(clonedDimension);
      } else if (dimension?.type === "experiment") {
        processedDimensions.experimentDimensions.push(dimension);
      } else if (dimension?.type === "date") {
        processedDimensions.dateDimension = dimension;
      }
    });
    return processedDimensions;
  }

  createUnitsTableOptions() {
    return "";
  }

  createTablePartitions(_columns: string[]) {
    return "";
  }

  getExperimentUnitsTableQueryFromCte(
    unitsTableFullName: string,
    cteSql: string,
  ): string {
    return format(
      `
      CREATE OR REPLACE TABLE ${unitsTableFullName}
      ${this.createUnitsTableOptions()}
      AS (
        WITH
        ${cteSql}
        SELECT * FROM __experimentUnits
      );
    `,
      this.getFormatDialect(),
    );
  }

  getExperimentUnitsTableQuery(params: ExperimentUnitsQueryParams): string {
    if (!params.unitsTableFullName) {
      throw new Error("Units table full name is required");
    }

    const cteSql = this.getExperimentUnitsQuery(params);

    return this.getExperimentUnitsTableQueryFromCte(
      params.unitsTableFullName,
      cteSql,
    );
  }

  processActivationMetric(
    activationMetricDoc: null | ExperimentMetricInterface,
    settings: ExperimentSnapshotSettings,
  ): null | ExperimentMetricInterface {
    let activationMetric: null | ExperimentMetricInterface = null;
    if (activationMetricDoc) {
      activationMetric =
        cloneDeep<ExperimentMetricInterface>(activationMetricDoc);
      applyMetricOverrides(activationMetric, settings);
    }
    return activationMetric;
  }

  getDimensionInStatement(dimension: string, values: string[]): string {
    return this.ifElse(
      `${this.castToString(dimension)} IN (${values
        .map((v) => `'` + this.escapeStringLiteral(v) + `'`)
        .join(",")})`,
      this.castToString(dimension),
      this.castToString(`'${AUTOMATIC_DIMENSION_OTHER_NAME}'`),
    );
  }

  getPopulationMetricQuery(params: PopulationMetricQueryParams): string {
    const { factTableMap, segment, populationSettings } = params;
    // dimension date?
    const populationSQL = this.getPowerPopulationCTEs({
      settings: populationSettings,
      factTableMap,
      segment,
    });

    return this.getExperimentMetricQuery({
      ...params,
      unitsSource: "otherQuery",
      unitsSql: populationSQL,
      forcedUserIdType: params.populationSettings.userIdType,
    });
  }

  getPopulationFactMetricsQuery(
    params: PopulationFactMetricsQueryParams,
  ): string {
    const { factTableMap, segment, populationSettings } = params;

    const populationSQL = this.getPowerPopulationCTEs({
      settings: populationSettings,
      factTableMap,
      segment,
    });
    return this.getExperimentFactMetricsQuery({
      ...params,
      unitsSource: "otherQuery",
      unitsSql: populationSQL,
      forcedUserIdType: params.populationSettings.userIdType,
    });
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
      settings,
    );

    const { experimentDimensions, unitDimensions } = this.processDimensions(
      params.dimensions,
      settings,
      activationMetric,
    );

    const exposureQuery = this.getExposureQuery(
      settings.exposureQueryId || "",
      undefined,
    );

    // Get any required identity join queries
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE({
      objects: [
        [exposureQuery.userIdType],
        activationMetric ? getUserIdTypes(activationMetric, factTableMap) : [],
        ...unitDimensions.map((d) => [d.dimension.userIdType || "user_id"]),
        segment ? [segment.userIdType || "user_id"] : [],
      ],
      from: settings.startDate,
      to: settings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: settings.experimentId,
    });

    // Get date range for experiment
    const startDate: Date = settings.startDate;
    const endDate: Date = this.getExperimentEndDate(settings, 0);

    const timestampColumn = "e.timestamp";
    // BQ datetime cast for SELECT statements (do not use for where)
    const timestampDateTimeColumn = this.castUserDateCol(timestampColumn);
    const overrideConversionWindows =
      settings.attributionModel === "experimentDuration";

    return `
    ${params.includeIdJoins ? idJoinSQL : ""}
    __rawExperiment AS (
      ${compileSqlTemplate(exposureQuery.query, {
        startDate: settings.startDate,
        endDate: settings.endDate,
        experimentId: settings.experimentId,
        phase: settings.phase,
        customFields: settings.customFields,
      })}
    ),
    __experimentExposures AS (
      -- Viewed Experiment
      SELECT
        e.${baseIdType} as ${baseIdType}
        , ${this.castToString("e.variation_id")} as variation
        , ${timestampDateTimeColumn} as timestamp
        ${experimentDimensions
          .map((d) => {
            if (d.specifiedSlices?.length) {
              return `, ${this.getDimensionInStatement(
                d.id,
                d.specifiedSlices,
              )} AS dim_${d.id}`;
            }
            return `, e.${d.id} AS dim_${d.id}`;
          })
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
              getDelayWindowHours(activationMetric.windowSettings),
              0,
            ),
            endDate: this.getMetricEnd(
              [activationMetric],
              settings.endDate,
              overrideConversionWindows,
            ),
            experimentId: settings.experimentId,
            phase: settings.phase,
            customFields: settings.customFields,
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
            idJoinMap,
            factTableMap,
            {
              startDate: settings.startDate,
              endDate: settings.endDate,
              experimentId: settings.experimentId,
              phase: settings.phase,
              customFields: settings.customFields,
            },
          )})`
        : ""
    }
    ${unitDimensions
      .map(
        (d) =>
          `, __dim_unit_${d.dimension.id} as (${this.getDimensionCTE(
            d.dimension,
            baseIdType,
            idJoinMap,
          )})`,
      )
      .join("\n")}
    , __experimentUnits AS (
      -- One row per user
      SELECT
        e.${baseIdType} AS ${baseIdType}
        , ${this.ifElse(
          "count(distinct e.variation) > 1",
          "'__multiple__'",
          "max(e.variation)",
        )} AS variation
        , MIN(${timestampColumn}) AS first_exposure_timestamp
        ${unitDimensions
          .map(
            (d) => `
          , ${this.getDimensionValuePerUnit(d)} AS dim_unit_${d.dimension.id}`,
          )
          .join("\n")}
        ${experimentDimensions
          .map(
            (d) => `
          , ${this.getDimensionValuePerUnit(d)} AS dim_exp_${d.id}`,
          )
          .join("\n")}
        ${
          activationMetric
            ? `, MIN(${this.ifElse(
                this.getConversionWindowClause(
                  "e.timestamp",
                  "a.timestamp",
                  activationMetric,
                  settings.endDate,
                  overrideConversionWindows,
                ),
                "a.timestamp",
                "NULL",
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
          `,
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

  getBanditVariationPeriodWeights(
    banditSettings: SnapshotBanditSettings,
    variations: SnapshotSettingsVariation[],
  ): VariationPeriodWeight[] | undefined {
    let anyMissingValues = false;
    const variationPeriodWeights = banditSettings.historicalWeights
      .map((w) => {
        return w.weights.map((weight, index) => {
          const variationId = variations?.[index]?.id;
          if (!variationId) {
            anyMissingValues = true;
          }
          return { weight, variationId: variationId, date: w.date };
        });
      })
      .flat();

    if (anyMissingValues) {
      return undefined;
    }

    return variationPeriodWeights;
  }

  getExperimentAggregateUnitsQuery(
    params: ExperimentAggregateUnitsQueryParams,
  ): string {
    const { activationMetric, segment, settings, factTableMap, useUnitsTable } =
      params;

    const experimentDimensions = params.dimensions;

    const exposureQuery = this.getExposureQuery(settings.exposureQueryId || "");

    // get bandit data for SRM calculation
    const banditDates = settings.banditSettings?.historicalWeights.map(
      (w) => w.date,
    );
    const variationPeriodWeights = settings.banditSettings
      ? this.getBanditVariationPeriodWeights(
          settings.banditSettings,
          settings.variations,
        )
      : undefined;

    const computeBanditSrm = !!banditDates && !!variationPeriodWeights;

    // Get any required identity join queries
    const { baseIdType, idJoinSQL } = this.getIdentitiesCTE({
      // add idTypes usually handled in units query here in the case where
      // we don't have a separate table for the units query
      // then for this query we just need the activation metric for activation
      // dimensions
      objects: [
        [exposureQuery.userIdType],
        !useUnitsTable && activationMetric
          ? getUserIdTypes(activationMetric, factTableMap)
          : [],
        !useUnitsTable && segment ? [segment.userIdType || "user_id"] : [],
      ],
      from: settings.startDate,
      to: settings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: settings.experimentId,
    });

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
            this.dateTrunc("first_exposure_timestamp"),
          )} AS dim_exposure_date
          ${banditDates ? `${this.getBanditCaseWhen(banditDates)}` : ""}
          ${experimentDimensions
            .map(
              (d) =>
                `, ${this.getDimensionInStatement(
                  `dim_exp_${d.id}`,
                  d.specifiedSlices,
                )} AS dim_exp_${d.id}`,
            )
            .join("\n")}
          ${
            activationMetric
              ? `, ${this.ifElse(
                  `first_activation_timestamp IS NULL`,
                  "'Not Activated'",
                  "'Activated'",
                )} AS dim_activated`
              : ""
          }
        FROM ${
          useUnitsTable ? `${params.unitsTableFullName}` : "__experimentUnits"
        }
      )
      , __unitsByDimension AS (
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
                : "",
              // cast to float to union with bandit test statistic which is float
              computeBanditSrm,
            ),
          )
          .join("\nUNION ALL\n")}
      )
      ${
        computeBanditSrm
          ? `
        , variationBanditPeriodWeights AS (
          ${variationPeriodWeights
            .map(
              (w) => `
            SELECT
              ${this.castToString(`'${w.variationId}'`)} AS variation
              , ${this.toTimestamp(w.date)} AS bandit_period
              , ${w.weight} AS weight
          `,
            )
            .join("\nUNION ALL\n")}
        )
        , __unitsByVariationBanditPeriod AS (
          SELECT
            v.variation AS variation
            , v.bandit_period AS bandit_period
            , v.weight AS weight
            , COALESCE(COUNT(d.bandit_period), 0) AS units
          FROM variationBanditPeriodWeights v
          LEFT JOIN __distinctUnits d
            ON (d.variation = v.variation AND d.bandit_period = v.bandit_period)
          GROUP BY
            v.variation
            , v.bandit_period
            , v.weight
        )
        , __totalUnitsByBanditPeriod AS (
          SELECT
            bandit_period
            , SUM(units) AS total_units
          FROM __unitsByVariationBanditPeriod
          GROUP BY
            bandit_period
        )
        , __expectedUnitsByVariationBanditPeriod AS (
          SELECT
            u.variation AS variation
            , MAX(${this.castToString("''")}) AS constant
            , SUM(u.units) AS units
            , SUM(t.total_units * u.weight) AS expected_units
          FROM __unitsByVariationBanditPeriod u
          LEFT JOIN __totalUnitsByBanditPeriod t
            ON (t.bandit_period = u.bandit_period)
          WHERE
            COALESCE(t.total_units, 0) > 0
          GROUP BY
            u.variation
        )
        , __banditSrm AS (
          SELECT
            MAX(${this.castToString("''")}) AS variation
            , MAX(${this.castToString("''")}) AS dimension_value
            , MAX(${this.castToString(
              `'${BANDIT_SRM_DIMENSION_NAME}'`,
            )}) AS dimension_name
            , SUM(POW(expected_units - units, 2) / expected_units) AS units
          FROM __expectedUnitsByVariationBanditPeriod
          GROUP BY
            constant
        ),
        __unitsByDimensionWithBanditSrm AS (
          SELECT
            *
          FROM __unitsByDimension
          UNION ALL
          SELECT
            *
          FROM __banditSrm
        )
      `
          : ""
      }

      ${this.selectStarLimit(
        computeBanditSrm
          ? "__unitsByDimensionWithBanditSrm"
          : "__unitsByDimension",
        MAX_ROWS_UNIT_AGGREGATE_QUERY,
      )}
    `,
      this.getFormatDialect(),
    );
  }

  getUnitCountCTE(
    dimensionColumn: string,
    whereClause?: string,
    ensureFloat?: boolean,
  ): string {
    return ` -- ${dimensionColumn}
    SELECT
      variation AS variation
      , ${dimensionColumn} AS dimension_value
      , MAX(${this.castToString(`'${dimensionColumn}'`)}) AS dimension_name
      , ${ensureFloat ? this.ensureFloat("COUNT(*)") : "COUNT(*)"} AS units
    FROM
      __distinctUnits
    ${whereClause ?? ""}
    GROUP BY
      variation
      , ${dimensionColumn}`;
  }

  getDimensionSlicesQuery(params: DimensionSlicesQueryParams): string {
    const exposureQuery = this.getExposureQuery(params.exposureQueryId || "");

    const { baseIdType } = getBaseIdTypeAndJoins([[exposureQuery.userIdType]]);

    const startDate = subDays(new Date(), params.lookbackDays);
    const timestampColumn = "e.timestamp";
    return format(
      `-- Dimension Traffic Query
    WITH
      __rawExperiment AS (
        ${compileSqlTemplate(exposureQuery.query, {
          startDate: startDate,
        })}
      ),
      __experimentExposures AS (
        -- Viewed Experiment
        SELECT
          e.${baseIdType} as ${baseIdType}
          , e.timestamp
          ${params.dimensions
            .map((d) => `, e.${d.id} AS dim_${d.id}`)
            .join("\n")}
        FROM
          __rawExperiment e
        WHERE
          ${timestampColumn} >= ${this.toTimestamp(startDate)}
      ),
      __distinctUnits AS (
        SELECT
          ${baseIdType}
          ${params.dimensions
            .map(
              (d) => `
            , ${this.getDimensionValuePerUnit(d)} AS dim_exp_${d.id}`,
            )
            .join("\n")}
          , 1 AS variation
        FROM
          __experimentExposures e
        GROUP BY
          e.${baseIdType}
      ),
      -- One row per dimension slice
      dim_values AS (
        SELECT
          1 AS variation
          , ${this.castToString("''")} AS dimension_value
          , ${this.castToString("''")} AS dimension_name
          , COUNT(*) AS units
        FROM
          __distinctUnits
        UNION ALL
        ${params.dimensions
          .map((d) => this.getUnitCountCTE(`dim_exp_${d.id}`))
          .join("\nUNION ALL\n")}
      ),
      total_n AS (
        SELECT
          SUM(units) AS N
        FROM dim_values
        WHERE dimension_name = ''
      ),
      dim_values_sorted AS (
        SELECT
          dimension_name
          , dimension_value
          , units
          , ROW_NUMBER() OVER (PARTITION BY dimension_name ORDER BY units DESC) as rn
        FROM
          dim_values
        WHERE
          dimension_name != ''
      )
      SELECT
        dim_values_sorted.dimension_name AS dimension_name,
        dim_values_sorted.dimension_value AS dimension_value,
        dim_values_sorted.units AS units,
        n.N AS total_units
      FROM
        dim_values_sorted
      CROSS JOIN total_n n
      WHERE 
        rn <= 20
    `,
      this.getFormatDialect(),
    );
  }

  async runDimensionSlicesQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<DimensionSlicesQueryResponse> {
    const { rows, statistics } = await this.runQuery(query, setExternalId);
    return {
      rows: rows.map((row) => {
        return {
          dimension_value: row.dimension_value ?? "",
          dimension_name: row.dimension_name ?? "",
          units: parseInt(row.units) || 0,
          total_units: parseInt(row.total_units) || 0,
        };
      }),
      statistics: statistics,
    };
  }

  getUserExperimentExposuresQuery(
    params: UserExperimentExposuresQueryParams,
  ): string {
    const { userIdType } = params;
    // Get all exposure queries that match the specified userIdType
    const allExposureQueries = (
      this.datasource.settings.queries?.exposure || []
    )
      .map(({ id }) => this.getExposureQuery(id))
      .filter((query) => query.userIdType === userIdType); // Filter by userIdType

    // Collect all unique dimension names across all exposure queries
    const allDimensionNames = Array.from(
      new Set(allExposureQueries.flatMap((query) => query.dimensions || [])),
    );
    const startDate = subDays(new Date(), params.lookbackDays);

    return format(
      `-- User Exposures Query
      WITH __userExposures AS (
        ${allExposureQueries
          .map((exposureQuery, i) => {
            // Get all available dimensions for this exposure query
            const availableDimensions = exposureQuery.dimensions || [];
            const tableAlias = `t${i}`;

            // Create dimension columns for ALL possible dimensions
            const dimensionSelects = allDimensionNames.map((dim) => {
              if (availableDimensions.includes(dim)) {
                return `${this.castToString(`${tableAlias}.${dim}`)} AS ${dim}`;
              } else {
                return `${this.castToString("null")} AS ${dim}`;
              }
            });

            const dimensionSelectString = dimensionSelects.join(", ");

            return `
              SELECT timestamp, experiment_id, variation_id, ${dimensionSelectString} FROM (
                ${compileSqlTemplate(exposureQuery.query, {
                  startDate: startDate,
                })}
              ) ${tableAlias}
              WHERE ${this.castToString(exposureQuery.userIdType)} = '${params.unitId}' AND timestamp >= ${this.toTimestamp(startDate)}
            `;
          })
          .join("\nUNION ALL\n")}
      )
      SELECT * FROM __userExposures 
      ORDER BY timestamp DESC 
      LIMIT ${SQL_ROW_LIMIT}
      `,
      this.getFormatDialect(),
    );
  }

  getFeatureEvalDiagnosticsQuery(
    params: FeatureEvalDiagnosticsQueryParams,
  ): string {
    const featureKey = this.escapeStringLiteral(params.feature);
    const oneWeekAgo = subDays(new Date(), 7);

    // We only support one feature usage query per data source for now
    // Always use the first query in the array for now
    const featureEvalQuery = this.datasource.settings?.queries?.featureUsage
      ? this.datasource.settings.queries.featureUsage[0].query
      : "";

    return format(
      `-- Feature Evaluation Diagnostics Query
      WITH __featureEvalQuery AS (
        ${featureEvalQuery}
      )
      SELECT * FROM __featureEvalQuery
      WHERE feature_key = '${featureKey}' AND timestamp >= ${this.toTimestamp(oneWeekAgo)}
      ORDER BY timestamp DESC
      LIMIT 100
      `,
      this.getFormatDialect(),
    );
  }

  public async runUserExperimentExposuresQuery(
    query: string,
  ): Promise<UserExperimentExposuresQueryResponse> {
    const { rows, statistics } = await this.runQuery(query);

    // Check if SQL_ROW_LIMIT was reached
    const truncated = rows.length === SQL_ROW_LIMIT;

    return {
      rows: rows.map((row) => {
        return {
          timestamp: row.timestamp,
          experiment_id: row.experiment_id,
          variation_id: row.variation_id,
          ...row,
        };
      }),
      statistics,
      truncated,
    };
  }

  public async runFeatureEvalDiagnosticsQuery(
    query: string,
  ): Promise<FeatureEvalDiagnosticsQueryResponse> {
    const { rows, statistics } = await this.runQuery(query);

    // Check if SQL_ROW_LIMIT was reached
    const truncated = rows.length === SQL_ROW_LIMIT;

    return {
      rows: rows.map((row) => {
        return {
          timestamp: row.timestamp,
          feature_key: row.feature_key,
          ...row,
        };
      }),
      statistics,
      truncated,
    };
  }

  private getRaMetricPhaseStartSettings({
    // accounts for minimum delay from activation metric
    // and analysis metric
    minDelay,
    phaseStartDate,
    regressionAdjustmentHours,
  }: {
    minDelay: number;
    phaseStartDate: Date;
    regressionAdjustmentHours: number;
  }): CovariatePhaseStartSettings {
    const metricEnd = new Date(phaseStartDate);
    if (minDelay > 0) {
      metricEnd.setHours(metricEnd.getHours() + minDelay);
    }

    const metricStart = new Date(phaseStartDate);
    if (regressionAdjustmentHours > 0) {
      metricStart.setHours(metricStart.getHours() - regressionAdjustmentHours);
    }

    return {
      covariateStartDate: metricStart,
      covariateEndDate: metricEnd,
    };
  }

  private getMetricData(
    metricWithIndex: { metric: FactMetricInterface; index: number },
    settings: Pick<
      ExperimentSnapshotSettings,
      "attributionModel" | "regressionAdjustmentEnabled" | "startDate"
    > & { endDate?: Date },
    activationMetric: ExperimentMetricInterface | null,
    factTablesWithIndices: { factTable: FactTableInterface; index: number }[],
    alias: string,
  ): FactMetricData {
    const { metric, index: metricIndex } = metricWithIndex;
    const ratioMetric = isRatioMetric(metric);
    const funnelMetric = isFunnelMetric(metric);
    const quantileMetric = quantileMetricType(metric);
    const metricQuantileSettings: MetricQuantileSettings = (isFactMetric(
      metric,
    ) && !!quantileMetric
      ? metric.quantileSettings
      : undefined) ?? { type: "unit", quantile: 0, ignoreZeros: false };

    // redundant checks to make sure configuration makes sense and we only build expensive queries for the cases
    // where RA is actually possible
    const regressionAdjusted =
      settings.regressionAdjustmentEnabled && isRegressionAdjusted(metric);
    const regressionAdjustmentHours = regressionAdjusted
      ? (metric.regressionAdjustmentDays ?? 0) * 24
      : 0;

    const overrideConversionWindows =
      settings.attributionModel === "experimentDuration";

    // Get capping settings and final coalesce statement
    const isPercentileCapped = isPercentileCappedMetric(metric);
    const computeUncappedMetric = eligibleForUncappedMetric(metric);

    const numeratorSourceIndex =
      factTablesWithIndices.find(
        (f) => f.factTable.id === metric.numerator?.factTableId,
      )?.index ?? 0;
    const denominatorSourceIndex =
      factTablesWithIndices.find(
        (f) => f.factTable.id === metric.denominator?.factTableId,
      )?.index ?? 0;
    const numeratorAlias = `${numeratorSourceIndex === 0 ? "" : numeratorSourceIndex}`;
    const denominatorAlias = `${denominatorSourceIndex === 0 ? "" : denominatorSourceIndex}`;
    const capCoalesceMetric = this.capCoalesceValue({
      valueCol: `m${numeratorAlias}.${alias}_value`,
      metric,
      capTablePrefix: `cap${numeratorAlias}`,
      capValueCol: `${alias}_value_cap`,
      columnRef: metric.numerator,
    });
    const capCoalesceDenominator = this.capCoalesceValue({
      valueCol: `m${denominatorAlias}.${alias}_denominator`,
      metric,
      capTablePrefix: `cap${denominatorAlias}`,
      capValueCol: `${alias}_denominator_cap`,
      columnRef: metric.denominator,
    });
    const capCoalesceCovariate = this.capCoalesceValue({
      valueCol: `c${numeratorAlias}.${alias}_value`,
      metric,
      capTablePrefix: `cap${numeratorAlias}`,
      capValueCol: `${alias}_value_cap`,
      columnRef: metric.numerator,
    });
    const capCoalesceDenominatorCovariate = this.capCoalesceValue({
      valueCol: `c${denominatorAlias}.${alias}_denominator`,
      metric,
      capTablePrefix: `cap${denominatorAlias}`,
      capValueCol: `${alias}_denominator_cap`,
      columnRef: metric.denominator,
    });
    const uncappedMetric = {
      ...metric,
      cappingSettings: {
        type: "" as const,
        value: 0,
      },
    };
    const uncappedCoalesceMetric = this.capCoalesceValue({
      valueCol: `m${numeratorAlias}.${alias}_value`,
      metric: uncappedMetric,
      capTablePrefix: `cap${numeratorAlias}`,
      capValueCol: `${alias}_value_cap`,
      columnRef: metric.numerator,
    });
    const uncappedCoalesceDenominator = this.capCoalesceValue({
      valueCol: `m${denominatorAlias}.${alias}_denominator`,
      metric: uncappedMetric,
      capTablePrefix: `cap${denominatorAlias}`,
      capValueCol: `${alias}_denominator_cap`,
      columnRef: metric.denominator,
    });
    const uncappedCoalesceCovariate = this.capCoalesceValue({
      valueCol: `c${numeratorAlias}.${alias}_value`,
      metric: uncappedMetric,
      capTablePrefix: `cap${numeratorAlias}`,
      capValueCol: `${alias}_value_cap`,
      columnRef: metric.numerator,
    });
    const uncappedCoalesceDenominatorCovariate = this.capCoalesceValue({
      valueCol: `c${denominatorAlias}.${alias}_denominator`,
      metric: uncappedMetric,
      capTablePrefix: `cap${denominatorAlias}`,
      capValueCol: `${alias}_denominator_cap`,
      columnRef: metric.denominator,
    });
    // Get rough date filter for metrics to improve performance
    const orderedMetrics = (activationMetric ? [activationMetric] : []).concat([
      metric,
    ]);
    const minMetricDelay = this.getMetricMinDelay(orderedMetrics);
    const metricStart = this.getMetricStart(
      settings.startDate,
      minMetricDelay,
      regressionAdjustmentHours,
    );
    const metricEnd = this.getMetricEnd(
      orderedMetrics,
      settings.endDate,
      overrideConversionWindows,
    );

    const raMetricPhaseStartSettings = this.getRaMetricPhaseStartSettings({
      minDelay: minMetricDelay,
      phaseStartDate: settings.startDate,
      regressionAdjustmentHours,
    });
    const raMetricFirstExposureSettings = {
      hours: regressionAdjustmentHours,
      minDelay: minMetricDelay,
      alias,
    };

    const maxHoursToConvert = this.getMaxHoursToConvert(
      funnelMetric,
      [metric],
      activationMetric,
    );

    const numeratorAggFns = this.getAggregationMetadata({
      metric,
      useDenominator: false,
    });
    const denominatorAggFns = this.getAggregationMetadata({
      metric,
      useDenominator: true,
    });

    const covariateNumeratorAggFns = this.getAggregationMetadata({
      metric,
      useDenominator: false,
    });
    const covariateDenominatorAggFns = this.getAggregationMetadata({
      metric,
      useDenominator: true,
    });

    // Create aggregated value transformation function
    // For dailyParticipation metrics, this divides by the participation window
    // For all other metrics, this is an identity function
    const aggregatedValueTransformation =
      metric.metricType === "dailyParticipation"
        ? ({
            column,
            initialTimestampColumn,
            analysisEndDate,
          }: {
            column: string;
            initialTimestampColumn: string;
            analysisEndDate: Date;
          }) =>
            this.applyDailyParticipationTransformation({
              column,
              initialTimestampColumn,
              analysisEndDate,
              metric,
              overrideConversionWindows,
            })
        : ({ column }: { column: string }) => column;

    return {
      alias,
      id: metric.id,
      metric,
      metricIndex,
      ratioMetric,
      funnelMetric,
      quantileMetric,
      metricQuantileSettings,
      regressionAdjusted,
      regressionAdjustmentHours,
      overrideConversionWindows,
      isPercentileCapped,
      computeUncappedMetric,
      numeratorSourceIndex,
      denominatorSourceIndex,
      capCoalesceMetric,
      capCoalesceDenominator,
      capCoalesceCovariate,
      capCoalesceDenominatorCovariate,
      numeratorAggFns,
      denominatorAggFns,
      covariateNumeratorAggFns,
      covariateDenominatorAggFns,
      uncappedCoalesceMetric,
      uncappedCoalesceDenominator,
      uncappedCoalesceCovariate,
      uncappedCoalesceDenominatorCovariate,
      minMetricDelay,
      raMetricFirstExposureSettings,
      raMetricPhaseStartSettings,
      metricStart,
      metricEnd,
      maxHoursToConvert,
      aggregatedValueTransformation,
    };
  }

  getFactMetricQuantileData(
    metricData: FactMetricData[],
    quantileType: MetricQuantileSettings["type"],
  ): FactMetricQuantileData[] {
    const quantileData: FactMetricQuantileData[] = [];
    metricData
      .filter((m) => m.quantileMetric === quantileType)
      .forEach((m) => {
        quantileData.push({
          alias: m.alias,
          valueCol: `${m.alias}_value`,
          outputCol: `${m.alias}_value_quantile`,
          metricQuantileSettings: m.metricQuantileSettings,
        });
      });
    return quantileData;
  }

  getBanditCaseWhen(periods: Date[]) {
    return `
        , CASE
          ${periods
            .sort((a, b) => b.getTime() - a.getTime())
            .map((p) => {
              return `WHEN first_exposure_timestamp >= ${this.toTimestamp(
                p,
              )} THEN ${this.toTimestamp(p)}`;
            })
            .join("\n")}
        END AS bandit_period`;
  }

  getCovariateMetricCTE({
    dimensionCols,
    baseIdType,
    regressionAdjustedMetrics,
    sourceIndex,
  }: {
    dimensionCols: DimensionColumnData[];
    baseIdType: string;
    regressionAdjustedMetrics: FactMetricData[];
    sourceIndex: number;
  }): string {
    const suffix = `${sourceIndex === 0 ? "" : sourceIndex}`;

    return `
      SELECT 
        d.variation AS variation
        ${dimensionCols.map((c) => `, d.${c.alias} AS ${c.alias}`).join("")}
        , d.${baseIdType} AS ${baseIdType}
        ${regressionAdjustedMetrics
          .map(
            (metric) =>
              `${
                metric.numeratorSourceIndex === sourceIndex
                  ? `, ${metric.covariateNumeratorAggFns.fullAggregationFunction(
                      this.ifElse(
                        `m.timestamp >= d.${metric.alias}_preexposure_start AND m.timestamp < d.${metric.alias}_preexposure_end`,
                        `${metric.alias}_value`,
                        "NULL",
                      ),
                    )} as ${metric.alias}_value`
                  : ""
              }
                ${
                  metric.ratioMetric &&
                  metric.denominatorSourceIndex === sourceIndex
                    ? `, ${metric.covariateDenominatorAggFns.fullAggregationFunction(
                        this.ifElse(
                          `m.timestamp >= d.${metric.alias}_preexposure_start AND m.timestamp < d.${metric.alias}_preexposure_end`,
                          `${metric.alias}_denominator`,
                          "NULL",
                        ),
                      )} AS ${metric.alias}_denominator`
                    : ""
                }`,
          )
          .join("\n")}
      FROM
        __distinctUsers d
      JOIN __factTable${suffix} m ON (
        m.${baseIdType} = d.${baseIdType}
      )
      WHERE 
        m.timestamp >= d.min_preexposure_start
        AND m.timestamp < d.max_preexposure_end
      GROUP BY
        d.variation
        ${dimensionCols.map((c) => `, d.${c.alias}`).join("")}
        , d.${baseIdType}`;
  }

  getFactTablesForMetrics(
    metrics: { metric: FactMetricInterface; index: number }[],
    factTableMap: FactTableMap,
  ): {
    factTable: FactTableInterface;
    index: number;
    metrics: { metric: FactMetricInterface; index: number }[];
  }[] {
    const factTables: Record<
      string,
      {
        factTable: FactTableInterface;
        metrics: { metric: FactMetricInterface; index: number }[];
      }
    > = {};

    metrics.forEach(({ metric, index }) => {
      const numeratorFactTable = factTableMap.get(
        metric.numerator?.factTableId || "",
      );

      if (!numeratorFactTable) {
        throw new Error("Unknown fact table");
      }

      const existing = factTables[numeratorFactTable.id];
      if (existing) {
        existing.metrics.push({ metric, index });
      } else {
        factTables[numeratorFactTable.id] = {
          factTable: numeratorFactTable,
          metrics: [{ metric, index }],
        };
      }

      if (
        isRatioMetric(metric) &&
        metric.denominator?.factTableId &&
        // only need to check if denominator is in a different table from the numerator
        metric.denominator?.factTableId !== metric.numerator?.factTableId
      ) {
        const denominatorFactTable = factTableMap.get(
          metric.denominator?.factTableId || "",
        );
        if (!denominatorFactTable) {
          throw new Error("Unknown fact table");
        }

        const existing = factTables[denominatorFactTable.id];
        if (existing) {
          existing.metrics.push({ metric, index });
        } else {
          factTables[denominatorFactTable.id] = {
            factTable: denominatorFactTable,
            metrics: [{ metric, index }],
          };
        }
      }
    });

    if (Object.keys(factTables).length === 0) {
      throw new Error("No fact tables found");
    }
    // TODO(sql): Consider supporting more than two fact tables
    // for cases where you have < 20 metrics that span 3+ fact tables
    // and sometimes cross between them.
    if (Object.keys(factTables).length > 2) {
      throw new Error(
        "Only two fact tables at a time are supported at the moment",
      );
    }

    return Object.values(factTables).map((f, i) => ({
      factTable: f.factTable,
      index: i,
      metrics: f.metrics,
    }));
  }

  getExperimentFactMetricsQuery(
    params: ExperimentFactMetricsQueryParams,
  ): string {
    const { settings, segment } = params;
    const metricsWithIndices = cloneDeep(params.metrics).map((m, i) => ({
      metric: m,
      index: i,
    }));
    const activationMetric = this.processActivationMetric(
      params.activationMetric,
      settings,
    );

    metricsWithIndices.forEach((m) => {
      applyMetricOverrides(m.metric, settings);
    });
    // Replace any placeholders in the user defined dimension SQL
    const { unitDimensions } = this.processDimensions(
      params.dimensions,
      settings,
      activationMetric,
    );

    const factTableMap = params.factTableMap;

    const factTablesWithIndices = this.getFactTablesForMetrics(
      metricsWithIndices,
      factTableMap,
    );

    const factTable = factTablesWithIndices[0]?.factTable;

    const queryName = `${
      factTablesWithIndices.length === 1
        ? `Fact Table`
        : `Cross-Fact Table Metrics`
    }: ${factTablesWithIndices.map((f) => f.factTable.name).join(" & ")}`;

    const userIdType =
      params.forcedUserIdType ??
      this.getExposureQuery(settings.exposureQueryId || "").userIdType;

    const metricData = metricsWithIndices.map((metric) =>
      this.getMetricData(
        metric,
        settings,
        activationMetric,
        factTablesWithIndices,
        `m${metric.index}`,
      ),
    );

    // TODO(sql): Separate metric start by fact table
    const raMetricSettings = metricData
      .filter((m) => m.regressionAdjusted)
      .map((m) => m.raMetricFirstExposureSettings);
    const maxHoursToConvert = Math.max(
      ...metricData.map((m) => m.maxHoursToConvert),
    );
    const metricStart = metricData.reduce(
      (min, d) => (d.metricStart < min ? d.metricStart : min),
      settings.startDate,
    );
    const metricEnd = metricData.reduce(
      (max, d) => (d.metricEnd && d.metricEnd > max ? d.metricEnd : max),
      settings.endDate,
    );

    // Get any required identity join queries
    const idTypeObjects = [[userIdType], factTable.userIdTypes || []];
    // add idTypes usually handled in units query here in the case where
    // we don't have a separate table for the units query
    if (params.unitsSource === "exposureQuery") {
      idTypeObjects.push(
        ...unitDimensions.map((d) => [d.dimension.userIdType || "user_id"]),
        segment ? [segment.userIdType || "user_id"] : [],
        activationMetric ? getUserIdTypes(activationMetric, factTableMap) : [],
      );
    }
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE({
      objects: idTypeObjects,
      from: settings.startDate,
      to: settings.endDate,
      forcedBaseIdType: userIdType,
      experimentId: settings.experimentId,
    });

    // Get date range for experiment and analysis
    const endDate: Date = this.getExperimentEndDate(
      settings,
      maxHoursToConvert,
    );

    const banditDates = settings.banditSettings?.historicalWeights.map(
      (w) => w.date,
    );

    const dimensionCols: DimensionColumnData[] = params.dimensions.map((d) =>
      this.getDimensionCol(d),
    );
    // if bandit and there is no dimension column, we need to create a dummy column to make some of the joins
    // work later on. `"dimension"` is a special column that gbstats can handle if there is no dimension
    // column specified. See `BANDIT_DIMENSION` in gbstats.py.
    if (banditDates?.length && dimensionCols.length === 0) {
      dimensionCols.push({
        alias: "dimension",
        value: this.castToString("'All'"),
      });
    }

    const computeOnActivatedUsersOnly =
      activationMetric !== null &&
      !params.dimensions.some((d) => d.type === "activation");
    const timestampColumn = computeOnActivatedUsersOnly
      ? "first_activation_timestamp"
      : "first_exposure_timestamp";

    const distinctUsersWhere: string[] = [];

    // If activation metric, drop non-activated users unless doing
    // splits by activation metric
    if (computeOnActivatedUsersOnly) {
      distinctUsersWhere.push("first_activation_timestamp IS NOT NULL");
    }
    if (settings.skipPartialData) {
      distinctUsersWhere.push(
        `${timestampColumn} <= ${this.toTimestamp(endDate)}`,
      );
    }

    // TODO(sql): refactor so this is a property of the source table itself
    const percentileTableIndices = new Set<number>();
    const percentileData: FactMetricPercentileData[] = [];
    metricData
      .filter((m) => m.isPercentileCapped)
      .forEach((m) => {
        percentileData.push({
          valueCol: `${m.alias}_value`,
          outputCol: `${m.alias}_value_cap`,
          percentile: m.metric.cappingSettings.value ?? 1,
          ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
          sourceIndex: m.numeratorSourceIndex,
        });
        percentileTableIndices.add(m.numeratorSourceIndex);
        if (m.ratioMetric) {
          percentileData.push({
            valueCol: `${m.alias}_denominator`,
            outputCol: `${m.alias}_denominator_cap`,
            percentile: m.metric.cappingSettings.value ?? 1,
            ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
            sourceIndex: m.denominatorSourceIndex,
          });
          percentileTableIndices.add(m.denominatorSourceIndex);
        }
      });

    const eventQuantileData = this.getFactMetricQuantileData(
      metricData,
      "event",
    );
    // TODO(sql): error if event quantiles have two tables

    if (
      params.dimensions.length > 1 &&
      metricData.some((m) => !!m.quantileMetric)
    ) {
      throw new Error(
        "ImplementationError: quantile metrics are not supported with pre-computed dimension breakdowns",
      );
    }

    const regressionAdjustedMetrics = metricData.filter(
      (m) => m.regressionAdjusted,
    );
    // TODO(sql): refactor so this is a property of the source table itself
    const regressionAdjustedTableIndices = new Set<number>();
    regressionAdjustedMetrics.forEach((m) => {
      regressionAdjustedTableIndices.add(m.numeratorSourceIndex);
      if (
        m.ratioMetric &&
        m.denominatorSourceIndex !== m.numeratorSourceIndex
      ) {
        regressionAdjustedTableIndices.add(m.denominatorSourceIndex);
      }
    });

    return format(
      `-- ${queryName}
    WITH
      ${idJoinSQL}
      ${
        params.unitsSource === "exposureQuery"
          ? `${this.getExperimentUnitsQuery({
              ...params,
              includeIdJoins: false,
            })},`
          : params.unitsSource === "otherQuery"
            ? params.unitsSql
            : ""
      }
      __distinctUsers AS (
        SELECT
          ${baseIdType}
          ${dimensionCols.map((c) => `, ${c.value} AS ${c.alias}`).join("")}
          , variation
          , ${timestampColumn} AS timestamp
          , ${this.dateTrunc("first_exposure_timestamp")} AS first_exposure_date
          ${banditDates?.length ? this.getBanditCaseWhen(banditDates) : ""}
          ${
            raMetricSettings.length > 0
              ? `
              , ${this.addHours(
                "first_exposure_timestamp",
                Math.min(...raMetricSettings.map((s) => s.minDelay - s.hours)),
              )} as min_preexposure_start
              , ${this.addHours(
                "first_exposure_timestamp",
                Math.max(...raMetricSettings.map((s) => s.minDelay)),
              )} as max_preexposure_end
            `
              : ""
          }
      ${raMetricSettings
        .map(
          ({ alias, hours, minDelay }) => `
              , ${this.addHours(
                "first_exposure_timestamp",
                minDelay,
              )} AS ${alias}_preexposure_end
              , ${this.addHours(
                "first_exposure_timestamp",
                minDelay - hours,
              )} AS ${alias}_preexposure_start`,
        )
        .join("\n")}
        FROM ${
          params.unitsSource === "exposureTable"
            ? `${params.unitsTableFullName}`
            : "__experimentUnits"
        }
        ${
          distinctUsersWhere.length
            ? `WHERE ${distinctUsersWhere.join(" AND ")}`
            : ""
        }
      )
      ${factTablesWithIndices
        .map(
          (f) =>
            `, __factTable${f.index === 0 ? "" : f.index} as (
          ${this.getFactMetricCTE({
            baseIdType,
            idJoinMap,
            factTable: f.factTable,
            metricsWithIndices,
            endDate: metricEnd,
            startDate: metricStart,
            experimentId: settings.experimentId,
            addFiltersToWhere: true,
            phase: settings.phase,
            customFields: settings.customFields,
          })}
        )
        , __userMetricJoin${f.index === 0 ? "" : f.index} as (
          SELECT
            d.variation AS variation
            , d.timestamp AS timestamp
            ${dimensionCols.map((c) => `, d.${c.alias} AS ${c.alias}`).join("")}
            ${banditDates?.length ? `, d.bandit_period AS bandit_period` : ""}
            , d.${baseIdType} AS ${baseIdType}
            ${metricData
              .map(
                (data) =>
                  `${
                    data.numeratorSourceIndex === f.index
                      ? `, ${this.addCaseWhenTimeFilter({
                          col: `m.${data.alias}_value`,
                          metric: data.metric,
                          overrideConversionWindows:
                            data.overrideConversionWindows,
                          endDate: settings.endDate,
                          metricQuantileSettings: data.quantileMetric
                            ? data.metricQuantileSettings
                            : undefined,
                          metricTimestampColExpr: "m.timestamp",
                          exposureTimestampColExpr: "d.timestamp",
                        })} as ${data.alias}_value`
                      : ""
                  }
                  ${
                    data.ratioMetric && data.denominatorSourceIndex === f.index
                      ? `, ${this.addCaseWhenTimeFilter({
                          col: `m.${data.alias}_denominator`,
                          metric: data.metric,
                          overrideConversionWindows:
                            data.overrideConversionWindows,
                          endDate: settings.endDate,
                          metricTimestampColExpr: "m.timestamp",
                          exposureTimestampColExpr: "d.timestamp",
                        })} as ${data.alias}_denominator`
                      : ""
                  }
                  `,
              )
              .join("\n")}
          FROM
            __distinctUsers d
          LEFT JOIN __factTable${f.index === 0 ? "" : f.index} m ON (
            m.${baseIdType} = d.${baseIdType}
          )
        )
      ${
        eventQuantileData.length
          ? `
        , __eventQuantileMetric${f.index === 0 ? "" : f.index} AS (
          SELECT
          m.variation AS variation
          ${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
          ${eventQuantileData
            .map((data) =>
              this.getQuantileGridColumns(
                data.metricQuantileSettings,
                `${data.alias}_`,
              ),
            )
            .join("\n")}
        FROM
          __userMetricJoin${f.index === 0 ? "" : f.index} m
        GROUP BY
          m.variation
          ${dimensionCols.map((c) => `, m.${c.alias}`).join("")}
        )`
          : ""
      }
      , __userMetricAgg${f.index === 0 ? "" : f.index} as (
        -- Add in the aggregate metric value for each user
        SELECT
          umj.variation
          ${dimensionCols.map((c) => `, umj.${c.alias} AS ${c.alias}`).join("")}
          ${banditDates?.length ? `, umj.bandit_period` : ""}
          , umj.${baseIdType}
          ${metricData
            .map((data) => {
              return `${
                data.numeratorSourceIndex === f.index
                  ? `, ${data.aggregatedValueTransformation({
                      column: data.numeratorAggFns.fullAggregationFunction(
                        `umj.${data.alias}_value`,
                        `qm.${data.alias}_quantile`,
                      ),
                      initialTimestampColumn: "MIN(umj.timestamp)",
                      analysisEndDate: params.settings.endDate,
                    })} AS ${data.alias}_value`
                  : ""
              }
                ${
                  data.ratioMetric && data.denominatorSourceIndex === f.index
                    ? `, ${data.aggregatedValueTransformation({
                        column: data.denominatorAggFns.fullAggregationFunction(
                          `umj.${data.alias}_denominator`,
                          `qm.${data.alias}_quantile`,
                        ),
                        initialTimestampColumn: "MIN(umj.timestamp)",
                        analysisEndDate: params.settings.endDate,
                      })} AS ${data.alias}_denominator`
                    : ""
                }`;
            })
            .join("\n")}
          ${eventQuantileData
            .map(
              (data) =>
                `, COUNT(umj.${data.alias}_value) AS ${data.alias}_n_events`,
            )
            .join("\n")}
        FROM
          __userMetricJoin${f.index === 0 ? "" : f.index} umj
        ${
          eventQuantileData.length
            ? `
        LEFT JOIN __eventQuantileMetric${f.index === 0 ? "" : f.index} qm
        ON (qm.variation = umj.variation ${dimensionCols
          .map((c) => `AND qm.${c.alias} = umj.${c.alias}`)
          .join("\n")})`
            : ""
        }
        GROUP BY
          umj.variation
          ${dimensionCols.map((c) => `, umj.${c.alias}`).join("")}
          ${banditDates?.length ? `, umj.bandit_period` : ""}
          , umj.${baseIdType}
      )
      ${
        percentileTableIndices.has(f.index)
          ? `
        , __capValue${f.index === 0 ? "" : f.index} AS (
            ${this.percentileCapSelectClause(
              percentileData.filter((p) => p.sourceIndex === f.index),
              `__userMetricAgg${f.index === 0 ? "" : f.index}`,
            )}
        )
        `
          : ""
      }
      ${
        regressionAdjustedTableIndices.has(f.index)
          ? `
        , __userCovariateMetric${f.index === 0 ? "" : f.index} as (
          ${this.getCovariateMetricCTE({ dimensionCols, baseIdType, regressionAdjustedMetrics, sourceIndex: f.index })}
        )
        `
          : ""
      }`,
        )
        .join("\n")}    
      ${
        banditDates?.length
          ? this.getBanditStatisticsFactMetricCTE({
              baseIdType,
              metricData,
              dimensionCols,
              factTablesWithIndices,
              regressionAdjustedTableIndices,
              percentileTableIndices,
            })
          : `
      -- One row per variation/dimension with aggregations
      ${this.getExperimentFactMetricStatisticsCTE({
        dimensionCols,
        metricData,
        eventQuantileData,
        baseIdType,
        joinedMetricTableName: "__userMetricAgg",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices,
        regressionAdjustedTableIndices,
        percentileTableIndices,
      })}
      `
      }`,
      this.getFormatDialect(),
    );
  }

  getExperimentFactMetricStatisticsCTE({
    dimensionCols,
    metricData,
    eventQuantileData,
    baseIdType,
    joinedMetricTableName,
    eventQuantileTableName,
    cupedMetricTableName,
    capValueTableName,
    factTablesWithIndices,
    regressionAdjustedTableIndices,
    percentileTableIndices,
  }: {
    dimensionCols: DimensionColumnData[];
    metricData: FactMetricData[];
    eventQuantileData: FactMetricQuantileData[];
    baseIdType: string;
    joinedMetricTableName: string;
    eventQuantileTableName: string;
    cupedMetricTableName: string;
    capValueTableName: string;
    factTablesWithIndices: { factTable: FactTableInterface; index: number }[];
    regressionAdjustedTableIndices: Set<number>;
    percentileTableIndices: Set<number>;
  }): string {
    return `SELECT
        m.variation AS variation
        ${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
        , COUNT(*) AS users
        ${metricData
          .map((data) => {
            //TODO test numerator suffix capping
            const numeratorSuffix = `${data.numeratorSourceIndex === 0 ? "" : data.numeratorSourceIndex}`;
            return `
           , ${this.castToString(`'${data.id}'`)} as ${data.alias}_id
            ${
              data.computeUncappedMetric
                ? `
                , SUM(${data.uncappedCoalesceMetric}) AS ${data.alias}_main_sum_uncapped 
                , SUM(POWER(${data.uncappedCoalesceMetric}, 2)) AS ${data.alias}_main_sum_squares_uncapped
                ${
                  data.isPercentileCapped
                    ? `
                    , MAX(COALESCE(cap${numeratorSuffix}.${data.alias}_value_cap, 0)) as ${data.alias}_main_cap_value 
                    `
                    : ""
                }
                `
                : ""
            }
            , SUM(${data.capCoalesceMetric}) AS ${data.alias}_main_sum
            , SUM(POWER(${data.capCoalesceMetric}, 2)) AS ${
              data.alias
            }_main_sum_squares
            ${
              data.quantileMetric === "event"
                ? `
              , SUM(COALESCE(m.${data.alias}_n_events, 0)) AS ${
                data.alias
              }_denominator_sum
              , SUM(POWER(COALESCE(m.${data.alias}_n_events, 0), 2)) AS ${
                data.alias
              }_denominator_sum_squares
              , SUM(COALESCE(m.${data.alias}_n_events, 0) * ${
                data.capCoalesceMetric
              }) AS ${data.alias}_main_denominator_sum_product
              , SUM(COALESCE(m.${data.alias}_n_events, 0)) AS ${
                data.alias
              }_quantile_n
              , MAX(qm.${data.alias}_quantile) AS ${data.alias}_quantile
                ${N_STAR_VALUES.map(
                  (
                    n,
                  ) => `, MAX(qm.${data.alias}_quantile_lower_${n}) AS ${data.alias}_quantile_lower_${n}
                        , MAX(qm.${data.alias}_quantile_upper_${n}) AS ${data.alias}_quantile_upper_${n}`,
                ).join("\n")}`
                : ""
            }
            ${
              data.quantileMetric === "unit"
                ? `${this.getQuantileGridColumns(
                    data.metricQuantileSettings,
                    `${data.alias}_`,
                  )}
                  , COUNT(m.${data.alias}_value) AS ${data.alias}_quantile_n`
                : ""
            }
            ${
              data.ratioMetric
                ? `
                ${
                  data.computeUncappedMetric
                    ? `
                    , SUM(${data.uncappedCoalesceDenominator}) AS ${data.alias}_denominator_sum_uncapped 
                    , SUM(POWER(${data.uncappedCoalesceDenominator}, 2)) AS ${data.alias}_denominator_sum_squares_uncapped
                    , SUM(${data.uncappedCoalesceMetric} * ${data.uncappedCoalesceDenominator}) AS ${data.alias}_main_denominator_sum_product_uncapped                    
                    ${
                      data.isPercentileCapped
                        ? `
                    , MAX(COALESCE(cap${data.denominatorSourceIndex === 0 ? "" : data.denominatorSourceIndex}.${data.alias}_denominator_cap, 0)) as ${data.alias}_denominator_cap_value
                    `
                        : ""
                    }
                    `
                    : ""
                }
                , SUM(${data.capCoalesceDenominator}) AS 
                  ${data.alias}_denominator_sum
                , SUM(POWER(${data.capCoalesceDenominator}, 2)) AS 
                  ${data.alias}_denominator_sum_squares
                ${
                  data.regressionAdjusted
                    ? `
                  ${
                    data.computeUncappedMetric
                      ? `
                      , SUM(${data.uncappedCoalesceCovariate}) AS ${data.alias}_covariate_sum_uncapped
                      , SUM(POWER(${data.uncappedCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares_uncapped
                      , SUM(${data.uncappedCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_pre_sum_uncapped 
                      , SUM(POWER(${data.uncappedCoalesceDenominatorCovariate}, 2)) AS ${data.alias}_denominator_pre_sum_squares_uncapped
                      , SUM(${data.uncappedCoalesceMetric} * ${data.uncappedCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product_uncapped
                      , SUM(${data.uncappedCoalesceMetric} * ${data.uncappedCoalesceDenominatorCovariate}) AS ${data.alias}_main_post_denominator_pre_sum_product_uncapped
                      , SUM(${data.uncappedCoalesceCovariate} * ${data.uncappedCoalesceDenominator}) AS ${data.alias}_main_pre_denominator_post_sum_product_uncapped
                      , SUM(${data.uncappedCoalesceCovariate} * ${data.uncappedCoalesceDenominatorCovariate}) AS ${data.alias}_main_pre_denominator_pre_sum_product_uncapped
                      , SUM(${data.uncappedCoalesceDenominator} * ${data.uncappedCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_post_denominator_pre_sum_product_uncapped`
                      : ""
                  }
                  , SUM(${data.capCoalesceCovariate}) AS ${data.alias}_covariate_sum
                  , SUM(POWER(${data.capCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares
                  , SUM(${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_pre_sum
                  , SUM(POWER(${data.capCoalesceDenominatorCovariate}, 2)) AS ${data.alias}_denominator_pre_sum_squares
                  , SUM(${data.capCoalesceMetric} * ${data.capCoalesceDenominator}) AS ${data.alias}_main_denominator_sum_product
                  , SUM(${data.capCoalesceMetric} * ${data.capCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product
                  , SUM(${data.capCoalesceMetric} * ${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_main_post_denominator_pre_sum_product
                  , SUM(${data.capCoalesceCovariate} * ${data.capCoalesceDenominator}) AS ${data.alias}_main_pre_denominator_post_sum_product
                  , SUM(${data.capCoalesceCovariate} * ${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_main_pre_denominator_pre_sum_product
                  , SUM(${data.capCoalesceDenominator} * ${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_post_denominator_pre_sum_product
                  `
                    : `
                    , SUM(${data.capCoalesceDenominator} * ${data.capCoalesceMetric}) AS ${data.alias}_main_denominator_sum_product
                  `
                }` /*ends ifelse regressionAdjusted*/
                : ` 
              ${
                data.regressionAdjusted
                  ? `
                  ${
                    data.computeUncappedMetric
                      ? `
                      , SUM(${data.uncappedCoalesceCovariate}) AS ${data.alias}_covariate_sum_uncapped
                      , SUM(POWER(${data.uncappedCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares_uncapped
                      , SUM(${data.uncappedCoalesceMetric} * ${data.uncappedCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product_uncapped
                      `
                      : ""
                  }  
                , SUM(${data.capCoalesceCovariate}) AS ${data.alias}_covariate_sum
                , SUM(POWER(${data.capCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares
                , SUM(${data.capCoalesceMetric} * ${data.capCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product
                `
                  : ""
              }
            `
            }
          `; /*ends ifelse ratioMetric*/
          })
          .join("\n")}
      FROM
        ${joinedMetricTableName} m
        ${
          eventQuantileData.length // TODO(sql): error if event quantiles have two tables
            ? `LEFT JOIN ${eventQuantileTableName} qm ON (
          qm.variation = m.variation 
          ${dimensionCols
            .map((c) => `AND qm.${c.alias} = m.${c.alias}`)
            .join("\n")}
            )`
            : ""
        }
      ${factTablesWithIndices
        .map(({ factTable: _, index }) => {
          const suffix = `${index === 0 ? "" : index}`;
          return `
        ${
          index === 0
            ? ""
            : `LEFT JOIN ${joinedMetricTableName}${suffix} m${suffix} ON (
          m${suffix}.${baseIdType} = m.${baseIdType}
        )`
        }
        ${
          regressionAdjustedTableIndices.has(index)
            ? `
          LEFT JOIN ${cupedMetricTableName}${suffix} c${suffix} ON (
            c${suffix}.${baseIdType} = m${suffix}.${baseIdType}
          )
        `
            : ""
        }
        ${
          percentileTableIndices.has(index)
            ? `
          CROSS JOIN ${capValueTableName}${suffix} cap${suffix}
        `
            : ""
        }
        `;
        })
        .join("\n")}
      GROUP BY
        m.variation
        ${dimensionCols.map((c) => `, m.${c.alias}`).join("")}
    `;
  }

  getDimensionCol(dimension: Dimension): DimensionColumnData {
    switch (dimension.type) {
      case "experiment":
        return {
          value: `dim_exp_${dimension.id}`,
          alias: `dim_exp_${dimension.id}`,
        };
      case "user":
        return {
          value: `dim_unit_${dimension.dimension.id}`,
          alias: `dim_unit_${dimension.dimension.id}`,
        };
      case "date":
        return {
          value: `${this.formatDate(
            this.dateTrunc("first_exposure_timestamp"),
          )}`,
          alias: "dim_pre_date",
        };
      case "activation":
        return {
          value: this.ifElse(
            `first_activation_timestamp IS NULL`,
            "'Not Activated'",
            "'Activated'",
          ),
          alias: "dim_activation",
        };
    }
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
    const metric = cloneDeep<MetricInterface>(metricDoc);
    const denominatorMetrics = cloneDeep<MetricInterface[]>(
      denominatorMetricsDocs,
    );
    const activationMetric = this.processActivationMetric(
      activationMetricDoc,
      settings,
    );

    applyMetricOverrides(metric, settings);
    denominatorMetrics.forEach((m) => applyMetricOverrides(m, settings));

    // Replace any placeholders in the user defined dimension SQL
    const { unitDimensions } = this.processDimensions(
      params.dimensions,
      settings,
      activationMetric,
    );

    const userIdType =
      params.forcedUserIdType ??
      this.getExposureQuery(settings.exposureQueryId || "").userIdType;

    const denominator =
      denominatorMetrics.length > 0
        ? denominatorMetrics[denominatorMetrics.length - 1]
        : undefined;
    // If the denominator is a binomial, it's just acting as a filter
    // e.g. "Purchase/Signup" is filtering to users who signed up and then counting purchases
    // When the denominator is a count, it's a real ratio, dividing two quantities
    // e.g. "Pages/Session" is dividing number of page views by number of sessions
    const ratioMetric = isRatioMetric(metric, denominator);
    const funnelMetric = isFunnelMetric(metric, denominator);

    const banditDates = settings.banditSettings?.historicalWeights.map(
      (w) => w.date,
    );

    // redundant checks to make sure configuration makes sense and we only build expensive queries for the cases
    // where RA is actually possible
    const regressionAdjusted =
      settings.regressionAdjustmentEnabled &&
      isRegressionAdjusted(metric, denominator) &&
      // and block RA for experiment metric query only, only works for optimized queries
      !isRatioMetric(metric, denominator);

    const regressionAdjustmentHours = regressionAdjusted
      ? (metric.regressionAdjustmentDays ?? 0) * 24
      : 0;

    const overrideConversionWindows =
      settings.attributionModel === "experimentDuration";

    // Get capping settings and final coalesce statement
    const isPercentileCapped = isPercentileCappedMetric(metric);
    const computeUncappedMetric = eligibleForUncappedMetric(metric);

    const denominatorIsPercentileCapped = denominator
      ? isPercentileCappedMetric(denominator)
      : false;

    const denominatorComputeUncappedMetric = denominator
      ? eligibleForUncappedMetric(denominator)
      : false;

    const capCoalesceMetric = this.capCoalesceValue({
      valueCol: "m.value",
      metric,
      capTablePrefix: "cap",
      columnRef: null,
    });
    const capCoalesceDenominator = denominator
      ? this.capCoalesceValue({
          valueCol: "d.value",
          metric: denominator,
          capTablePrefix: "capd",
          columnRef: null,
        })
      : "";
    const capCoalesceCovariate = this.capCoalesceValue({
      valueCol: "c.value",
      metric: metric,
      capTablePrefix: "cap",
      columnRef: null,
    });
    const uncappedMetric = {
      ...metric,
      cappingSettings: {
        type: "" as const,
        value: 0,
      },
    };
    const uncappedDenominator = denominator
      ? {
          ...denominator,
          cappingSettings: {
            type: "" as const,
            value: 0,
          },
        }
      : undefined;
    const uncappedCovariate = {
      ...metric,
      cappingSettings: {
        type: "" as const,
        value: 0,
      },
    };
    const uncappedCoalesceMetric = this.capCoalesceValue({
      valueCol: "m.value",
      metric: uncappedMetric,
      capTablePrefix: "cap",
      columnRef: null,
    });
    const uncappedCoalesceDenominator = uncappedDenominator
      ? this.capCoalesceValue({
          valueCol: "d.value",
          metric: uncappedDenominator,
          capTablePrefix: "capd",
          columnRef: null,
        })
      : "";
    const uncappedCoalesceCovariate = this.capCoalesceValue({
      valueCol: "c.value",
      metric: uncappedCovariate,
      capTablePrefix: "cap",
      columnRef: null,
    });
    // Get rough date filter for metrics to improve performance
    const orderedMetrics = (activationMetric ? [activationMetric] : [])
      .concat(denominatorMetrics)
      .concat([metric]);
    const minMetricDelay = this.getMetricMinDelay(orderedMetrics);
    const metricStart = this.getMetricStart(
      settings.startDate,
      minMetricDelay,
      regressionAdjustmentHours,
    );
    const metricEnd = this.getMetricEnd(
      orderedMetrics,
      settings.endDate,
      overrideConversionWindows,
    );

    // Get any required identity join queries
    const idTypeObjects = [
      [userIdType],
      getUserIdTypes(metric, factTableMap),
      ...denominatorMetrics.map((m) => getUserIdTypes(m, factTableMap, true)),
    ];
    // add idTypes usually handled in units query here in the case where
    // we don't have a separate table for the units query
    if (params.unitsSource === "exposureQuery") {
      idTypeObjects.push(
        ...unitDimensions.map((d) => [d.dimension.userIdType || "user_id"]),
        segment ? [segment.userIdType || "user_id"] : [],
        activationMetric ? getUserIdTypes(activationMetric, factTableMap) : [],
      );
    }
    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE({
      objects: idTypeObjects,
      from: settings.startDate,
      to: settings.endDate,
      forcedBaseIdType: userIdType,
      experimentId: settings.experimentId,
    });

    // Get date range for experiment and analysis
    const endDate: Date = this.getExperimentEndDate(
      settings,
      this.getMaxHoursToConvert(
        funnelMetric,
        [metric].concat(denominatorMetrics),
        activationMetric,
      ),
    );

    const dimensionCols = params.dimensions.map((d) => this.getDimensionCol(d));
    // if bandit and there is no dimension column, we need to create a dummy column to make some of the joins
    // work later on. `"dimension"` is a special column that gbstats can handle if there is no dimension
    // column specified. See `BANDIT_DIMENSION` in gbstats.py.
    if (banditDates?.length && dimensionCols.length === 0) {
      dimensionCols.push({
        alias: "dimension",
        value: this.castToString("'All'"),
      });
    }

    const computeOnActivatedUsersOnly =
      activationMetric !== null &&
      !params.dimensions.some((d) => d.type === "activation");
    const timestampColumn = computeOnActivatedUsersOnly
      ? "first_activation_timestamp"
      : "first_exposure_timestamp";

    const distinctUsersWhere: string[] = [];

    if (computeOnActivatedUsersOnly) {
      distinctUsersWhere.push("first_activation_timestamp IS NOT NULL");
    }
    if (settings.skipPartialData) {
      distinctUsersWhere.push(
        `${timestampColumn} <= ${this.toTimestamp(endDate)}`,
      );
    }

    return format(
      `-- ${metric.name} (${metric.type})
    WITH
      ${idJoinSQL}
      ${
        params.unitsSource === "exposureQuery"
          ? `${this.getExperimentUnitsQuery({
              ...params,
              includeIdJoins: false,
            })},`
          : params.unitsSource === "otherQuery"
            ? params.unitsSql
            : ""
      }
      __distinctUsers AS (
        SELECT
          ${baseIdType}
          ${dimensionCols.map((c) => `, ${c.value} AS ${c.alias}`).join("")}
          , variation
          , ${timestampColumn} AS timestamp
          , ${this.dateTrunc("first_exposure_timestamp")} AS first_exposure_date
          ${banditDates?.length ? this.getBanditCaseWhen(banditDates) : ""}
          ${
            regressionAdjusted
              ? `, ${this.addHours(
                  "first_exposure_timestamp",
                  minMetricDelay,
                )} AS preexposure_end
                , ${this.addHours(
                  "first_exposure_timestamp",
                  minMetricDelay - regressionAdjustmentHours,
                )} AS preexposure_start`
              : ""
          }
        FROM ${
          params.unitsSource === "exposureTable"
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
        phase: settings.phase,
        customFields: settings.customFields,
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
            phase: settings.phase,
            customFields: settings.customFields,
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
              settings.endDate,
              dimensionCols,
              regressionAdjusted,
              overrideConversionWindows,
              banditDates,
              "__denominator",
              "__distinctUsers",
            )})`
          : ""
      }
      , __userMetricJoin as (
        SELECT
          d.variation AS variation
          ${dimensionCols.map((c) => `, d.${c.alias} AS ${c.alias}`).join("")}
          ${banditDates?.length ? `, d.bandit_period AS bandit_period` : ""}
          , d.${baseIdType} AS ${baseIdType}
          , ${this.addCaseWhenTimeFilter({
            col: "m.value",
            metric,
            overrideConversionWindows,
            endDate: settings.endDate,
            metricTimestampColExpr: "m.timestamp",
            exposureTimestampColExpr: "d.timestamp",
          })} as value
        FROM
          ${funnelMetric ? "__denominatorUsers" : "__distinctUsers"} d
        LEFT JOIN __metric m ON (
          m.${baseIdType} = d.${baseIdType}
        )
      )
      , __userMetricAgg as (
        -- Add in the aggregate metric value for each user
        SELECT
          umj.variation AS variation
          ${dimensionCols.map((c) => `, umj.${c.alias} AS ${c.alias}`).join("")}
          ${banditDates?.length ? `, umj.bandit_period AS bandit_period` : ""}
          , umj.${baseIdType}
          , ${this.getAggregateMetricColumnLegacyMetrics({
            metric,
          })} as value
        FROM
          __userMetricJoin umj
        GROUP BY
          umj.variation
          ${dimensionCols.map((c) => `, umj.${c.alias}`).join("")}
          ${banditDates?.length ? `, umj.bandit_period` : ""}
          , umj.${baseIdType}
      )
      ${
        isPercentileCapped
          ? `
        , __capValue AS (
            ${this.percentileCapSelectClause(
              [
                {
                  valueCol: "value",
                  outputCol: "value_cap",
                  percentile: metric.cappingSettings.value ?? 1,
                  ignoreZeros: metric.cappingSettings.ignoreZeros ?? false,
                  sourceIndex: 0,
                },
              ],
              "__userMetricAgg",
              `WHERE value IS NOT NULL${
                metric.cappingSettings.ignoreZeros ? " AND value != 0" : ""
              }`,
            )}
        )
        `
          : ""
      }
      ${
        denominator && ratioMetric
          ? `, __userDenominatorAgg AS (
              SELECT
                d.variation AS variation
                ${dimensionCols
                  .map((c) => `, d.${c.alias} AS ${c.alias}`)
                  .join("")}
                ${
                  banditDates?.length
                    ? `, d.bandit_period AS bandit_period`
                    : ""
                }
                , d.${baseIdType} AS ${baseIdType}
                , ${this.getAggregateMetricColumnLegacyMetrics({
                  metric: denominator,
                })} as value
              FROM
                __distinctUsers d
                JOIN __denominator${denominatorMetrics.length - 1} m ON (
                  m.${baseIdType} = d.${baseIdType}
                )
              WHERE
                ${this.getConversionWindowClause(
                  "d.timestamp",
                  "m.timestamp",
                  denominator,
                  settings.endDate,
                  overrideConversionWindows,
                )}
              GROUP BY
                d.variation
                ${dimensionCols.map((c) => `, d.${c.alias}`).join("")}
                ${banditDates?.length ? `, d.bandit_period` : ""}
                , d.${baseIdType}
            )
            ${
              denominator && denominatorIsPercentileCapped
                ? `
              , __capValueDenominator AS (
                ${this.percentileCapSelectClause(
                  [
                    {
                      valueCol: "value",
                      outputCol: "value_cap",
                      percentile: denominator.cappingSettings.value ?? 1,
                      ignoreZeros:
                        denominator.cappingSettings.ignoreZeros ?? false,
                      sourceIndex: 0,
                    },
                  ],
                  "__userDenominatorAgg",
                  `WHERE value IS NOT NULL${
                    denominator.cappingSettings.ignoreZeros
                      ? " AND value != 0"
                      : ""
                  }`,
                )}
              )
              `
                : ""
            }`
          : ""
      }
      ${
        regressionAdjusted
          ? `
        , __userCovariateMetric as (
          SELECT
            d.variation AS variation
            ${dimensionCols.map((c) => `, d.${c.alias} AS ${c.alias}`).join("")}
            , d.${baseIdType} AS ${baseIdType}
            , ${this.getAggregateMetricColumnLegacyMetrics({ metric })} as value
          FROM
            __distinctUsers d
          JOIN __metric m ON (
            m.${baseIdType} = d.${baseIdType}
          )
          WHERE 
            m.timestamp >= d.preexposure_start
            AND m.timestamp < d.preexposure_end
          GROUP BY
            d.variation
            ${dimensionCols.map((c) => `, d.${c.alias}`).join("")}
            , d.${baseIdType}
        )
        `
          : ""
      }
  ${
    banditDates?.length
      ? this.getBanditStatisticsCTE({
          baseIdType,
          metricData: [
            {
              alias: "",
              id: metric.id,
              ratioMetric,
              regressionAdjusted,
              isPercentileCapped,
              capCoalesceMetric,
              capCoalesceCovariate,
              capCoalesceDenominator,
              numeratorSourceIndex: 0,
              denominatorSourceIndex: 0,
            },
          ],
          dimensionCols,
          hasRegressionAdjustment: regressionAdjusted,
          hasCapping: isPercentileCapped || denominatorIsPercentileCapped,
          ignoreNulls: "ignoreNulls" in metric && metric.ignoreNulls,
          denominatorIsPercentileCapped,
        })
      : `
  -- One row per variation/dimension with aggregations
  SELECT
    m.variation AS variation
    ${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
    , COUNT(*) AS users
    ${
      computeUncappedMetric
        ? `, SUM(${uncappedCoalesceMetric}) AS main_sum_uncapped
           , SUM(POWER(${uncappedCoalesceMetric}, 2)) AS main_sum_squares_uncapped
           ${
             isPercentileCapped
               ? `
           , MAX(COALESCE(cap.value_cap, 0)) as main_cap_value`
               : ""
           }`
        : ""
    }
    , SUM(${capCoalesceMetric}) AS main_sum
    , SUM(POWER(${capCoalesceMetric}, 2)) AS main_sum_squares
    ${
      ratioMetric
        ? `
      ${
        denominatorComputeUncappedMetric
          ? `, SUM(${uncappedCoalesceDenominator}) AS denominator_sum_uncapped
             , SUM(POWER(${uncappedCoalesceDenominator}, 2)) AS denominator_sum_squares_uncapped
             , SUM(${uncappedCoalesceMetric} * ${uncappedCoalesceDenominator}) AS main_denominator_sum_product_uncapped
             ${
               denominatorIsPercentileCapped
                 ? `
             , MAX(COALESCE(capd.value_cap, 0)) as denominator_cap_value`
                 : ""
             }`
          : ""
      }
      , SUM(${capCoalesceDenominator}) AS denominator_sum
      , SUM(POWER(${capCoalesceDenominator}, 2)) AS denominator_sum_squares
      , SUM(${capCoalesceDenominator} * ${capCoalesceMetric}) AS main_denominator_sum_product
    `
        : ""
    }
    ${
      regressionAdjusted
        ? `
        ${
          computeUncappedMetric
            ? `, SUM(${uncappedCoalesceCovariate}) AS covariate_sum_uncapped
               , SUM(POWER(${uncappedCoalesceCovariate}, 2)) AS covariate_sum_squares_uncapped
               , SUM(${uncappedCoalesceMetric} * ${uncappedCoalesceCovariate}) AS main_covariate_sum_product_uncapped`
            : ""
        }
      , SUM(${capCoalesceCovariate}) AS covariate_sum
      , SUM(POWER(${capCoalesceCovariate}, 2)) AS covariate_sum_squares
      , SUM(${capCoalesceMetric} * ${capCoalesceCovariate}) AS main_covariate_sum_product
      `
        : ""
    }
  FROM
    __userMetricAgg m
  ${
    ratioMetric
      ? `LEFT JOIN __userDenominatorAgg d ON (
          d.${baseIdType} = m.${baseIdType}
        )
        ${
          denominatorIsPercentileCapped
            ? "CROSS JOIN __capValueDenominator capd"
            : ""
        }`
      : ""
  }
  ${
    regressionAdjusted
      ? `
      LEFT JOIN __userCovariateMetric c
      ON (c.${baseIdType} = m.${baseIdType})
      `
      : ""
  }
  ${isPercentileCapped ? `CROSS JOIN __capValue cap` : ""}
  ${"ignoreNulls" in metric && metric.ignoreNulls ? `WHERE m.value != 0` : ""}
  GROUP BY
    m.variation
    ${dimensionCols.map((c) => `, m.${c.alias}`).join("")}
  `
  }`,
      this.getFormatDialect(),
    );
  }

  // legacy metrics only
  getBanditStatisticsCTE({
    baseIdType,
    metricData,
    dimensionCols,
    hasRegressionAdjustment,
    hasCapping,
    ignoreNulls,
    denominatorIsPercentileCapped,
  }: {
    baseIdType: string;
    metricData: BanditMetricData[];
    dimensionCols: DimensionColumnData[];
    hasRegressionAdjustment: boolean;
    hasCapping: boolean;
    ignoreNulls?: boolean;
    denominatorIsPercentileCapped?: boolean;
  }): string {
    return `-- One row per variation/dimension with aggregations
  , __banditPeriodStatistics AS (
    SELECT
      m.variation AS variation
      ${dimensionCols.map((d) => `, m.${d.alias} AS ${d.alias}`).join("")}
      , m.bandit_period AS bandit_period
      , ${this.ensureFloat(`COUNT(*)`)} AS users
      ${metricData
        .map((data) => {
          const alias = data.alias;
          return `
        ${
          data.isPercentileCapped
            ? `, MAX(COALESCE(cap.${alias}value_cap, 0)) AS ${alias}main_cap_value`
            : ""
        }
        , ${this.ensureFloat(
          `SUM(${data.capCoalesceMetric})`,
        )} AS ${alias}main_sum
        , ${this.ensureFloat(
          `SUM(POWER(${data.capCoalesceMetric}, 2))`,
        )} AS ${alias}main_sum_squares
        ${
          data.ratioMetric
            ? `
          ${
            denominatorIsPercentileCapped
              ? `, MAX(COALESCE(capd.${alias}value_cap, 0)) as ${alias}denominator_cap_value`
              : ""
          }
          , ${this.ensureFloat(
            `SUM(${data.capCoalesceDenominator})`,
          )} AS ${alias}denominator_sum
          , ${this.ensureFloat(
            `SUM(POWER(${data.capCoalesceDenominator}, 2))`,
          )} AS ${alias}denominator_sum_squares
          , ${this.ensureFloat(
            `SUM(${data.capCoalesceDenominator} * ${data.capCoalesceMetric})`,
          )} AS ${alias}main_denominator_sum_product
        `
            : ""
        }
        ${
          data.regressionAdjusted
            ? `
          , ${this.ensureFloat(
            `SUM(${data.capCoalesceCovariate})`,
          )} AS ${alias}covariate_sum
          , ${this.ensureFloat(
            `SUM(POWER(${data.capCoalesceCovariate}, 2))`,
          )} AS ${alias}covariate_sum_squares
          , ${this.ensureFloat(
            `SUM(${data.capCoalesceMetric} * ${data.capCoalesceCovariate})`,
          )} AS ${alias}main_covariate_sum_product
          `
            : ""
        }`;
        })
        .join("\n")}
    FROM
      __userMetricAgg m
    ${
      metricData[0]?.ratioMetric
        ? `LEFT JOIN __userDenominatorAgg d ON (
            d.${baseIdType} = m.${baseIdType}
          )
          ${
            denominatorIsPercentileCapped
              ? "CROSS JOIN __capValueDenominator capd"
              : ""
          }`
        : ""
    }
    ${
      hasRegressionAdjustment
        ? `
        LEFT JOIN __userCovariateMetric c
        ON (c.${baseIdType} = m.${baseIdType})
        `
        : ""
    }
    ${hasCapping ? `CROSS JOIN __capValue cap` : ""}
    ${ignoreNulls ? `WHERE m.value != 0` : ""}
    GROUP BY
      m.variation
      , m.bandit_period
      ${dimensionCols.map((d) => `, m.${d.alias}`).join("")}
  ),
  __dimensionTotals AS (
    SELECT
      ${this.ensureFloat(`SUM(users)`)} AS total_users
      ${dimensionCols.map((d) => `, ${d.alias} AS ${d.alias}`).join("\n")}
    FROM 
      __banditPeriodStatistics
    GROUP BY
      ${dimensionCols.map((d) => `${d.alias}`).join(", ")}
  ),
  __banditPeriodWeights AS (
    SELECT
      bps.bandit_period AS bandit_period
      ${dimensionCols.map((d) => `, bps.${d.alias} AS ${d.alias}`).join("")}
      , SUM(bps.users) / MAX(dt.total_users) AS weight
      ${metricData
        .map((data) => {
          const alias = data.alias;
          return `
      ${
        data.regressionAdjusted
          ? `
          , ${this.ifElse(
            `(SUM(bps.users) - 1) <= 0`,
            "0",
            `(
              SUM(bps.${alias}covariate_sum_squares) - 
              POWER(SUM(bps.${alias}covariate_sum), 2) / SUM(bps.users)
            ) / (SUM(bps.users) - 1)`,
          )} AS ${alias}period_pre_variance
          , ${this.ifElse(
            `(SUM(bps.users) - 1) <= 0`,
            "0",
            `(
              SUM(bps.${alias}main_covariate_sum_product) - 
              SUM(bps.${alias}covariate_sum) * SUM(bps.${alias}main_sum) / SUM(bps.users)
            ) / (SUM(bps.users) - 1)`,
          )} AS ${alias}period_covariance
        `
          : ""
      }`;
        })
        .join("\n")}
    FROM 
      __banditPeriodStatistics bps
    LEFT JOIN __dimensionTotals dt ON
      (${dimensionCols
        .map((d) => `bps.${d.alias} = dt.${d.alias}`)
        .join(" AND ")})
    GROUP BY
      bps.bandit_period
      ${dimensionCols.map((d) => `, bps.${d.alias}`).join("\n")}
  )
  ${
    hasRegressionAdjustment
      ? `
      , __theta AS (
      SELECT
        ${dimensionCols.map((d) => `${d.alias} AS ${d.alias}`).join(", ")}
      ${metricData
        .map((data) => {
          const alias = data.alias;
          return `
      ${
        data.regressionAdjusted
          ? `

          , ${this.ifElse(
            `SUM(POWER(weight, 2) * ${alias}period_pre_variance) <= 0`,
            "0",
            `SUM(POWER(weight, 2) * ${alias}period_covariance) / 
          SUM(POWER(weight, 2) * ${alias}period_pre_variance)`,
          )} AS ${alias}theta
        `
          : ""
      }`;
        })
        .join("\n")}
      FROM
        __banditPeriodWeights
      GROUP BY
        ${dimensionCols.map((d) => `${d.alias}`).join(", ")}  
      )
    `
      : ""
  }
  SELECT
    bps.variation
    ${dimensionCols.map((d) => `, bps.${d.alias} AS ${d.alias}`).join("")}
    , SUM(bps.users) AS users
    ${metricData
      .map((data) => {
        const alias = data.alias;
        return `
    , ${this.castToString(`'${data.id}'`)} as ${alias}id
    , SUM(bpw.weight * bps.${alias}main_sum / bps.users) * SUM(bps.users) AS ${alias}main_sum
    , SUM(bps.users) * (SUM(
      ${this.ifElse(
        "bps.users <= 1",
        "0",
        `POWER(bpw.weight, 2) * ((
        bps.${alias}main_sum_squares - POWER(bps.${alias}main_sum, 2) / bps.users
      ) / (bps.users - 1)) / bps.users
    `,
      )}) * (SUM(bps.users) - 1) + POWER(SUM(bpw.weight * bps.${alias}main_sum / bps.users), 2)) as ${alias}main_sum_squares
    ${
      data.ratioMetric
        ? `
      , SUM(bpw.weight * bps.${alias}denominator_sum / bps.users) * SUM(bps.users) AS ${alias}denominator_sum
      , SUM(bps.users) * (SUM(
      ${this.ifElse(
        "bps.users <= 1",
        "0",
        `POWER(bpw.weight, 2) * ((
          (bps.${alias}denominator_sum_squares - POWER(bps.${alias}denominator_sum, 2) / bps.users) / (bps.users - 1))
        ) / bps.users
      `,
      )}) * (SUM(bps.users) - 1) + POWER(
        SUM(bpw.weight * bps.${alias}denominator_sum / bps.users), 2)
      ) AS ${alias}denominator_sum_squares
      , SUM(bps.users) * (
          (SUM(bps.users) - 1) * SUM(
            ${this.ifElse(
              "bps.users <= 1",
              "0",
              `
            POWER(bpw.weight, 2) / (bps.users * (bps.users - 1)) * (
              bps.${alias}main_denominator_sum_product - bps.${alias}main_sum * bps.${alias}denominator_sum / bps.users
            )
          `,
            )}) +
          (
            SUM(bpw.weight * bps.${alias}main_sum / bps.users) * SUM(bpw.weight * bps.${alias}denominator_sum / bps.users)
          )
        ) AS ${alias}main_denominator_sum_product`
        : ""
    }
    ${
      data.regressionAdjusted
        ? `
      , SUM(bpw.weight * bps.${alias}covariate_sum / bps.users) * SUM(bps.users) AS ${alias}covariate_sum
      , SUM(bps.users) * (SUM(
      ${this.ifElse(
        "bps.users <= 1",
        "0",
        `POWER(bpw.weight, 2) * ((
          (bps.${alias}covariate_sum_squares - POWER(bps.${alias}covariate_sum, 2) / bps.users) / (bps.users - 1))
        ) / bps.users
      `,
      )}) * (SUM(bps.users) - 1) + POWER(SUM(bpw.weight * bps.${alias}covariate_sum / bps.users), 2)) AS ${alias}covariate_sum_squares
      , SUM(bps.users) * (
          (SUM(bps.users) - 1) * SUM(
            ${this.ifElse(
              "bps.users <= 1",
              "0",
              `
            POWER(bpw.weight, 2) / (bps.users * (bps.users - 1)) * (
              bps.${alias}main_covariate_sum_product - bps.${alias}main_sum * bps.${alias}covariate_sum / bps.users
            )
          `,
            )}) +
          (
            SUM(bpw.weight * bps.${alias}main_sum / bps.users) * SUM(bpw.weight * bps.${alias}covariate_sum / bps.users)
          )
        ) AS ${alias}main_covariate_sum_product
      , MAX(t.${alias}theta) AS ${alias}theta
        `
        : ""
    }`;
      })
      .join("\n")}
  FROM 
    __banditPeriodStatistics bps
  LEFT JOIN
    __banditPeriodWeights bpw
    ON (
      bps.bandit_period = bpw.bandit_period 
      ${dimensionCols
        .map((d) => `AND bps.${d.alias} = bpw.${d.alias}`)
        .join("\n")}
    )
  ${
    hasRegressionAdjustment
      ? `
    LEFT JOIN
      __theta t
      ON (${dimensionCols
        .map((d) => `bps.${d.alias} = t.${d.alias}`)
        .join(" AND ")})
    `
      : ""
  }
  GROUP BY
    bps.variation
    ${dimensionCols.map((d) => `, bps.${d.alias}`).join("")}
  `;
  }

  getBanditStatisticsFactMetricCTE({
    baseIdType,
    metricData,
    dimensionCols,
    factTablesWithIndices,
    regressionAdjustedTableIndices,
    percentileTableIndices,
  }: {
    baseIdType: string;
    metricData: BanditMetricData[];
    dimensionCols: DimensionColumnData[];
    factTablesWithIndices: { factTable: FactTableInterface; index: number }[];
    regressionAdjustedTableIndices: Set<number>;
    percentileTableIndices: Set<number>;
  }): string {
    return `
    -- One row per variation/dimension with aggregations
    , __banditPeriodStatistics AS (
      SELECT
        m.variation AS variation
        ${dimensionCols.map((d) => `, m.${d.alias} AS ${d.alias}`).join("")}
        , m.bandit_period AS bandit_period
        , ${this.ensureFloat(`COUNT(*)`)} AS users
        ${metricData
          .map((data) => {
            const alias = data.alias + "_";
            const numeratorSourceSuffix =
              data.numeratorSourceIndex === 0 ? "" : data.numeratorSourceIndex;
            const denominatorSourceSuffix =
              data.denominatorSourceIndex === 0
                ? ""
                : data.denominatorSourceIndex;
            return `
          ${
            data.isPercentileCapped
              ? `, MAX(COALESCE(cap${numeratorSourceSuffix}.${alias}value_cap, 0)) AS ${alias}main_cap_value`
              : ""
          }
          , ${this.ensureFloat(
            `SUM(${data.capCoalesceMetric})`,
          )} AS ${alias}main_sum
          , ${this.ensureFloat(
            `SUM(POWER(${data.capCoalesceMetric}, 2))`,
          )} AS ${alias}main_sum_squares
          ${
            data.ratioMetric
              ? `
            ${
              data.isPercentileCapped
                ? `, MAX(COALESCE(cap${denominatorSourceSuffix}.${alias}denominator_cap, 0)) as ${alias}denominator_cap_value`
                : ""
            }
            , ${this.ensureFloat(
              `SUM(${data.capCoalesceDenominator})`,
            )} AS ${alias}denominator_sum
            , ${this.ensureFloat(
              `SUM(POWER(${data.capCoalesceDenominator}, 2))`,
            )} AS ${alias}denominator_sum_squares
            , ${this.ensureFloat(
              `SUM(${data.capCoalesceDenominator} * ${data.capCoalesceMetric})`,
            )} AS ${alias}main_denominator_sum_product
          `
              : ""
          }
          ${
            data.regressionAdjusted
              ? `
            , ${this.ensureFloat(
              `SUM(${data.capCoalesceCovariate})`,
            )} AS ${alias}covariate_sum
            , ${this.ensureFloat(
              `SUM(POWER(${data.capCoalesceCovariate}, 2))`,
            )} AS ${alias}covariate_sum_squares
            , ${this.ensureFloat(
              `SUM(${data.capCoalesceMetric} * ${data.capCoalesceCovariate})`,
            )} AS ${alias}main_covariate_sum_product
            `
              : ""
          }`;
          })
          .join("\n")}
      FROM
        __userMetricAgg m
      ${factTablesWithIndices
        .map(({ factTable: _, index }) => {
          const suffix = `${index === 0 ? "" : index}`;
          return `
        ${
          index === 0
            ? ""
            : `LEFT JOIN __userMetricAgg${suffix} m${suffix} ON (
          m${suffix}.${baseIdType} = m.${baseIdType}
        )`
        }
        ${
          regressionAdjustedTableIndices.has(index)
            ? `
          LEFT JOIN __userCovariateMetric${suffix} c${suffix} ON (
            c${suffix}.${baseIdType} = m${suffix}.${baseIdType}
          )
        `
            : ""
        }
        ${
          percentileTableIndices.has(index)
            ? `
          CROSS JOIN __capValue${suffix} cap${suffix}
        `
            : ""
        }
      `;
        })
        .join("\n")}
      GROUP BY
        m.variation
        , m.bandit_period
        ${dimensionCols.map((d) => `, m.${d.alias}`).join("")}
    ),
    __dimensionTotals AS (
      SELECT
        ${this.ensureFloat(`SUM(users)`)} AS total_users
        ${dimensionCols.map((d) => `, ${d.alias} AS ${d.alias}`).join("\n")}
      FROM 
        __banditPeriodStatistics
      GROUP BY
        ${dimensionCols.map((d) => `${d.alias}`).join(" AND ")}
    ),
    __banditPeriodWeights AS (
      SELECT
        bps.bandit_period AS bandit_period
        ${dimensionCols.map((d) => `, bps.${d.alias} AS ${d.alias}`).join("")}
        , SUM(bps.users) / MAX(dt.total_users) AS weight
        ${metricData
          .map((data) => {
            const alias = data.alias + "_";
            return `
        ${
          data.regressionAdjusted
            ? `
            , ${this.ifElse(
              `(SUM(bps.users) - 1) <= 0`,
              "0",
              `(
                SUM(bps.${alias}covariate_sum_squares) - 
                POWER(SUM(bps.${alias}covariate_sum), 2) / SUM(bps.users)
              ) / (SUM(bps.users) - 1)`,
            )} AS ${alias}period_pre_variance
            , ${this.ifElse(
              `(SUM(bps.users) - 1) <= 0`,
              "0",
              `(
                SUM(bps.${alias}main_covariate_sum_product) - 
                SUM(bps.${alias}covariate_sum) * SUM(bps.${alias}main_sum) / SUM(bps.users)
              ) / (SUM(bps.users) - 1)`,
            )} AS ${alias}period_covariance
          `
            : ""
        }`;
          })
          .join("\n")}
      FROM 
        __banditPeriodStatistics bps
      LEFT JOIN __dimensionTotals dt ON
        (${dimensionCols
          .map((d) => `bps.${d.alias} = dt.${d.alias}`)
          .join(" AND ")})
      GROUP BY
        bps.bandit_period
        ${dimensionCols.map((d) => `, bps.${d.alias}`).join("\n")}
    )
    ${
      regressionAdjustedTableIndices.size > 0
        ? `
        , __theta AS (
        SELECT
          ${dimensionCols.map((d) => `${d.alias} AS ${d.alias}`).join(", ")}
        ${metricData
          .map((data) => {
            const alias = data.alias + "_";
            return `
        ${
          data.regressionAdjusted
            ? `

            , ${this.ifElse(
              `SUM(POWER(weight, 2) * ${alias}period_pre_variance) <= 0`,
              "0",
              `SUM(POWER(weight, 2) * ${alias}period_covariance) / 
            SUM(POWER(weight, 2) * ${alias}period_pre_variance)`,
            )} AS ${alias}theta
          `
            : ""
        }`;
          })
          .join("\n")}
        FROM
          __banditPeriodWeights
        GROUP BY
          ${dimensionCols.map((d) => `${d.alias}`).join(", ")}  
        )
      `
        : ""
    }
    SELECT
      bps.variation
      ${dimensionCols.map((d) => `, bps.${d.alias} AS ${d.alias}`).join("")}
      , SUM(bps.users) AS users
      ${metricData
        .map((data) => {
          const alias = data.alias + "_";
          return `
      , ${this.castToString(`'${data.id}'`)} as ${alias}id
      , SUM(bpw.weight * bps.${alias}main_sum / bps.users) * SUM(bps.users) AS ${alias}main_sum
      , SUM(bps.users) * (SUM(
        ${this.ifElse(
          "bps.users <= 1",
          "0",
          `POWER(bpw.weight, 2) * ((
          bps.${alias}main_sum_squares - POWER(bps.${alias}main_sum, 2) / bps.users
        ) / (bps.users - 1)) / bps.users
      `,
        )}) * (SUM(bps.users) - 1) + POWER(SUM(bpw.weight * bps.${alias}main_sum / bps.users), 2)) as ${alias}main_sum_squares
      ${
        data.ratioMetric
          ? `
        , SUM(bpw.weight * bps.${alias}denominator_sum / bps.users) * SUM(bps.users) AS ${alias}denominator_sum
        , SUM(bps.users) * (SUM(
        ${this.ifElse(
          "bps.users <= 1",
          "0",
          `POWER(bpw.weight, 2) * ((
            (bps.${alias}denominator_sum_squares - POWER(bps.${alias}denominator_sum, 2) / bps.users) / (bps.users - 1))
          ) / bps.users
        `,
        )}) * (SUM(bps.users) - 1) + POWER(
          SUM(bpw.weight * bps.${alias}denominator_sum / bps.users), 2)
        ) AS ${alias}denominator_sum_squares
        , SUM(bps.users) * (
            (SUM(bps.users) - 1) * SUM(
              ${this.ifElse(
                "bps.users <= 1",
                "0",
                `
              POWER(bpw.weight, 2) / (bps.users * (bps.users - 1)) * (
                bps.${alias}main_denominator_sum_product - bps.${alias}main_sum * bps.${alias}denominator_sum / bps.users
              )
            `,
              )}) +
            (
              SUM(bpw.weight * bps.${alias}main_sum / bps.users) * SUM(bpw.weight * bps.${alias}denominator_sum / bps.users)
            )
          ) AS ${alias}main_denominator_sum_product`
          : ""
      }
      ${
        data.regressionAdjusted
          ? `
        , SUM(bpw.weight * bps.${alias}covariate_sum / bps.users) * SUM(bps.users) AS ${alias}covariate_sum
        , SUM(bps.users) * (SUM(
        ${this.ifElse(
          "bps.users <= 1",
          "0",
          `POWER(bpw.weight, 2) * ((
            (bps.${alias}covariate_sum_squares - POWER(bps.${alias}covariate_sum, 2) / bps.users) / (bps.users - 1))
          ) / bps.users
        `,
        )}) * (SUM(bps.users) - 1) + POWER(SUM(bpw.weight * bps.${alias}covariate_sum / bps.users), 2)) AS ${alias}covariate_sum_squares
        , SUM(bps.users) * (
            (SUM(bps.users) - 1) * SUM(
              ${this.ifElse(
                "bps.users <= 1",
                "0",
                `
              POWER(bpw.weight, 2) / (bps.users * (bps.users - 1)) * (
                bps.${alias}main_covariate_sum_product - bps.${alias}main_sum * bps.${alias}covariate_sum / bps.users
              )
            `,
              )}) +
            (
              SUM(bpw.weight * bps.${alias}main_sum / bps.users) * SUM(bpw.weight * bps.${alias}covariate_sum / bps.users)
            )
          ) AS ${alias}main_covariate_sum_product
        , MAX(t.${alias}theta) AS ${alias}theta
          `
          : ""
      }`;
        })
        .join("\n")}
    FROM 
      __banditPeriodStatistics bps
    LEFT JOIN
      __banditPeriodWeights bpw
      ON (
        bps.bandit_period = bpw.bandit_period 
        ${dimensionCols
          .map((d) => `AND bps.${d.alias} = bpw.${d.alias}`)
          .join("\n")}
      )
    ${
      regressionAdjustedTableIndices.size > 0
        ? `
      LEFT JOIN
        __theta t
        ON (${dimensionCols
          .map((d) => `bps.${d.alias} = t.${d.alias}`)
          .join(" AND ")})
      `
        : ""
    }
    GROUP BY
      bps.variation
      ${dimensionCols.map((d) => `, bps.${d.alias}`).join("")}
    `;
  }

  getQuantileBoundValues(
    quantile: number,
    alpha: number,
    nstar: number,
  ): { lower: number; upper: number } {
    const multiplier = normal.quantile(1 - alpha / 2, 0, 1);
    const binomialSE = Math.sqrt((quantile * (1 - quantile)) / nstar);
    return {
      lower: Math.max(quantile - multiplier * binomialSE, 0.00000001),
      upper: Math.min(quantile + multiplier * binomialSE, 0.99999999),
    };
  }

  approxQuantile(value: string, quantile: string | number): string {
    return `APPROX_PERCENTILE(${value}, ${quantile})`;
  }

  quantileColumn(
    valueCol: string,
    outputCol: string,
    quantile: string | number,
  ): string {
    // note: no need to ignore zeros in the next two methods
    // since we remove them for quantile metrics in userMetricJoin
    return `${this.approxQuantile(valueCol, quantile)} AS ${outputCol}`;
  }

  percentileCapSelectClause(
    values: {
      valueCol: string;
      outputCol: string;
      percentile: number;
      ignoreZeros: boolean;
      sourceIndex: number;
    }[],
    metricTable: string,
    where: string = "",
  ) {
    return `
      SELECT
        ${values
          .map(({ valueCol, outputCol, percentile, ignoreZeros }) => {
            const value = ignoreZeros
              ? this.ifElse(`${valueCol} = 0`, "NULL", valueCol)
              : valueCol;
            return this.quantileColumn(value, outputCol, percentile);
          })
          .join(",\n")}
      FROM ${metricTable}
      ${where}
      `;
  }

  private capCoalesceValue({
    valueCol,
    metric,
    capTablePrefix = "c",
    capValueCol = "value_cap",
    columnRef,
  }: {
    valueCol: string;
    metric: ExperimentMetricInterface;
    capTablePrefix?: string;
    capValueCol?: string;
    columnRef?: ColumnRef | null;
  }): string {
    // Assumes cappable metrics do not have aggregate filters
    // which is true for now
    if (
      metric?.cappingSettings.type === "absolute" &&
      metric.cappingSettings.value &&
      isCappableMetricType(metric)
    ) {
      return `LEAST(
        ${this.ensureFloat(`COALESCE(${valueCol}, 0)`)},
        ${metric.cappingSettings.value}
      )`;
    }
    if (
      metric?.cappingSettings.type === "percentile" &&
      metric.cappingSettings.value &&
      metric.cappingSettings.value < 1 &&
      isCappableMetricType(metric)
    ) {
      return `LEAST(
        ${this.ensureFloat(`COALESCE(${valueCol}, 0)`)},
        ${capTablePrefix}.${capValueCol}
      )`;
    }

    const filters = getAggregateFilters({
      columnRef: columnRef || null,
      column: valueCol,
      ignoreInvalid: true,
    });
    if (filters.length) {
      valueCol = `(CASE WHEN ${filters.join(" AND ")} THEN 1 ELSE NULL END)`;
    }

    return `COALESCE(${valueCol}, 0)`;
  }
  getExperimentResultsQuery(): string {
    throw new Error("Not implemented");
  }
  async getExperimentResults(): Promise<ExperimentQueryResponses> {
    throw new Error("Not implemented");
  }

  getDefaultDatabase() {
    return "";
  }

  generateTablePath(
    tableName: string,
    schema?: string,
    database?: string,
    queryRequiresSchema?: boolean,
  ) {
    let path = "";
    // Add database if required
    if (this.requiresDatabase) {
      database = database || this.getDefaultDatabase();
      if (!database) {
        throw new MissingDatasourceParamsError(
          "No database provided. Please edit the connection settings and try again.",
        );
      }
      path += database + ".";
    }

    // Add schema if required
    if (this.requiresSchema || queryRequiresSchema) {
      if (!schema) {
        throw new MissingDatasourceParamsError(
          "No schema provided. Please edit the connection settings and try again.",
        );
      }
      path += schema + ".";
    }

    // Add table name
    path += tableName;
    return this.escapePathCharacter
      ? `${this.escapePathCharacter}${path}${this.escapePathCharacter}`
      : path;
  }

  getInformationSchemaTable(schema?: string, database?: string): string {
    return this.generateTablePath(
      "information_schema.columns",
      schema,
      database,
    );
  }

  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('information_schema')";
  }
  async getInformationSchema(): Promise<InformationSchema[]> {
    const sql = `
  SELECT 
    table_name as table_name,
    table_catalog as table_catalog,
    table_schema as table_schema,
    count(column_name) as column_count 
  FROM
    ${this.getInformationSchemaTable()}
    WHERE ${this.getInformationSchemaWhereClause()}
    GROUP BY table_name, table_schema, table_catalog`;

    const results = await this.runQuery(format(sql, this.getFormatDialect()));

    if (!results.rows.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(results.rows as RawInformationSchema[]);
  }
  async getTableData(
    databaseName: string,
    tableSchema: string,
    tableName: string,
  ): Promise<{ tableData: null | unknown[] }> {
    const sql = `
  SELECT 
    data_type as data_type,
    column_name as column_name 
  FROM
    ${this.getInformationSchemaTable(tableSchema, databaseName)}
  WHERE 
    table_name = '${tableName}'
    AND table_schema = '${tableSchema}'
    AND table_catalog = '${databaseName}'`;

    const results = await this.runQuery(format(sql, this.getFormatDialect()));

    return { tableData: results.rows };
  }
  getSchemaFormatConfig(
    schemaFormat: AutoFactTableSchemas,
  ): SchemaFormatConfig {
    switch (schemaFormat) {
      case "amplitude": {
        return {
          trackedEventTableName: `EVENTS_${
            this.datasource.settings.schemaOptions?.projectId || `*`
          }`,
          eventColumn: "event_type",
          timestampColumn: "event_time",
          userIdColumn: "user_id",
          filterColumns: [
            "device_family as device",
            "os_name as os",
            "country",
            "paying",
          ],
          anonymousIdColumn: "amplitude_id",
          getTrackedEventTablePath: ({ schema }) =>
            this.generateTablePath(
              `EVENTS_${
                this.datasource.settings.schemaOptions?.projectId || `*`
              }`,
              schema,
            ),
          // If dates are provided, format them, otherwise use Sql template variables
          getDateLimitClause: (dates?: { start: Date; end: Date }) => {
            const start = dates
              ? `${formatDate(dates.start, "yyyy-MM-dd")}`
              : `{{date startDateISO "yyyy-MM-dd"}}`;
            const end = dates
              ? `${formatDate(dates.end, "yyyy-MM-dd")}`
              : `{{date endDateISO "yyyy-MM-dd"}}`;

            return `event_time BETWEEN '${start}' AND '${end}'`;
          },
          getAdditionalEvents: () => [],
          getEventFilterWhereClause: (eventName: string) =>
            `event_name = '${eventName}'`,
        };
      }
      case "rudderstack":
      case "segment":
        return {
          trackedEventTableName: "tracks",
          eventColumn: "event",
          timestampColumn: "received_at",
          userIdColumn: "user_id",
          filterColumns: [
            "(CASE WHEN context_user_agent LIKE '%Mobile%' THEN 'Mobile' ELSE 'Tablet/Desktop' END) as device",
            "(CASE WHEN context_user_agent LIKE '% Firefox%' THEN 'Firefox' WHEN context_user_agent LIKE '% OPR%' THEN 'Opera' WHEN context_user_agent LIKE '% Edg%' THEN ' Edge' WHEN context_user_agent LIKE '% Chrome%' THEN 'Chrome' WHEN context_user_agent LIKE '% Safari%' THEN 'Safari' ELSE 'Other' END) as browser",
          ],
          anonymousIdColumn: "anonymous_id",
          displayNameColumn: "event_text",
          getTrackedEventTablePath: ({ eventName, schema }) =>
            this.generateTablePath(eventName, schema),
          getDateLimitClause: (dates?: { start: Date; end: Date }) => {
            // If dates are provided, format them, otherwise use Sql template variables
            const start = dates
              ? `${formatDate(dates.start, "yyyy-MM-dd")}`
              : `{{date startDateISO "yyyy-MM-dd"}}`;
            const end = dates
              ? `${formatDate(dates.end, "yyyy-MM-dd")}`
              : `{{date endDateISO "yyyy-MM-dd"}}`;
            return `received_at BETWEEN '${start}' AND '${end}'`;
          },
          getAdditionalEvents: () => [
            {
              eventName: "pages",
              displayName: "Page Viewed",
              groupBy: "event",
            },
            {
              eventName: "screens",
              displayName: "Screen Viewed",
              groupBy: "event",
            },
          ],
          getEventFilterWhereClause: () => "",
        };
    }
  }

  getAutoGeneratedMetricSqlQuery(
    eventName: string,
    hasUserId: boolean,
    schemaFormat: AutoFactTableSchemas,
    type: MetricType,
    schema?: string,
  ): string {
    const {
      timestampColumn,
      userIdColumn,
      anonymousIdColumn,
      getTrackedEventTablePath,
      getEventFilterWhereClause,
      getDateLimitClause,
    } = this.getSchemaFormatConfig(schemaFormat);

    const sqlQuery = `
      SELECT
        ${hasUserId ? `${userIdColumn} as user_id, ` : ""}
        ${anonymousIdColumn} as anonymous_id,
        ${timestampColumn} as timestamp
        ${type === "count" ? `, 1 as value` : ""}
        FROM ${getTrackedEventTablePath({ eventName, schema })}
        WHERE ${getDateLimitClause()} ${
          getEventFilterWhereClause(eventName).length
            ? ` AND ${getEventFilterWhereClause(eventName)}`
            : ""
        }
`;
    return format(sqlQuery, this.getFormatDialect());
  }

  doesMetricExist(
    existingMetrics: MetricInterface[],
    sqlQuery: string,
    type: MetricType,
  ): boolean {
    return existingMetrics.some(
      (metric) => metric.sql === sqlQuery && metric.type === type,
    );
  }

  getFilterColumnsClause(filterColumns: string[]): string {
    let filterClause = "";
    if (!filterColumns.length) return filterClause;

    filterColumns.forEach((column) => (filterClause += `, ${column}`));

    return filterClause;
  }
  getAutoGeneratedFactTableSqlQuery(
    eventName: string,
    hasUserId: boolean,
    schemaFormat: AutoFactTableSchemas,
    schema?: string,
  ): string {
    const {
      timestampColumn,
      userIdColumn,
      anonymousIdColumn,
      getTrackedEventTablePath,
      getEventFilterWhereClause,
      filterColumns,
      getDateLimitClause,
    } = this.getSchemaFormatConfig(schemaFormat);

    const sqlQuery = `
      SELECT
        ${hasUserId ? `${userIdColumn} as user_id, ` : ""}
        ${anonymousIdColumn} as anonymous_id,
        ${timestampColumn} as timestamp
        ${this.getFilterColumnsClause(filterColumns)}
        FROM ${getTrackedEventTablePath({ eventName, schema })}
        WHERE ${getDateLimitClause()} ${
          getEventFilterWhereClause(eventName).length
            ? ` AND ${getEventFilterWhereClause(eventName)}`
            : ""
        }
`;
    return format(sqlQuery, this.getFormatDialect());
  }
  getMetricsToCreate(
    result: TrackedEventData,
    schemaFormat: AutoFactTableSchemas,
    existingMetrics: MetricInterface[],
    schema?: string,
  ): AutoMetricToCreate[] {
    const metricsToCreate: AutoMetricToCreate[] = [];

    const userIdTypes: string[] = ["anonymous_id"];

    if (result.hasUserId) {
      userIdTypes.push("user_id");
    }

    const binomialSqlQuery = this.getAutoGeneratedMetricSqlQuery(
      result.eventName,
      result.hasUserId,
      schemaFormat,
      "binomial",
      schema,
    );

    const binomialExists = this.doesMetricExist(
      existingMetrics,
      binomialSqlQuery,
      "binomial",
    );

    //TODO Build some logic where based on the event, we determine what metrics to create (by default, we create binomial and count) for every event
    metricsToCreate.push({
      name: result.displayName,
      type: "binomial",
      alreadyExists: binomialExists,
      shouldCreate: !binomialExists,
      sql: binomialSqlQuery,
      userIdTypes,
    });

    const countSqlQuery = this.getAutoGeneratedMetricSqlQuery(
      result.eventName,
      result.hasUserId,
      schemaFormat,
      "count",
      schema,
    );

    const countExists = this.doesMetricExist(
      existingMetrics,
      binomialSqlQuery,
      "binomial",
    );

    metricsToCreate.push({
      name: `Count of ${result.displayName}`,
      type: "count",
      alreadyExists: countExists,
      shouldCreate: !countExists,
      sql: countSqlQuery,
      userIdTypes,
    });

    return metricsToCreate;
  }

  private getTrackedEventSql(
    eventColumn: string,
    displayNameColumn: string,
    userIdColumn: string,
    timestampColumn: string,
    trackedEventTableName: string,
    getDateLimitClause: (dates?: { start: Date; end: Date }) => string,
    schema: string,
    groupByColumn?: string,
  ) {
    const end = new Date();
    const start = subDays(new Date(), 7);

    return `
      SELECT
        ${eventColumn} as event,
        MAX(${displayNameColumn}) as display_name,
        (CASE WHEN COUNT(${userIdColumn}) > 0 THEN 1 ELSE 0 END) as has_user_id,
        COUNT (*) as count,
        MAX(${timestampColumn}) as last_tracked_at
      FROM
        ${this.generateTablePath(
          trackedEventTableName,
          schema,
          undefined,
          !!schema,
        )}
      WHERE ${getDateLimitClause({ start, end })}
      AND ${eventColumn} NOT IN ('experiment_viewed', 'experiment_started')
      GROUP BY ${groupByColumn || eventColumn}
    `;
  }

  async getAutoMetricsToCreate(
    existingMetrics: MetricInterface[],
    schema: string,
  ): Promise<AutoMetricTrackedEvent[]> {
    const schemaFormat = this.datasource.settings.schemaFormat;

    if (
      schemaFormat &&
      this.schemaFormatisAutoFactTablesSchemas(schemaFormat)
    ) {
      const trackedEvents = await this.getEventsTrackedByDatasource(
        schemaFormat,
        schema,
      );

      if (!trackedEvents.length) {
        throw new Error(
          "No events found. The query we run to identify tracked events only looks at events from the last 7 days.",
        );
      }

      return trackedEvents.map((event) => {
        return {
          ...event,
          metricsToCreate: this.getMetricsToCreate(
            event,
            schemaFormat,
            existingMetrics,
            schema,
          ),
        };
      });
    } else {
      throw new Error(
        "Data Source does not support automatic metric generation.",
      );
    }
  }

  async getEventsTrackedByDatasource(
    // schemaFormat: SchemaFormat,
    schemaFormat: AutoFactTableSchemas,
    schema?: string,
  ): Promise<TrackedEventData[]> {
    const {
      trackedEventTableName,
      userIdColumn,
      eventColumn,
      timestampColumn,
      displayNameColumn,
      getAdditionalEvents,
      getDateLimitClause,
    } = this.getSchemaFormatConfig(schemaFormat);

    const sql = this.getTrackedEventSql(
      eventColumn,
      displayNameColumn || eventColumn,
      userIdColumn,
      timestampColumn,
      trackedEventTableName,
      getDateLimitClause,
      schema || "",
    );

    const { rows: resultRows } = await this.runQuery(
      format(sql, this.getFormatDialect()),
    );

    const additionalEvents = getAdditionalEvents();

    for (const additionalEvent of additionalEvents) {
      const sql = this.getTrackedEventSql(
        `'${additionalEvent.eventName}'`,
        `'${additionalEvent.displayName}'`,
        userIdColumn,
        timestampColumn,
        additionalEvent.eventName,
        getDateLimitClause,
        schema || "",
        additionalEvent.groupBy,
      );

      try {
        const { rows: additionalEventResults } = await this.runQuery(
          format(sql, this.getFormatDialect()),
        );

        additionalEventResults.forEach((result) => {
          if (result.count > 0) {
            resultRows.push(result);
          }
        });
      } catch (e) {
        // This happens when the table doesn't exists - this is optional, so just ignoring
      }
    }

    if (!resultRows) {
      throw new Error(`No events found.`);
    }

    return resultRows.map((result) => {
      const row = result as TrackedEventResponseRow;
      const processedEventData: TrackedEventData = {
        eventName: row.event,
        displayName: row.display_name,
        hasUserId: row.has_user_id,
        count: row.count,
        lastTrackedAt: result.last_tracked_at.value
          ? new Date(result.last_tracked_at.value)
          : new Date(result.last_tracked_at),
      };
      return processedEventData;
    });
  }

  private getMetricQueryFormat(metric: MetricInterface) {
    return metric.queryFormat || (metric.sql ? "sql" : "builder");
  }

  getQuantileGridColumns(
    metricQuantileSettings: MetricQuantileSettings,
    prefix: string,
  ) {
    return `, ${this.quantileColumn(
      `m.${prefix}value`,
      `${prefix}quantile`,
      metricQuantileSettings.quantile,
    )}
    ${N_STAR_VALUES.map((nstar) => {
      const { lower, upper } = this.getQuantileBoundValues(
        metricQuantileSettings.quantile,
        0.05,
        nstar,
      );
      return `, ${this.quantileColumn(
        `m.${prefix}value`,
        `${prefix}quantile_lower_${nstar}`,
        lower,
      )}
          , ${this.quantileColumn(
            `m.${prefix}value`,
            `${prefix}quantile_upper_${nstar}`,
            upper,
          )}`;
    }).join("\n")}`;
  }

  public getColumnsTopValuesQuery({
    factTable,
    columns,
    limit = 50,
    lookbackDays = 14,
  }: ColumnTopValuesParams) {
    if (columns.length === 0) {
      throw new Error("At least one column is required");
    }

    // Validate all columns are string type
    for (const column of columns) {
      if (column.datatype !== "string") {
        throw new Error(`Column ${column.column} is not a string column`);
      }
    }

    const start = new Date();
    start.setDate(start.getDate() - lookbackDays);

    // Generate a UNION ALL query for each column
    const columnQueries = columns.map((column, i) => {
      return `
    (${this.selectStarLimit(
      `(
        SELECT
          ${this.castToString(`'${column.column}'`)} AS column_name,
          ${this.castToString(column.column)} AS value,
          COUNT(*) AS count
        FROM __factTable
        WHERE timestamp >= ${this.toTimestamp(start)}
          AND ${column.column} IS NOT NULL
        GROUP BY ${column.column}
        ORDER BY count DESC
      ) c${i}`,
      limit,
    )})`;
    });

    return format(
      `
WITH
  __factTable AS (
    ${compileSqlTemplate(factTable.sql, {
      startDate: start,
      templateVariables: {
        eventName: factTable.eventName,
      },
    })}
  ),
  __topValues AS (
    ${columnQueries.join("\n    UNION ALL\n")}
  )
SELECT * FROM __topValues
ORDER BY column_name, count DESC
    `,
      this.getFormatDialect(),
    );
  }

  public async runColumnsTopValuesQuery(
    sql: string,
  ): Promise<ColumnTopValuesResponse> {
    const { rows, statistics } = await this.runQuery(sql);

    return {
      statistics,
      rows: rows.map((r) => ({
        column: r.column_name + "",
        value: r.value + "",
        count: parseFloat(r.count),
      })),
    };
  }

  // Get a Fact Table CTE for multiple fact metrics that all share the same fact table
  private getFactMetricCTE({
    metricsWithIndices,
    factTable,
    baseIdType,
    castIdToString,
    idJoinMap,
    startDate,
    endDate,
    experimentId,
    addFiltersToWhere,
    exclusiveStartDateFilter,
    exclusiveEndDateFilter,
    phase,
    customFields,
  }: {
    metricsWithIndices: { metric: FactMetricInterface; index: number }[];
    factTable: FactTableInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    startDate: Date;
    endDate: Date | null;
    experimentId?: string;
    addFiltersToWhere?: boolean;
    phase?: PhaseSQLVar;
    customFields?: Record<string, unknown>;
    // Additional filter to ensure we only get
    // new data from AFTER the last seen max timestamp
    exclusiveStartDateFilter?: boolean;
    exclusiveEndDateFilter?: boolean;
    castIdToString?: boolean;
  }) {
    // Determine if a join is required to match up id types
    let join = "";
    let userIdCol = "";
    const userIdTypes = factTable.userIdTypes;
    if (userIdTypes.includes(baseIdType)) {
      userIdCol = baseIdType;
    } else if (userIdTypes.length > 0) {
      for (let i = 0; i < userIdTypes.length; i++) {
        const userIdType: string = userIdTypes[i];
        if (userIdType in idJoinMap) {
          const metricUserIdCol = `m.${userIdType}`;
          join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = ${metricUserIdCol})`;
          userIdCol = `i.${baseIdType}`;
          break;
        }
      }
    }

    // BQ datetime cast for SELECT statements (do not use for where)
    const timestampDateTimeColumn = this.castUserDateCol("m.timestamp");

    const sql = factTable.sql;
    const where: string[] = [];

    // Add a rough date filter to improve query performance
    if (startDate) {
      // If exclusive, we need to be more precise with the timestamp
      const operator = exclusiveStartDateFilter ? ">" : ">=";
      const timestampFn = exclusiveStartDateFilter
        ? this.toTimestampWithMs
        : this.toTimestamp;
      where.push(`m.timestamp ${operator} ${timestampFn(startDate)}`);
    }
    if (endDate) {
      // If exclusive, we need to be more precise with the timestamp
      const operator = exclusiveEndDateFilter ? "<" : "<=";
      const timestampFn = exclusiveEndDateFilter
        ? this.toTimestampWithMs
        : this.toTimestamp;
      where.push(`m.timestamp ${operator} ${timestampFn(endDate)}`);
    }

    const metricCols: string[] = [];
    // optionally, you can add metric filters to the WHERE clause
    // to filter to rows that match a metric to improve query performance.
    // We AND together each metric filters, before OR together all of
    // the different metrics filters
    const filterWhere: Set<string> = new Set();

    // We only do this if all metrics have at least one filter
    let numberOfNumeratorsOrDenominatorsWithoutFilters = 0;

    metricsWithIndices.forEach((metricWithIndex) => {
      const m = metricWithIndex.metric;
      const index = metricWithIndex.index;
      // get numerator if it matches the fact table
      if (m.numerator?.factTableId === factTable.id) {
        const value = this.getFactMetricColumn(
          m,
          m.numerator,
          factTable,
          "m",
        ).value;

        const sliceInfo = parseSliceMetricId(m.id, {
          [factTable.id]: factTable,
        });
        const filters = getColumnRefWhereClause({
          factTable,
          columnRef: m.numerator,
          escapeStringLiteral: this.escapeStringLiteral.bind(this),
          jsonExtract: this.extractJSONField.bind(this),
          evalBoolean: this.evalBoolean.bind(this),
          sliceInfo,
        });

        const column =
          filters.length > 0
            ? `CASE WHEN (${filters.join("\n AND ")}) THEN ${value} ELSE NULL END`
            : value;

        metricCols.push(`-- ${m.name}
        ${column} as m${index}_value`);

        if (!filters.length) {
          numberOfNumeratorsOrDenominatorsWithoutFilters++;
        }
        if (addFiltersToWhere && filters.length) {
          filterWhere.add(`(${filters.join("\n AND ")})`);
        }
      }

      // Add denominator column if there is one
      if (isRatioMetric(m) && m.denominator) {
        // only add denominators that match the fact table
        if (m.denominator.factTableId !== factTable.id) {
          return;
        }

        const value = this.getFactMetricColumn(
          m,
          m.denominator,
          factTable,
          "m",
        ).value;

        const sliceInfo = parseSliceMetricId(m.id, {
          [factTable.id]: factTable,
        });
        const filters = getColumnRefWhereClause({
          factTable,
          columnRef: m.denominator,
          escapeStringLiteral: this.escapeStringLiteral.bind(this),
          jsonExtract: this.extractJSONField.bind(this),
          evalBoolean: this.evalBoolean.bind(this),
          sliceInfo,
        });
        const column =
          filters.length > 0
            ? `CASE WHEN (${filters.join(" AND ")}) THEN ${value} ELSE NULL END`
            : value;
        metricCols.push(`-- ${m.name} (denominator)
        ${column} as m${index}_denominator`);

        if (!filters.length) {
          numberOfNumeratorsOrDenominatorsWithoutFilters++;
        }

        if (addFiltersToWhere && filters.length) {
          filterWhere.add(`(${filters.join(" AND ")})`);
        }
      }
    });

    // only add filters if all metrics have at least one filter
    if (
      filterWhere.size > 0 &&
      numberOfNumeratorsOrDenominatorsWithoutFilters === 0
    ) {
      where.push("(" + Array.from(filterWhere).join(" OR ") + ")");
    }

    return compileSqlTemplate(
      `-- Fact Table (${factTable.name})
      SELECT
        ${castIdToString ? this.castToString(userIdCol) : userIdCol} as ${baseIdType},
        ${timestampDateTimeColumn} as timestamp,
        ${metricCols.join(",\n")}
      FROM(
          ${sql}
        ) m
        ${join}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `,
      {
        startDate,
        endDate: endDate || undefined,
        experimentId,
        templateVariables: getFactTableTemplateVariables(factTable),
        phase,
        customFields,
      },
    );
  }

  // Get a Fact Table CTE for segments based on fact tables
  private getFactSegmentCTE({
    factTable,
    baseIdType,
    idJoinMap,
    filters,
    sqlVars,
  }: {
    factTable: FactTableInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    filters?: string[];
    sqlVars?: SQLVars;
  }) {
    // Determine if a join is required to match up id types
    let join = "";
    let userIdCol = "";
    const userIdTypes = factTable.userIdTypes;
    if (userIdTypes.includes(baseIdType)) {
      userIdCol = baseIdType;
    } else if (userIdTypes.length > 0) {
      for (let i = 0; i < userIdTypes.length; i++) {
        const userIdType: string = userIdTypes[i];
        if (userIdType in idJoinMap) {
          const metricUserIdCol = `m.${userIdType}`;
          join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = ${metricUserIdCol})`;
          userIdCol = `i.${baseIdType}`;
          break;
        }
      }
    }

    // BQ datetime cast for SELECT statements (do not use for where)
    const timestampDateTimeColumn = this.castUserDateCol("m.timestamp");

    const sql = factTable.sql;

    const where: string[] = [];

    if (filters?.length) {
      filters.forEach((filter) => {
        const filterObj = factTable.filters.find(
          (factFilter) => factFilter.id === filter,
        );

        if (filterObj) {
          where.push(filterObj.value);
        }
      });
    }

    const baseSql = `-- Fact Table (${factTable.name})
    SELECT
      ${userIdCol} as ${baseIdType},
      ${timestampDateTimeColumn} as date
    FROM(
        ${sql}
      ) m
      ${join}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  `;
    return sqlVars ? compileSqlTemplate(baseSql, sqlVars) : baseSql;
  }

  private getMetricCTE({
    metric,
    baseIdType,
    idJoinMap,
    startDate,
    endDate,
    experimentId,
    factTableMap,
    useDenominator,
    phase,
    customFields,
  }: {
    metric: ExperimentMetricInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    startDate: Date;
    endDate: Date | null;
    experimentId?: string;
    factTableMap: FactTableMap;
    useDenominator?: boolean;
    phase?: PhaseSQLVar;
    customFields?: Record<string, unknown>;
  }) {
    const cols = this.getMetricColumns(
      metric,
      factTableMap,
      "m",
      useDenominator,
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

    // query builder does not use a sub-query to get a the userId column to
    // equal the userIdType, so when using the query builder, continue to
    // use the actual input column name rather than the id type
    if (userIdTypes.includes(baseIdType)) {
      userIdCol = queryFormat === "builder" ? userIdCol : baseIdType;
    } else if (userIdTypes.length > 0) {
      for (let i = 0; i < userIdTypes.length; i++) {
        const userIdType: string = userIdTypes[i];
        if (userIdType in idJoinMap) {
          const metricUserIdCol =
            queryFormat === "builder"
              ? cols.userIds[userIdType]
              : `m.${userIdType}`;
          join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = ${metricUserIdCol})`;
          userIdCol = `i.${baseIdType}`;
          break;
        }
      }
    }

    // BQ datetime cast for SELECT statements (do not use for where)
    const timestampDateTimeColumn = this.castUserDateCol(cols.timestamp);

    const schema = this.getSchema();

    const where: string[] = [];
    let sql = "";

    // From old, deprecated query builder UI
    if (queryFormat === "builder" && !isFact && metric.conditions?.length) {
      metric.conditions.forEach((c) => {
        where.push(`m.${c.column} ${c.operator} '${c.value}'`);
      });
    }

    // Add filters from the Metric
    if (isFact && factTable && columnRef) {
      const sliceInfo = parseSliceMetricId(metric.id);
      getColumnRefWhereClause({
        factTable,
        columnRef,
        escapeStringLiteral: this.escapeStringLiteral.bind(this),
        jsonExtract: this.extractJSONField.bind(this),
        evalBoolean: this.evalBoolean.bind(this),
        sliceInfo,
      }).forEach((filterSQL) => {
        where.push(filterSQL);
      });

      sql = factTable.sql;
    }

    if (!isFact && queryFormat === "sql") {
      sql = metric.sql || "";
    }

    // Add date filter
    if (startDate) {
      where.push(`${cols.timestamp} >= ${this.toTimestamp(startDate)}`);
    }
    if (endDate) {
      where.push(`${cols.timestamp} <= ${this.toTimestamp(endDate)}`);
    }

    return compileSqlTemplate(
      `-- Metric (${metric.name})
      SELECT
        ${userIdCol} as ${baseIdType},
        ${cols.value} as value,
        ${timestampDateTimeColumn} as timestamp
      FROM
        ${
          queryFormat === "sql" || queryFormat === "fact"
            ? `(
              ${sql}
            )`
            : !isFact
              ? (schema && !metric.table?.match(/\./) ? schema + "." : "") +
                (metric.table || "")
              : ""
        } m
        ${join}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `,
      {
        startDate,
        endDate: endDate || undefined,
        experimentId,
        phase,
        customFields,
        templateVariables: getMetricTemplateVariables(
          metric,
          factTableMap,
          useDenominator,
        ),
      },
    );
  }

  // Only include users who entered the experiment before this timestamp
  private getExperimentEndDate(
    settings: ExperimentSnapshotSettings,
    conversionWindowHours: number,
  ): Date {
    // If we need to wait until users have had a chance to fully convert
    if (settings.skipPartialData) {
      // The last date allowed to give enough time for users to convert
      const conversionWindowEndDate = new Date();
      conversionWindowEndDate.setHours(
        conversionWindowEndDate.getHours() - conversionWindowHours,
      );

      // Use the earliest of either the conversion end date or the phase end date
      return new Date(
        Math.min(settings.endDate.getTime(), conversionWindowEndDate.getTime()),
      );
    }

    // Otherwise, use the actual end date
    return settings.endDate;
  }

  private getSegmentCTE(
    segment: SegmentInterface,
    baseIdType: string,
    idJoinMap: Record<string, string>,
    factTableMap: FactTableMap,
    sqlVars?: SQLVars,
  ) {
    // replace template variables
    let segmentSql = "";

    if (segment.type === "SQL") {
      if (!segment.sql) {
        throw new Error(
          `Segment ${segment.name} is a SQL Segment but has no SQL value`,
        );
      }
      segmentSql = sqlVars
        ? compileSqlTemplate(segment.sql, sqlVars)
        : segment.sql;
    } else {
      if (!segment.factTableId) {
        throw new Error(
          `Segment ${segment.name} is a FACT Segment, but has no factTableId set`,
        );
      }
      const factTable = factTableMap.get(segment.factTableId);

      if (!factTable) {
        throw new Error(`Unknown fact table: ${segment.factTableId}`);
      }

      segmentSql = this.getFactSegmentCTE({
        baseIdType,
        idJoinMap,
        factTable,
        filters: segment.filters,
        sqlVars,
      });

      return `-- Segment (${segment.name})
        SELECT * FROM (\n${segmentSql}\n) s `;
    }

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
          ${segmentSql}
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
          ${segmentSql}
        ) s`;
    }
    return `-- Segment (${segment.name})
    ${segmentSql}
    `;
  }

  private getDimensionCTE(
    dimension: DimensionInterface,
    baseIdType: string,
    idJoinMap: Record<string, string>,
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

  private addCaseWhenTimeFilter({
    col,
    metric,
    overrideConversionWindows,
    endDate,
    metricQuantileSettings,
    metricTimestampColExpr,
    exposureTimestampColExpr,
  }: {
    col: string;
    metric: ExperimentMetricInterface;
    overrideConversionWindows: boolean;
    endDate: Date;
    metricQuantileSettings?: MetricQuantileSettings;
    metricTimestampColExpr: string;
    exposureTimestampColExpr: string;
  }): string {
    return `${this.ifElse(
      `${this.getConversionWindowClause(
        exposureTimestampColExpr,
        metricTimestampColExpr,
        metric,
        endDate,
        overrideConversionWindows,
      )}
        ${metricQuantileSettings?.ignoreZeros && metricQuantileSettings?.type === "event" ? `AND ${col} != 0` : ""}
      `,
      `${col}`,
      `NULL`,
    )}`;
  }

  private getAggregateMetricColumnLegacyMetrics({
    metric,
  }: {
    metric: MetricInterface;
  }) {
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

  private getFactMetricColumn(
    metric: FactMetricInterface,
    columnRef: ColumnRef,
    factTable: FactTableInterface,
    alias = "m",
  ): { timestamp: string; value: string } {
    const hasAggregateFilter =
      getAggregateFilters({
        columnRef: columnRef,
        column: columnRef?.column || "",
        ignoreInvalid: true,
      }).length > 0;

    const column = hasAggregateFilter
      ? columnRef?.aggregateFilterColumn
      : columnRef?.column;

    const timestampColumn = `${alias}.timestamp`;

    const value =
      (!hasAggregateFilter && isBinomialMetric(metric)) ||
      !columnRef ||
      column === "$$distinctUsers" ||
      column === "$$count"
        ? "1"
        : column === "$$distinctDates"
          ? this.dateTrunc(timestampColumn)
          : factTable && column
            ? getColumnExpression(
                column,
                factTable,
                this.extractJSONField.bind(this),
                alias,
              )
            : `${alias}.${column}`;

    return {
      timestamp: timestampColumn,
      value,
    };
  }

  // TODO(sql): refactor to change metric type to legacy only
  // currently this is used for activation metrics even if they are
  // fact metrics
  private getMetricColumns(
    metric: ExperimentMetricInterface,
    factTableMap: FactTableMap,
    alias = "m",
    useDenominator?: boolean,
  ): { userIds: Record<string, string>; timestamp: string; value: string } {
    if (isFactMetric(metric)) {
      const userIds: Record<string, string> = {};
      getUserIdTypes(metric, factTableMap, useDenominator).forEach(
        (userIdType) => {
          userIds[userIdType] = `${alias}.${userIdType}`;
        },
      );

      const columnRef = useDenominator ? metric.denominator : metric.numerator;

      const factTable = factTableMap.get(columnRef?.factTableId || "");

      const hasAggregateFilter =
        getAggregateFilters({
          columnRef: columnRef,
          column: columnRef?.column || "",
          ignoreInvalid: true,
        }).length > 0;

      const column = hasAggregateFilter
        ? columnRef?.aggregateFilterColumn
        : columnRef?.column;

      const value =
        (!hasAggregateFilter && isBinomialMetric(metric)) ||
        // TODO(sql): remove when switching this method to only be used by legacy metrics
        !columnRef ||
        column === "$$distinctUsers" ||
        column === "$$count" ||
        column === "$$distinctDates"
          ? "1"
          : factTable && column
            ? getColumnExpression(
                column,
                factTable,
                this.extractJSONField.bind(this),
                alias,
              )
            : `${alias}.${column}`;

      return {
        userIds,
        timestamp: `${alias}.timestamp`,
        value,
      };
    }

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
    experimentId?: string,
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
              ${compileSqlTemplate(join.query, {
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
      const timestampColumn = "i.timestamp";

      if (
        ["user_id", "anonymous_id"].includes(id1) &&
        ["user_id", "anonymous_id"].includes(id2)
      ) {
        return `
        SELECT
          user_id,
          anonymous_id
        FROM
          (${compileSqlTemplate(settings.queries.pageviewsQuery, {
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

  // Pipeline validation queries (engine-aware)
  getPipelineValidationInsertQuery({
    tableFullName,
  }: {
    tableFullName: string;
  }): string {
    return `INSERT INTO
      ${tableFullName}
      (user_id, variation, first_exposure_timestamp)
      VALUES
      ('user_3', 'A', ${this.getCurrentTimestamp()})
    `;
  }

  computeParticipationDenominator({
    initialTimestampColumn,
    analysisEndDate,
    metric,
    overrideConversionWindows,
  }: {
    initialTimestampColumn: string;
    analysisEndDate: Date;
    metric: FactMetricInterface;
    overrideConversionWindows: boolean;
  }): string {
    // get start date of metric analysis window
    const delayHours = getDelayWindowHours(metric.windowSettings);
    const windowHours = getMetricWindowHours(metric.windowSettings);

    let startDateString = this.castToTimestamp(initialTimestampColumn);
    if (delayHours > 0) {
      startDateString = this.addHours(startDateString, delayHours);
    }

    let endDateString = this.castToTimestamp(this.toTimestamp(analysisEndDate));

    if (metric.windowSettings.type === "lookback") {
      const lookbackStartDate = new Date(analysisEndDate);
      lookbackStartDate.setHours(lookbackStartDate.getHours() - windowHours);
      // Only override start date for lookback
      startDateString = `GREATEST(${startDateString}, ${this.castToTimestamp(this.toTimestamp(lookbackStartDate))})`;
    } else if (
      metric.windowSettings.type === "conversion" &&
      !overrideConversionWindows
    ) {
      endDateString = `LEAST(${this.getCurrentTimestamp()}, ${this.addHours(startDateString, windowHours)})`;
    }

    return this.ensureFloat(
      `GREATEST(${this.dateDiff(startDateString, endDateString)} + 1, 1)`,
    );
  }

  /**
   * Applies the daily participation transformation to an aggregated value.
   * For dailyParticipation metrics, this divides the count by the number of days
   * in the participation window to get a participation rate.
   * For all other metric types, this returns the value unchanged.
   */
  applyDailyParticipationTransformation({
    column,
    initialTimestampColumn,
    analysisEndDate,
    metric,
    overrideConversionWindows,
  }: {
    column: string;
    initialTimestampColumn: string;
    analysisEndDate: Date;
    metric: FactMetricInterface;
    overrideConversionWindows: boolean;
  }): string {
    if (metric.metricType !== "dailyParticipation") {
      return column;
    }

    return `
      ${this.ensureFloat(column)} / 
      ${this.computeParticipationDenominator({
        initialTimestampColumn,
        analysisEndDate,
        metric,
        overrideConversionWindows,
      })}
    `;
  }

  getAggregationMetadata({
    metric,
    useDenominator,
  }: {
    metric: FactMetricInterface;
    useDenominator: boolean;
  }): FactMetricAggregationMetadata {
    const columnRef = useDenominator ? metric.denominator : metric.numerator;

    const hasAggregateFilter =
      getAggregateFilters({
        columnRef: columnRef,
        column: columnRef?.column || "",
        ignoreInvalid: true,
      }).length > 0;

    const column = hasAggregateFilter
      ? columnRef?.aggregateFilterColumn
      : columnRef?.column;

    const nullIfZero =
      metric.quantileSettings?.ignoreZeros &&
      metric.quantileSettings?.type === "unit";

    // Binomial or distinct user count without an aggregate filter
    // TODO: get mapping of when distinct users is possible for understanding
    if (
      !hasAggregateFilter &&
      (isBinomialMetric(metric) || column === "$$distinctUsers")
    ) {
      return {
        intermediateDataType: "integer",
        partialAggregationFunction: (column: string) =>
          `COALESCE(MAX(${column}), 0)`,
        finalDataType: "integer",
        reAggregationFunction: (column: string) =>
          `COALESCE(MAX(${column}), 0)`,
        fullAggregationFunction: (column: string) =>
          `COALESCE(MAX(${column}), 0)`,
      };
    }

    // Binomial with an aggregate filter requires counting rows
    // TODO(incremental-refresh): what about aggregate filter with special column?
    const binomialWithAggregateFilter =
      hasAggregateFilter && isBinomialMetric(metric);
    const userCountWithAggregateFilter =
      hasAggregateFilter && column === "$$distinctUsers";
    if (binomialWithAggregateFilter || userCountWithAggregateFilter) {
      return {
        intermediateDataType: "integer",
        partialAggregationFunction: (column: string) =>
          `SUM(COALESCE((${column}), 0))`,
        finalDataType: "integer",
        reAggregationFunction: (column: string) =>
          `SUM(COALESCE((${column}), 0))`,
        fullAggregationFunction: (column: string) =>
          `SUM(COALESCE((${column}), 0))`,
      };
    }

    // From now on need to check `nullIfZero` in case these aggregations
    // are used as part of a unit quantile metric
    if (column === "$$count") {
      const reAggregationFunction = nullIfZero
        ? (column: string) => `NULLIF(SUM(COALESCE(${column}, 0)), 0)`
        : (column: string) => `SUM(COALESCE(${column}, 0))`;
      const fullAggregationFunction = nullIfZero
        ? (column: string) => `NULLIF(COUNT(${column}), 0)`
        : (column: string) => `COUNT(${column})`;
      return {
        intermediateDataType: "integer",
        partialAggregationFunction: (column: string) => `COUNT(${column})`,
        finalDataType: "integer",
        reAggregationFunction,
        fullAggregationFunction,
      };
    }

    if (column === "$$distinctDates") {
      // Column here should be a date (a timestamp truncated to date)
      const reAggregationFunction = nullIfZero
        ? (column: string) => `NULLIF(COUNT(DISTINCT ${column}), 0)`
        : (column: string) => `COUNT(DISTINCT ${column})`;
      const fullAggregationFunction = nullIfZero
        ? (column: string) => `NULLIF(COUNT(DISTINCT ${column}), 0)`
        : (column: string) => `COUNT(DISTINCT ${column})`;

      return {
        intermediateDataType: "date",
        partialAggregationFunction: (column: string) =>
          this.castToDate(`MAX(${column})`),
        finalDataType: "integer",
        reAggregationFunction,
        fullAggregationFunction,
      };
    }

    // if counting distinct but not a special count or distinct users
    // we need to use the hll aggregation for approximating count distinct
    if (
      !columnRef?.column.startsWith("$$") &&
      columnRef?.aggregation === "count distinct"
    ) {
      const reAggregationFunction = nullIfZero
        ? (column: string) =>
            `NULLIF(${this.hllCardinality(this.hllReaggregate(column))}, 0)`
        : (column: string) => this.hllCardinality(this.hllReaggregate(column));
      const fullAggregationFunction = nullIfZero
        ? (column: string) =>
            `NULLIF(${this.hllCardinality(this.hllAggregate(column))}, 0)`
        : (column: string) => this.hllCardinality(this.hllAggregate(column));
      return {
        intermediateDataType: "hll",
        partialAggregationFunction: (column: string) =>
          this.castToHllDataType(this.hllAggregate(column)),
        finalDataType: "integer",
        reAggregationFunction,
        fullAggregationFunction,
      };
    }

    if (
      !columnRef?.column.startsWith("$$") &&
      columnRef?.aggregation === "max"
    ) {
      return {
        intermediateDataType: "float",
        partialAggregationFunction: (column: string) =>
          `COALESCE(MAX(${column}), 0)`,
        reAggregationFunction: (column: string) =>
          `COALESCE(MAX(${column}), 0)`,
        finalDataType: "float",
        fullAggregationFunction: (column: string) =>
          `COALESCE(MAX(${column}), 0)`,
      };
    }

    if (
      metric.metricType === "quantile" &&
      metric.quantileSettings?.type === "event"
    ) {
      return {
        intermediateDataType: "float", // TODO(incremental-refresh): use array-based method
        // potentially use array based methods to store an array of events
        // and then count share of array below method instead of the following hap
        partialAggregationFunction: (_column: string) => {
          throw new Error("Not implemented");
        },
        reAggregationFunction: (_column: string, _quantileColumn: string) => {
          throw new Error("Not implemented");
        },
        finalDataType: "integer",
        fullAggregationFunction: (column: string, quantileColumn: string) =>
          `SUM(${this.ifElse(`${column} <= ${quantileColumn}`, "1", "0")})`,
      };
    }

    // otherwise, assume sum
    const reAggregationFunction = nullIfZero
      ? (column: string) => `NULLIF(SUM(COALESCE(${column}, 0)), 0)`
      : (column: string) => `SUM(COALESCE(${column}, 0))`;
    const fullAggregationFunction = nullIfZero
      ? (column: string) => `NULLIF(SUM(COALESCE(${column}, 0)), 0)`
      : (column: string) => `SUM(COALESCE(${column}, 0))`;
    return {
      intermediateDataType: "float",
      partialAggregationFunction: (column: string) =>
        `SUM(COALESCE(${column}, 0))`,
      finalDataType: "float",
      reAggregationFunction,
      fullAggregationFunction,
    };
  }

  // Finally, one per fact table for now:
  // getExperimentIncrementalStatisticsQuery
  parseExperimentParams(params: {
    settings: ExperimentSnapshotSettings;
    activationMetric: ExperimentMetricInterface | null;
    dimensions: Dimension[];
    unitsTableFullName: string;
  }): {
    exposureQuery: ExposureQuery;
    activationMetric: ExperimentMetricInterface | null;
    experimentDimensions: ExperimentDimension[];
    unitDimensions: Dimension[];
  } {
    const { settings, activationMetric: activationMetricDoc } = params;

    const exposureQuery = this.getExposureQuery(
      settings.exposureQueryId || "",
      undefined,
    );

    const activationMetric = this.processActivationMetric(
      activationMetricDoc,
      settings,
    );

    const { experimentDimensions } = this.processDimensions(
      params.dimensions,
      settings,
      activationMetric,
    );

    return {
      activationMetric,
      experimentDimensions,
      exposureQuery,
      unitDimensions: params.dimensions,
    };
  }

  parseExperimentFactMetricsParams(params: {
    metrics: FactMetricInterface[];
    activationMetric: ExperimentMetricInterface | null;
    settings: ExperimentSnapshotSettings;
    factTableMap: FactTableMap;
    lastMaxTimestamp: Date | null;
    forcedUserIdType?: string;
  }): {
    factTablesWithMetricData: FactMetricSourceData[];
    metricData: FactMetricData[];
  } {
    const { settings } = params;
    const metricsWithIndices = cloneDeep(params.metrics).map((m, i) => ({
      metric: m,
      index: i,
    }));

    metricsWithIndices.forEach((m) => {
      applyMetricOverrides(m.metric, settings);
    });

    const activationMetric = this.processActivationMetric(
      params.activationMetric,
      settings,
    );

    const factTableMap = params.factTableMap;

    const factTablesWithMetrics = this.getFactTablesForMetrics(
      metricsWithIndices,
      factTableMap,
    );

    const metricData = metricsWithIndices.map((m) => {
      return this.getMetricData(
        { metric: m.metric, index: m.index },
        settings,
        activationMetric,
        factTablesWithMetrics,
        `m${m.index}`,
      );
    });

    const factTablesWithMetricData = factTablesWithMetrics.map((f) => {
      const factTableMetricData = metricData.filter((m) =>
        f.metrics.some((fm) => fm.metric.id === m.metric.id),
      );

      const percentileData: FactMetricPercentileData[] = [];
      factTableMetricData
        .filter((m) => m.isPercentileCapped)
        .forEach((m) => {
          percentileData.push({
            valueCol: `${m.alias}_value`,
            outputCol: `${m.alias}_value_cap`,
            percentile: m.metric.cappingSettings.value ?? 1,
            ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
            sourceIndex: m.numeratorSourceIndex,
          });
          if (m.ratioMetric) {
            percentileData.push({
              valueCol: `${m.alias}_denominator`,
              outputCol: `${m.alias}_denominator_cap`,
              percentile: m.metric.cappingSettings.value ?? 1,
              ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
              sourceIndex: m.denominatorSourceIndex,
            });
          }
        });

      const eventQuantileData = this.getFactMetricQuantileData(
        factTableMetricData,
        "event",
      );

      // Settings computed over all metrics attached to this fact table
      const maxHoursToConvert = Math.max(
        ...factTableMetricData.map((m) => m.maxHoursToConvert),
      );

      const metricStart = factTableMetricData.reduce(
        (min, d) => (d.metricStart < min ? d.metricStart : min),
        settings.startDate,
      );
      const metricEnd = factTableMetricData.reduce(
        (max, d) => (d.metricEnd && d.metricEnd > max ? d.metricEnd : max),
        settings.endDate,
      );

      // Get date range for new metric data that is needed
      const lastMaxTimestamp = params.lastMaxTimestamp;
      const bindingLastMaxTimestamp =
        !!lastMaxTimestamp && lastMaxTimestamp > metricStart;
      const startDate =
        lastMaxTimestamp && bindingLastMaxTimestamp
          ? lastMaxTimestamp
          : metricStart;

      const regressionAdjustedMetrics = metricData.filter(
        (m) => m.regressionAdjusted,
      );
      const minCovariateStartDate = regressionAdjustedMetrics
        .map((m) => m.raMetricPhaseStartSettings.covariateStartDate)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      const maxCovariateEndDate = regressionAdjustedMetrics
        .map((m) => m.raMetricPhaseStartSettings.covariateEndDate)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      return {
        factTable: f.factTable,
        index: f.index,
        metricData,
        percentileData,
        eventQuantileData,
        maxHoursToConvert,
        metricStart: startDate,
        metricEnd,
        regressionAdjustedMetrics,
        minCovariateStartDate,
        maxCovariateEndDate,
        activationMetric,
        // used for incremental refresh
        bindingLastMaxTimestamp,
      };
    });

    return {
      factTablesWithMetricData,
      metricData,
    };
  }

  getCreateExperimentIncrementalUnitsQuery(
    params: CreateExperimentIncrementalUnitsQueryParams,
  ): string {
    const { exposureQuery, activationMetric, experimentDimensions } =
      this.parseExperimentParams(params);

    return format(
      `
    CREATE TABLE ${params.unitsTableFullName}
    (
      ${exposureQuery.userIdType} ${this.getDataType("string")}
      , variation ${this.getDataType("string")}
      , first_exposure_timestamp ${this.getDataType("timestamp")}
      ${
        activationMetric
          ? `, first_activation_timestamp ${this.getDataType("timestamp")}`
          : ""
      }
      ${experimentDimensions
        .map((d) => `, dim_exp_${d.id} ${this.getDataType("string")}`)
        .join("\n")}
      , max_timestamp ${this.getDataType("timestamp")}
    )
    ${this.createTablePartitions(["max_timestamp"])}
    `,
      this.getFormatDialect(),
    );
  }

  getUpdateExperimentIncrementalUnitsQuery(
    params: UpdateExperimentIncrementalUnitsQueryParams,
  ): string {
    const { settings, segment, factTableMap } = params;
    const { exposureQuery, activationMetric, experimentDimensions } =
      this.parseExperimentParams(params);

    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE({
      objects: [
        [exposureQuery.userIdType],
        // activationMetric ? getUserIdTypes(activationMetric, factTableMap) : [],
        segment ? [segment.userIdType || "user_id"] : [],
      ],
      from: settings.startDate,
      to: settings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: settings.experimentId,
    });

    // TODO(incremental-refresh): activation metric
    if (activationMetric) {
      throw new Error(
        "Activation metrics are not yet supported for incremental refresh",
      );
    }

    const lastMaxTimestampBinds =
      params.lastMaxTimestamp && params.lastMaxTimestamp > settings.startDate;

    // TODO(incremental-refresh): What if "skip partial data" is true?
    // Does the conversionWindowsHour need to be set different?
    const endDate = this.getExperimentEndDate(settings, 0);

    // Segment and SQL filter only check against new exposures
    return format(
      `
      CREATE TABLE ${params.unitsTempTableFullName} 
      ${this.createTablePartitions(["max_timestamp"])}
        AS (
        WITH ${idJoinSQL}
        __existingUnits AS (
          SELECT 
            ${baseIdType}
            , variation
            , first_exposure_timestamp AS timestamp
            , max_timestamp
            ${
              activationMetric
                ? `, first_activation_timestamp AS activation_timestamp`
                : ""
            }
            ${experimentDimensions.map((d) => `, dim_exp_${d.id}`).join("\n")}
          FROM ${params.unitsTableFullName}
        )
        ${
          segment
            ? `, __segment as (${this.getSegmentCTE(
                segment,
                baseIdType,
                idJoinMap,
                factTableMap,
                {
                  startDate: settings.startDate,
                  endDate: settings.endDate,
                  experimentId: settings.experimentId,
                },
              )})`
            : ""
        }
        , __newExposures AS (
          ${compileSqlTemplate(exposureQuery.query, {
            startDate: settings.startDate,
            endDate: settings.endDate,
            experimentId: settings.experimentId,
            // TODO(incremental-refresh): add incremental start data as template variable
          })}
        )
        , __filteredNewExposures AS (
          SELECT 
            ${this.castToString(`${baseIdType}`)} AS ${baseIdType}
            , ${this.castToString(`variation_id`)} AS variation
            , timestamp AS timestamp
            ${activationMetric ? `, NULL AS activation_timestamp` : ""}
            ${experimentDimensions
              .map((d) => `, ${this.castToString(d.id)} AS dim_exp_${d.id}`)
              .join("\n")}
          FROM __newExposures
          WHERE 
            experiment_id = '${settings.experimentId}'
            ${
              lastMaxTimestampBinds && params.lastMaxTimestamp
                ? `AND timestamp > ${this.toTimestampWithMs(params.lastMaxTimestamp)}`
                : `AND timestamp >= ${this.toTimestampWithMs(settings.startDate)}`
            }
            ${endDate ? `AND timestamp <= ${this.toTimestampWithMs(endDate)}` : ""}
            
        )
        , __jointExposures AS (
          SELECT * FROM __existingUnits
          UNION ALL
          (
            SELECT
              ${baseIdType}
              , variation
              , timestamp
              , MAX(timestamp) OVER () AS max_timestamp
              ${activationMetric ? `, activation_timestamp` : ""}
              ${experimentDimensions.map((d) => `, dim_exp_${d.id}`).join("\n")}
            FROM __filteredNewExposures
          )
        )
        , __experimentUnits AS (
          SELECT
            e.${baseIdType} AS ${baseIdType}
            , ${this.ifElse(
              "COUNT(DISTINCT e.variation) > 1",
              "'__multiple__'",
              "MAX(e.variation)",
            )} AS variation
            , MIN(e.timestamp) AS first_exposure_timestamp
            , MIN(e.max_timestamp) AS max_timestamp
            ${experimentDimensions
              .map(
                (d) => `
              , ${this.getDimensionValuePerUnit(d, "dim_exp_")} AS dim_exp_${d.id}`,
              )
              .join("\n")}
          FROM __jointExposures e
          GROUP BY
            ${baseIdType}
        )
        SELECT 
          ${baseIdType}
          , variation
          , first_exposure_timestamp
          ${activationMetric ? `, first_activation_timestamp` : ""}
          ${experimentDimensions.map((d) => `, dim_exp_${d.id}`).join("\n")}
          , max_timestamp
        FROM __experimentUnits
      )
      `,
      this.getFormatDialect(),
    );
  }

  getDropOldIncrementalUnitsQuery(
    params: DropOldIncrementalUnitsQueryParams,
  ): string {
    if (!params.unitsTableFullName.includes(INCREMENTAL_UNITS_TABLE_PREFIX)) {
      throw new Error(
        "Unable to drop table that is not an incremental refresh units table.",
      );
    }
    return format(
      `
      DROP TABLE IF EXISTS ${params.unitsTableFullName}
      `,
      this.getFormatDialect(),
    );
  }

  getAlterNewIncrementalUnitsQuery(
    params: AlterNewIncrementalUnitsQueryParams,
  ): string {
    return format(
      `
      ALTER TABLE ${params.unitsTempTableFullName} RENAME TO ${params.unitsTableName}
      `,
      this.getFormatDialect(),
    );
  }

  getMaxTimestampIncrementalUnitsQuery(
    params: MaxTimestampIncrementalUnitsQueryParams,
  ): string {
    return format(
      `
      SELECT MAX(max_timestamp) AS max_timestamp FROM ${params.unitsTableFullName}
      `,
      this.getFormatDialect(),
    );
  }

  async runMaxTimestampQuery(
    sql: string,
    setExternalId: ExternalIdCallback,
  ): Promise<MaxTimestampQueryResponse> {
    const { rows, statistics } = await this.runQuery(sql, setExternalId);

    const row = rows?.[0];

    if (!row) {
      return {
        rows: [],
        statistics,
      };
    }

    return {
      rows: [{ max_timestamp: row.max_timestamp }],
      statistics,
    };
  }

  async runIncrementalWithNoOutputQuery(
    sql: string,
    setExternalId: ExternalIdCallback,
  ): Promise<IncrementalWithNoOutputQueryResponse> {
    const results = await this.runQuery(sql, setExternalId);
    return results;
  }

  getDataType(dataType: DataType): string {
    switch (dataType) {
      case "string":
        return "VARCHAR";
      case "integer":
        return "INTEGER";
      case "float":
        return "DOUBLE";
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "timestamp":
        return "TIMESTAMP";
      case "hll":
        return "VARBINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  }

  getMaxTimestampMetricSourceQuery(
    params: MaxTimestampMetricSourceQueryParams,
  ): string {
    return format(
      `
      SELECT MAX(max_timestamp) AS max_timestamp FROM ${params.metricSourceTableFullName}
      `,
      this.getFormatDialect(),
    );
  }

  getDropMetricSourceCovariateTableQuery(
    params: DropMetricSourceCovariateTableQueryParams,
  ): string {
    if (
      !params.metricSourceCovariateTableFullName.includes(`_covariate`) ||
      !params.metricSourceCovariateTableFullName.includes(
        INCREMENTAL_METRICS_TABLE_PREFIX,
      )
    ) {
      throw new Error(
        "Unable to drop table that is not an incremental refresh covariate table.",
      );
    }
    return format(
      `
      DROP TABLE IF EXISTS ${params.metricSourceCovariateTableFullName}
      `,
      this.getFormatDialect(),
    );
  }

  getCreateMetricSourceCovariateTableQuery(
    params: CreateMetricSourceCovariateTableQueryParams,
  ): string {
    const exposureQuery = this.getExposureQuery(
      params.settings.exposureQueryId || "",
      undefined,
    );

    const baseIdType = exposureQuery.userIdType;
    const sortedMetrics = params.metrics.sort((a, b) =>
      a.id.localeCompare(b.id),
    );

    const columnDefinitions =
      this.getMetricSourceCovariateTableColumnDefinitions(
        baseIdType,
        sortedMetrics,
      );

    return format(
      `
    CREATE TABLE ${params.metricSourceCovariateTableFullName}
    (
      ${columnDefinitions.join("\n, ")}
    )
    `,
      this.getFormatDialect(),
    );
  }

  getInsertMetricSourceCovariateDataQuery(
    params: InsertMetricSourceCovariateDataQueryParams,
  ): string {
    const exposureQuery = this.getExposureQuery(
      params.settings.exposureQueryId || "",
      undefined,
    );

    // sort metrics and add indices for tracking across sub-queries
    const sortedMetrics = cloneDeep(params.metrics)
      .map((m) => ({
        ...m,
        // turn off capping for covariate value creation as capping will be applied
        // in the statistics query
        cappingSettings: { type: "" as const, value: 0 },
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const paramsMetricsSorted: {
      metrics: FactMetricInterface[];
      activationMetric: ExperimentMetricInterface | null;
      settings: ExperimentSnapshotSettings;
      factTableMap: FactTableMap;
      covariateWindowType: CovariateWindowType;
      forcedUserIdType?: string;
      lastMaxTimestamp: Date | null;
    } = {
      ...params,
      metrics: sortedMetrics,
      covariateWindowType: "phaseStart",
      lastMaxTimestamp: null,
    };

    // TODO(incremental-refresh): use max hours to convert from here
    // for eventual "skipPartialData" feature
    const { factTablesWithMetricData } =
      this.parseExperimentFactMetricsParams(paramsMetricsSorted);

    if (factTablesWithMetricData.length !== 1) {
      throw new Error("Expected exactly one fact table with metric data");
    }
    const factTableWithMetricData = factTablesWithMetricData[0];
    const metricData = factTableWithMetricData.metricData;

    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE({
      objects: [
        [exposureQuery.userIdType],
        factTableWithMetricData.factTable?.userIdTypes || [],
      ],
      // TODO(incremental-refresh): this gets all identities from history
      // of experiment, which we think is right, but could be improved
      from: params.settings.startDate,
      to: params.settings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: params.settings.experimentId,
    });

    const columnNames = this.getMetricSourceCovariateTableColumns(
      baseIdType,
      sortedMetrics,
    );

    return format(
      `
    INSERT INTO ${params.metricSourceCovariateTableFullName}
    (${columnNames.join(", \n")})
    SELECT * FROM (
      WITH 
        ${idJoinSQL}
        __factTable AS (${this.getFactMetricCTE({
          baseIdType,
          idJoinMap,
          factTable: factTableWithMetricData.factTable,
          startDate: factTableWithMetricData.minCovariateStartDate,
          endDate: factTableWithMetricData.maxCovariateEndDate,
          metricsWithIndices: metricData.map((m, i) => ({
            metric: m.metric,
            index: i,
          })),
          addFiltersToWhere: true,
          // Need to do < the end date to exclude the end date itself
          exclusiveEndDateFilter: true,
          castIdToString: true,
        })})
          , __newCovariateValues AS (
          SELECT
            m.${baseIdType} AS ${baseIdType}
            ${metricData
              .map((m) => {
                const raSettings = m.raMetricPhaseStartSettings;
                // Use full aggregation function since we are
                // aggregating only once to the user level for CUPED data
                const aggfunction =
                  m.covariateNumeratorAggFns.fullAggregationFunction;
                const denomAggFunction =
                  m.covariateDenominatorAggFns.fullAggregationFunction;
                return `
                ${
                  m.numeratorSourceIndex === factTableWithMetricData.index
                    ? `, ${aggfunction(
                        this.ifElse(
                          `m.timestamp >= ${this.toTimestampWithMs(raSettings.covariateStartDate)} 
                            AND m.timestamp < ${this.toTimestampWithMs(raSettings.covariateEndDate)}`,
                          `${m.alias}_value`,
                          "NULL",
                        ),
                      )} AS ${m.alias}_value`
                    : ""
                }
                ${
                  !!denomAggFunction &&
                  isRatioMetric(m.metric) &&
                  m.denominatorSourceIndex === factTableWithMetricData.index
                    ? `, ${denomAggFunction(
                        this.ifElse(
                          `m.timestamp >= ${this.toTimestampWithMs(raSettings.covariateStartDate)} 
                            AND m.timestamp < ${this.toTimestampWithMs(raSettings.covariateEndDate)}`,
                          `${m.alias}_denominator`,
                          "NULL",
                        ),
                      )} AS ${m.alias}_denominator`
                    : ""
                }
              `;
              })
              .join("\n")}
          FROM __factTable m
          INNER JOIN (
            SELECT ${baseIdType}
            FROM ${params.unitsSourceTableFullName}
            ${
              params.lastCovariateSuccessfulMaxTimestamp
                ? `WHERE max_timestamp > ${this.toTimestampWithMs(params.lastCovariateSuccessfulMaxTimestamp)}`
                : ""
            }
          ) d
            ON (d.${baseIdType} = m.${baseIdType})
          GROUP BY
            m.${baseIdType}
        )
      SELECT
        ${baseIdType}
        ${metricData
          .map(
            (
              m, // test this is only RA metrics
            ) =>
              `, ${m.capCoalesceCovariate} AS ${this.encodeMetricIdForColumnName(m.id)}_value
              ${m.ratioMetric ? `, ${m.capCoalesceDenominatorCovariate} AS ${this.encodeMetricIdForColumnName(m.id)}_denominator_value` : ""}
        `,
          )
          .join("\n")}
      FROM __newCovariateValues c
      )
      `,
      this.getFormatDialect(),
    );
  }

  getCreateMetricSourceTableQuery(
    params: CreateMetricSourceTableQueryParams,
  ): string {
    const exposureQuery = this.getExposureQuery(
      params.settings.exposureQueryId || "",
      undefined,
    );

    const baseIdType = exposureQuery.userIdType;
    const sortedMetrics = params.metrics.sort((a, b) =>
      a.id.localeCompare(b.id),
    );

    const columnDefinitions = this.getMetricSourceTableColumnDefinitions(
      baseIdType,
      sortedMetrics,
    );

    if (
      sortedMetrics.some(
        (m) =>
          m.metricType === "quantile" && m.quantileSettings?.type === "event",
      )
    ) {
      throw new Error(
        "Event quantiles not yet supported with incremental refresh.",
      );
    }

    // TODO(incremental-refresh)
    // Compute data types and columns elsewhere and store in metadata to govern this query
    // and for validating queries match going forward
    return format(
      `
    CREATE TABLE ${params.metricSourceTableFullName}
    (
      ${columnDefinitions.join("\n, ")}
    )
    ${this.createTablePartitions(["max_timestamp", "metric_date"])}
    `,
      this.getFormatDialect(),
    );
  }

  getCurrentTimestamp(): string {
    return `CURRENT_TIMESTAMP`;
  }

  protected getMetricSourceTableSchema(
    baseIdType: string,
    metrics: FactMetricInterface[],
  ): Map<string, string> {
    const schema = new Map<string, string>();

    schema.set(baseIdType, this.getDataType("string"));

    metrics.forEach((metric) => {
      const numeratorMetadata = this.getAggregationMetadata({
        metric,
        useDenominator: false,
      });
      schema.set(
        `${this.encodeMetricIdForColumnName(metric.id)}_value`,
        this.getDataType(numeratorMetadata.intermediateDataType),
      );

      if (isRatioMetric(metric)) {
        const denominatorMetadata = this.getAggregationMetadata({
          metric,
          useDenominator: true,
        });
        schema.set(
          `${this.encodeMetricIdForColumnName(metric.id)}_denominator_value`,
          this.getDataType(denominatorMetadata.intermediateDataType),
        );
      }
    });

    schema.set("refresh_timestamp", this.getDataType("timestamp"));
    schema.set("max_timestamp", this.getDataType("timestamp"));
    schema.set("metric_date", this.getDataType("date"));

    return schema;
  }

  protected getMetricSourceTableColumnDefinitions(
    baseIdType: string,
    metrics: FactMetricInterface[],
  ): string[] {
    const schema = this.getMetricSourceTableSchema(baseIdType, metrics);
    return Array.from(schema.entries()).map(
      ([columnName, dataType]) => `${columnName} ${dataType}`,
    );
  }

  protected getMetricSourceTableColumns(
    baseIdType: string,
    metrics: FactMetricInterface[],
  ): string[] {
    const schema = this.getMetricSourceTableSchema(baseIdType, metrics);
    return Array.from(schema.keys());
  }

  protected getMetricSourceCovariateTableSchema(
    baseIdType: string,
    metrics: FactMetricInterface[],
  ): Map<string, string> {
    const schema = new Map<string, string>();

    schema.set(baseIdType, this.getDataType("string"));

    metrics.forEach((metric) => {
      const numeratorMetadata = this.getAggregationMetadata({
        metric,
        useDenominator: false,
      });
      schema.set(
        `${this.encodeMetricIdForColumnName(metric.id)}_value`,
        this.getDataType(numeratorMetadata.finalDataType),
      );

      if (isRatioMetric(metric)) {
        const denominatorMetadata = this.getAggregationMetadata({
          metric,
          useDenominator: true,
        });
        schema.set(
          `${this.encodeMetricIdForColumnName(metric.id)}_denominator_value`,
          this.getDataType(denominatorMetadata.finalDataType),
        );
      }
    });

    return schema;
  }

  protected getMetricSourceCovariateTableColumnDefinitions(
    baseIdType: string,
    metrics: FactMetricInterface[],
  ): string[] {
    const schema = this.getMetricSourceCovariateTableSchema(
      baseIdType,
      metrics,
    );
    return Array.from(schema.entries()).map(
      ([columnName, dataType]) => `${columnName} ${dataType}`,
    );
  }

  protected getMetricSourceCovariateTableColumns(
    baseIdType: string,
    metrics: FactMetricInterface[],
  ): string[] {
    const schema = this.getMetricSourceCovariateTableSchema(
      baseIdType,
      metrics,
    );
    return Array.from(schema.keys());
  }

  getInsertMetricSourceDataQuery(
    params: InsertMetricSourceDataQueryParams,
  ): string {
    const exposureQuery = this.getExposureQuery(
      params.settings.exposureQueryId || "",
      undefined,
    );

    const factTableMap = params.factTableMap;
    const factTable = factTableMap.get(
      params.metrics[0].numerator?.factTableId,
    );
    if (!factTable) {
      throw new Error("Could not find fact table");
    }

    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE({
      objects: [[exposureQuery.userIdType], factTable?.userIdTypes || []],
      // TODO(incremental-refresh): this gets all identities from history
      // of experiment, which we think is right, but could be improved
      from: params.settings.startDate,
      to: params.settings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: params.settings.experimentId,
    });

    const sortedMetrics = params.metrics.sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const paramsMetricsSorted = {
      ...params,
      metrics: sortedMetrics,
    };

    // TODO(incremental-refresh): use max hours to convert from here
    // for eventual "skipPartialData" feature
    const { factTablesWithMetricData } =
      this.parseExperimentFactMetricsParams(paramsMetricsSorted);

    // TODO(incremental-refresh): ensure only one fact table with metric data
    // at this part of the query; multi-fact table metrics should be split across
    // their own getInsertMetricSourceDataQuery calls
    if (factTablesWithMetricData.length !== 1) {
      throw new Error("Expected exactly one fact table with metric data");
    }
    const factTableWithMetricData = factTablesWithMetricData[0];
    const metricData = factTableWithMetricData.metricData;

    // Get consistent column names using the helper
    const columnNames = this.getMetricSourceTableColumns(
      baseIdType,
      sortedMetrics,
    );

    return format(
      `
    INSERT INTO ${params.metricSourceTableFullName}
    (${columnNames.join(", \n")})
    SELECT * FROM (
      WITH 
        ${idJoinSQL}
        __factTable AS (${this.getFactMetricCTE({
          baseIdType,
          idJoinMap,
          metricsWithIndices: factTableWithMetricData.metricData.map((m) => ({
            metric: m.metric,
            index: m.metricIndex,
          })),
          factTable: factTableWithMetricData.factTable,
          startDate: factTableWithMetricData.metricStart,
          endDate: factTableWithMetricData.metricEnd,
          castIdToString: true,
          addFiltersToWhere: true,
          // if last max timestamp is later than metric start and thus the start
          // date, we need to get data strictly greater than, not just greater than
          // or equal to the start date
          exclusiveStartDateFilter:
            factTableWithMetricData.bindingLastMaxTimestamp,
        })})
        , __maxTimestamp AS (
          SELECT ${this.castToTimestamp("MAX(timestamp)")} AS max_timestamp FROM __factTable
        )
        , __newMetricRows AS (
          SELECT
            m.${baseIdType} AS ${baseIdType}
            , m.timestamp AS timestamp
            ${metricData
              .map(
                (data) =>
                  `, ${this.addCaseWhenTimeFilter({
                    col: `m.${data.alias}_value`,
                    metric: data.metric,
                    overrideConversionWindows: data.overrideConversionWindows,
                    // The experiment end date, because this is used
                    // to filter metrics that only capture data during
                    // the experiment
                    endDate: params.settings.endDate,
                    metricQuantileSettings: data.quantileMetric
                      ? data.metricQuantileSettings
                      : undefined,
                    metricTimestampColExpr: this.castToTimestamp("m.timestamp"),
                    exposureTimestampColExpr: "d.first_exposure_timestamp",
                  })} AS ${data.alias}_value
                ${
                  data.ratioMetric
                    ? `, ${this.addCaseWhenTimeFilter({
                        col: `m.${data.alias}_denominator`,
                        metric: data.metric,
                        overrideConversionWindows:
                          data.overrideConversionWindows,
                        endDate: params.settings.endDate,
                        metricTimestampColExpr:
                          this.castToTimestamp("m.timestamp"),
                        exposureTimestampColExpr: "d.first_exposure_timestamp",
                      })} AS ${data.alias}_denominator`
                    : ""
                }
                `,
              )
              .join("\n")}
          FROM __factTable m
          INNER JOIN ${params.unitsSourceTableFullName} d
            ON (d.${baseIdType} = m.${baseIdType})
        )
        , __newDailyValues AS (
          SELECT
            ${baseIdType}
            , ${this.castToDate("timestamp")} AS metric_date
            ${metricData
              .map((m) => {
                // Use partial aggregation function since we are
                // aggregating at the user-date level, not the user level
                const aggfunction =
                  m.numeratorAggFns.partialAggregationFunction;
                const denomAggFunction =
                  m.denominatorAggFns.partialAggregationFunction;
                return `
                , ${aggfunction(`${m.alias}_value`)} AS ${this.encodeMetricIdForColumnName(m.id)}_value
                ${
                  !!denomAggFunction && isRatioMetric(m.metric)
                    ? `, ${denomAggFunction(`${m.alias}_denominator`)} AS ${this.encodeMetricIdForColumnName(m.id)}_denominator_value`
                    : ""
                }
              `;
              })
              .join("\n")}
          FROM __newMetricRows
          GROUP BY
            ${baseIdType}
            , ${this.castToDate("timestamp")}
        )
       SELECT
          dv.${baseIdType} AS ${baseIdType}
          ${metricData
            .map(
              (m) =>
                `, ${this.encodeMetricIdForColumnName(m.id)}_value AS ${this.encodeMetricIdForColumnName(m.id)}_value${
                  m.ratioMetric
                    ? `\n, ${this.encodeMetricIdForColumnName(m.id)}_denominator_value AS ${this.encodeMetricIdForColumnName(m.id)}_denominator_value`
                    : ""
                }`,
            )
            .join("\n")}
          , ${this.getCurrentTimestamp()} AS refresh_timestamp
          , mt.max_timestamp AS max_timestamp
          , dv.metric_date AS metric_date
        FROM __newDailyValues dv
        CROSS JOIN __maxTimestamp mt
)
      `,
      this.getFormatDialect(),
    );
  }

  // TODO(incremental-refresh): only need to run one per group, while the rest of the metrics pipeline
  // needs to run once per fact table, once we allow metrics that cross
  // fact tables to be added
  getIncrementalRefreshStatisticsQuery(
    params: IncrementalRefreshStatisticsQueryParams,
  ): string {
    const exposureQuery = this.getExposureQuery(
      params.settings.exposureQueryId || "",
      undefined,
    );

    const { factTablesWithMetricData } =
      this.parseExperimentFactMetricsParams(params);

    // TODO(incremental-refresh): generalize to multiple sources
    if (factTablesWithMetricData.length !== 1) {
      throw new Error("Expected exactly one fact table with metric data");
    }
    const factTableWithMetricData = factTablesWithMetricData[0];
    const metricData = factTableWithMetricData.metricData;
    const percentileData = factTableWithMetricData.percentileData;
    const regressionAdjustedMetrics =
      factTableWithMetricData.regressionAdjustedMetrics;

    const regressionAdjustedTableIndices = new Set<number>();
    if (regressionAdjustedMetrics.length > 0) {
      regressionAdjustedTableIndices.add(0);
    }
    const percentileTableIndices = new Set<number>();
    if (percentileData.length > 0) {
      percentileTableIndices.add(0);
    }

    // exploratory dimensions
    const { experimentDimensions, unitDimensions, dateDimension } =
      this.processDimensions(
        params.dimensionsForAnalysis,
        params.settings,
        params.activationMetric,
      );

    const idTypeObjects = [
      [exposureQuery.userIdType],
      ...unitDimensions.map((d) => [d.dimension.userIdType]),
    ];

    const { baseIdType, idJoinMap, idJoinSQL } = this.getIdentitiesCTE({
      objects: idTypeObjects,
      from: params.settings.startDate,
      to: params.settings.endDate,
      forcedBaseIdType: exposureQuery.userIdType,
      experimentId: params.settings.experimentId,
    });

    const unitDimensionCols = unitDimensions.map((d) => ({
      // override value with the a MAX statement that will get one
      // value per unit
      value: this.getDimensionValuePerUnit(d),
      alias: this.getDimensionCol(d).alias,
    }));

    const experimentDimensionCols = experimentDimensions.map((d) =>
      this.getDimensionCol(d),
    );
    const precomputedDimensionCols: DimensionColumnData[] =
      params.dimensionsForPrecomputation.map((d) => {
        const col = this.getDimensionCol(d);
        // override value with case when statement for precomputed dimensions
        const value = this.getDimensionInStatement(
          col.alias,
          d.specifiedSlices,
        );
        return {
          value,
          alias: col.alias,
        };
      });
    const dateDimensionCol = dateDimension
      ? this.getDimensionCol(dateDimension)
      : undefined;

    const nonUnitDimensionCols = [
      ...experimentDimensionCols,
      ...(dateDimensionCol ? [dateDimensionCol] : []),
      ...precomputedDimensionCols,
    ];
    const allDimensionCols = [...nonUnitDimensionCols, ...unitDimensionCols];
    // TODO(incremental-refresh): Handle activation metric in dimensions
    // like in getExperimentFactMetricsQuery
    // TODO(incremental-refresh): Validate with existing columns
    return format(
      `
      WITH 
      ${idJoinSQL}
      __metricSourceData AS (
        SELECT * FROM ${params.metricSourceTableFullName}
      )
      ${unitDimensions
        .map(
          (d) =>
            `, __dim_unit_${d.dimension.id} AS (${this.getDimensionCTE(
              d.dimension,
              baseIdType,
              idJoinMap,
            )})`,
        )
        .join("\n")}
      , __experimentUnits AS (${
        unitDimensions.length > 0
          ? `SELECT
            e.${baseIdType} AS ${baseIdType}
            , MIN(e.variation) AS variation
            , MIN(e.first_exposure_timestamp) AS first_exposure_timestamp
            ${unitDimensionCols.map((d) => `, ${d.value} AS ${d.alias}`).join("")}
            ${nonUnitDimensionCols.map((d) => `, MIN(${d.value}) AS ${d.alias}`).join("")}
          FROM ${params.unitsSourceTableFullName} e
          ${unitDimensions
            .map(
              (
                d,
              ) => `LEFT JOIN __dim_unit_${d.dimension.id} __dim_unit_${d.dimension.id} ON (
            __dim_unit_${d.dimension.id}.${baseIdType} = e.${baseIdType}
          )`,
            )
            .join("\n")}
          GROUP BY
            e.${baseIdType}
      `
          : `SELECT
          e.${baseIdType} AS ${baseIdType}
          , e.variation AS variation
          , e.first_exposure_timestamp AS first_exposure_timestamp
          ${nonUnitDimensionCols.map((d) => `, ${d.value} AS ${d.alias}`).join("")}
        FROM ${params.unitsSourceTableFullName} e`
      })
      , __metricDataAggregated AS (
        SELECT
          ${baseIdType}
          ${metricData
            .map((data) => {
              const reAggFunction = data.numeratorAggFns.reAggregationFunction;
              const denomReAggFunction =
                data.denominatorAggFns.reAggregationFunction;
              return `, ${reAggFunction(`umj.${this.encodeMetricIdForColumnName(data.metric.id)}_value`)} AS ${this.encodeMetricIdForColumnName(data.metric.id)}_value
                ${
                  data.ratioMetric && denomReAggFunction
                    ? `, ${denomReAggFunction(`umj.${this.encodeMetricIdForColumnName(data.metric.id)}_denominator_value`)} AS ${this.encodeMetricIdForColumnName(data.metric.id)}_denominator_value`
                    : ""
                }`;
            })
            .join("\n")}
        FROM __metricSourceData umj
        GROUP BY
          ${baseIdType}
      )
      , __joinedData AS (
          SELECT
            u.${baseIdType}
            ${allDimensionCols.map((d) => `, u.${d.alias} AS ${d.alias}`).join("")}
            , u.variation
            ${metricData
              // TODO(incremental-refresh): here is where we need to nullif 0 for
              // quantiles with ignore zeros. Otherwise the coalesce seems fine.
              .map((data) => {
                return `, ${data.aggregatedValueTransformation({
                  column: `COALESCE(${this.encodeMetricIdForColumnName(data.metric.id)}_value, 0)`,
                  initialTimestampColumn: "u.first_exposure_timestamp",
                  analysisEndDate: params.settings.endDate,
                })} AS ${data.alias}_value ${
                  data.ratioMetric
                    ? `, ${data.aggregatedValueTransformation({
                        column: `COALESCE(${this.encodeMetricIdForColumnName(data.metric.id)}_denominator_value, 0)`,
                        initialTimestampColumn: "u.first_exposure_timestamp",
                        analysisEndDate: params.settings.endDate,
                      })} AS ${data.alias}_denominator`
                    : ""
                }`;
              })
              .join("\n")}
          FROM __experimentUnits u
          LEFT JOIN __metricDataAggregated m ON u.${baseIdType} = m.${baseIdType}
      )
      ${
        percentileData.length > 0
          ? `
        , __capValue AS (
            ${this.percentileCapSelectClause(percentileData, "__joinedData")}
        )
        `
          : ""
      }
      ${
        // TODO(incremental-refresh): GROUP BY is not necessary but is a failsafe
        // against bad insertions into covariate table
        regressionAdjustedMetrics.length > 0
          ? `
        , __userCovariateMetric AS (
          SELECT 
            ${baseIdType}
            ${regressionAdjustedMetrics
              .map(
                (data) =>
                  `, MAX(${this.encodeMetricIdForColumnName(data.id)}_value) AS ${data.alias}_value
                ${data.ratioMetric ? `\n, MAX(${this.encodeMetricIdForColumnName(data.id)}_denominator_value) AS ${data.alias}_denominator` : ""}`,
              )
              .join("\n")}
          FROM ${params.metricSourceCovariateTableFullName}
          GROUP BY ${baseIdType}
        )
        `
          : ""
      }
      ${this.getExperimentFactMetricStatisticsCTE({
        dimensionCols: allDimensionCols,
        metricData,
        eventQuantileData: [], // TODO(incremental-refresh): quantiles
        baseIdType,
        joinedMetricTableName: "__joinedData",
        eventQuantileTableName: "__eventQuantileMetric",
        cupedMetricTableName: "__userCovariateMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [
          {
            factTable: factTableWithMetricData.factTable,
            index: 0,
          },
        ],
        regressionAdjustedTableIndices,
        percentileTableIndices,
      })}
      `,
      this.getFormatDialect(),
    );
  }

  async runIncrementalRefreshStatisticsQuery(
    sql: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentFactMetricsQueryResponse> {
    const { rows, statistics } = await this.runQuery(sql, setExternalId);
    return {
      rows: this.processExperimentFactMetricsQueryRows(rows),
      statistics: statistics,
    };
  }

  getSampleUnitsCTE(): string {
    return format(
      `__experimentUnits AS (
        SELECT 'user_1' AS user_id, 'A' AS variation, cast(${this.getCurrentTimestamp()} as timestamp) AS first_exposure_timestamp
        UNION ALL
        SELECT 'user_2' AS user_id, 'B' AS variation, cast(${this.getCurrentTimestamp()} as timestamp) AS first_exposure_timestamp
      )`,
      this.getFormatDialect(),
    );
  }

  encodeMetricIdForColumnName(metricId: string): string {
    // We are using ? for slices and that is an invalid character for column names
    // so we encode it.
    // We use base58 because base64 includes charactes that are invalid too
    const parts = metricId.split("?");
    if (parts.length === 2) {
      const encoded = bs58.encode(Buffer.from(parts[1]));
      return `${parts[0]}_${encoded}`;
    }
    return parts[0];
  }
}
