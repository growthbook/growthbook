import cloneDeep from "lodash/cloneDeep";
import { getValidDate } from "shared/dates";
import { parseIntWithDefault } from "shared/util";
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
  isPercentileCappedMetric,
  parseSliceMetricId,
  eligibleForUncappedMetric,
} from "shared/experiments";
import {
  DEFAULT_TEST_QUERY_DAYS,
  DEFAULT_METRIC_HISTOGRAM_BINS,
  BANDIT_SRM_DIMENSION_NAME,
  SAFE_ROLLOUT_TRACKING_KEY_PREFIX,
} from "shared/constants";
import {
  generateProductAnalyticsSQL,
  calculateProductAnalyticsDateRange,
  PIPELINE_MODE_SUPPORTED_DATA_SOURCE_TYPES,
} from "shared/enterprise";
import {
  ensureLimit,
  format,
  isMultiStatementSQL,
  SQL_ROW_LIMIT,
} from "shared/sql";
import {
  PhaseSQLVar,
  TemplateVariables,
  FormatDialect,
  DateTruncGranularity,
  SqlHelpers,
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
  ExperimentAggregateUnitsQueryResponse,
  ExperimentAggregateUnitsQueryParams,
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
  DataSourceProperties,
  ExposureQuery,
  SchemaFormatConfig,
  DataSourceInterface,
  AutoFactTableSchemas,
  SchemaFormat,
} from "shared/types/datasource";
import {
  ExperimentSnapshotSettings,
  SnapshotBanditSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import {
  FactMetricInterface,
  FactTableInterface,
  MetricQuantileSettings,
} from "shared/types/fact-table";
import type { PopulationDataQuerySettings } from "shared/types/query";
import { ExplorationConfig } from "shared/validators";
import {
  AdditionalQueryMetadata,
  QueryMetadata,
  QueryType,
} from "shared/types/query";
import { MissingDatasourceParamsError } from "back-end/src/util/errors";
import { ReqContext } from "back-end/types/request";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  getBaseIdTypeAndJoins,
  compileSqlTemplate,
} from "back-end/src/util/sql";
import { formatInformationSchema } from "back-end/src/util/informationSchemas";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { logger } from "back-end/src/util/logger";
import { applyMetricOverrides } from "back-end/src/util/integration";
import { ReqContextClass } from "back-end/src/services/context";
import {
  ALL_NON_QUANTILE_METRIC_FLOAT_COLS,
  MAX_METRICS_PER_QUERY,
  N_STAR_VALUES,
} from "back-end/src/services/experimentQueries/constants";
import { addCaseWhenTimeFilter } from "./sql/add-case-when-time-filter";
import { addHours } from "./sql/add-hours";
import { getAggregateMetricColumnLegacyMetrics } from "./sql/aggregate-metric-column-legacy-metrics";
import { getAlterNewIncrementalUnitsQuery } from "./sql/alter-new-incremental-units-query";
import { getBanditCaseWhen } from "./sql/bandit-case-when";
import { getBanditStatisticsCTE } from "./sql/bandit-statistics-cte";
import { getBanditStatisticsFactMetricCTE } from "./sql/bandit-statistics-fact-metric-cte";
import { capCoalesceValue } from "./sql/cap-coalesce-value";
import { getColumnsTopValuesQuery as getColumnsTopValuesQueryStandalone } from "./sql/columns-top-values-query";
import { castToHllDataType } from "./sql/cast-to-hll-data-type";
import { castToTimestamp } from "./sql/cast-to-timestamp";
import { getConversionWindowClause } from "./sql/conversion-window-clause";
import { getDimensionCTE } from "./sql/dimension-cte";
import { getDimensionInStatement } from "./sql/dimension-in-statement";
import { getDimensionValuePerUnit } from "./sql/dimension-value-per-unit";
import { getDropMetricSourceCovariateTableQuery } from "./sql/drop-metric-source-covariate-table-query";
import { getDropOldIncrementalUnitsQuery } from "./sql/drop-old-incremental-units-query";
import { getDropUnitsTableQuery } from "./sql/drop-units-table-query";
import { encodeMetricIdForColumnName } from "./sql/encode-metric-id-for-column-name";
import { getExperimentEndDate } from "./sql/experiment-end-date";
import { getExperimentResultsQuery } from "./sql/experiment-results-query";
import { getFactMetricCTE } from "./sql/fact-metric-cte";
import { getFilterColumnsClause } from "./sql/filter-columns-clause";
import { getFirstVariationValuePerUnit } from "./sql/first-variation-value-per-unit";
import { getFreeFormQuery } from "./sql/free-form-query";
import { getIdentitiesCTE } from "./sql/identities-cte";
import { getMaxHoursToConvert } from "./sql/max-hours-to-convert";
import { getMetricAnalysisStatisticClauses } from "./sql/metric-analysis-statistic-clauses";
import { getMetricColumns } from "./sql/metric-columns";
import { getMetricEnd } from "./sql/metric-end";
import { getMetricMinDelay } from "./sql/metric-min-delay";
import { getMetricQueryFormat } from "./sql/metric-query-format";
import { getMetricStart } from "./sql/metric-start";
import { percentileCapSelectClause as percentileCapSelectClauseStandalone } from "./sql/percentile-cap-select-clause";
import { getPipelineValidationInsertQuery } from "./sql/pipeline-validation-insert-query";
import { getPowerPopulationCTEs } from "./sql/power-population-ctes";
import { getPowerPopulationSourceCTE } from "./sql/power-population-source-cte";
import { processActivationMetric } from "./sql/process-activation-metric";
import { processDimensions } from "./sql/process-dimensions";
import { getQuantileBoundValues } from "./sql/quantile-bound-values";
import { getQuantileBoundsFromQueryResponse as quantileBoundsFromQueryResponseSql } from "./sql/quantile-bounds-from-query-response";
import { quantileColumn } from "./sql/quantile-column";
import { getSampleUnitsCTE } from "./sql/sample-units-cte";
import { getSegmentCTE } from "./sql/segment-cte";
import { toTimestampWithMs } from "./sql/to-timestamp-with-ms";
import { getUnitCountCTE } from "./sql/unit-count-cte";

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
  // Metadata set by the individual query runners
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
      canGroupPercentileCappedMetrics: this.canGroupPercentileCappedMetrics(),
      hasCountDistinctHLL: this.hasCountDistinctHLL(),
      hasQuantileKLL: this.hasQuantileKLL(),
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
    return toTimestampWithMs(date);
  }
  addHours(col: string, hours: number) {
    return addHours(this.getSqlHelpers(), col, hours);
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ): string {
    return `${col} ${sign} INTERVAL '${amount} ${unit}s'`;
  }
  dateTrunc(col: string, granularity: DateTruncGranularity = "day") {
    return `date_trunc('${granularity}', ${col})`;
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
    return castToTimestamp(col);
  }
  castToHllDataType(col: string): string {
    return castToHllDataType(this.getSqlHelpers(), col);
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
  canGroupPercentileCappedMetrics(): boolean {
    return true;
  }
  hasCountDistinctHLL(): boolean {
    return false;
  }
  hasQuantileKLL(): boolean {
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
  // eslint-disable-next-line
  kllInit(col: string): string {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  }
  // eslint-disable-next-line
  kllMergePartial(col: string): string {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  }
  // eslint-disable-next-line
  kllExtractPoint(col: string, quantile: number): string {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  }
  // eslint-disable-next-line
  kllExtractQuantiles(col: string, numQuantiles: number): string {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  }
  /**
   * SQL expression that approximates (fraction of events below threshold) × n_events
   * for a per-user merged KLL sketch, using a discrete CDF from the sketch.
   *
   * Implementations typically: sample the sketch at numQuantiles evenly spaced
   * quantile levels (yielding numQuantiles+1 monotone values), count how many
   * samples are strictly below the threshold, scale by n_events / numQuantiles,
   * and COALESCE to 0 when sketch or threshold is null / empty.
   *
   * Fraction discretization error is O(1/numQuantiles) (e.g. ±1% at 100).
   * Warehouses must override together with kllExtractQuantiles when
   * hasQuantileKLL() is true.
   */
  kllRankApprox(
    _sketchCol: string,
    _thresholdCol: string,
    _nEventsCol: string,
    _numQuantiles: number,
  ): string {
    throw new Error(
      "KLL rank approximation is not implemented for this data source.",
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
    queryMetadata?: QueryMetadata,
  ): Promise<PastExperimentQueryResponse> {
    const { rows, statistics } = await this.runQuery(
      query,
      setExternalId,
      queryMetadata,
    );

    return {
      rows: rows.map((row) => {
        return {
          exposure_query: row.exposure_query,
          experiment_id: row.experiment_id,
          experiment_name: row.experiment_name,
          variation_id: row.variation_id ?? "",
          variation_name: row.variation_name,
          users: parseIntWithDefault(row.users, 0),
          end_date: getValidDate(row.end_date).toISOString(),
          start_date: getValidDate(row.start_date).toISOString(),
          latest_data: getValidDate(row.latest_data).toISOString(),
        };
      }),
      statistics: statistics,
    };
  }

  getMetricValueQuery(params: MetricValueParams): string {
    const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
        objects: [
          params.metric.userIdTypes || [],
          params.segment ? [params.segment.userIdType || "user_id"] : [],
        ],
        from: params.from,
        to: params.to,
      },
    );

    // Get rough date filter for metrics to improve performance
    const metricStart = getMetricStart(
      params.from,
      getMetricMinDelay([params.metric]),
      0,
    );
    const metricEnd = getMetricEnd([params.metric], params.to);

    const aggregate = getAggregateMetricColumnLegacyMetrics(
      this.getSqlHelpers(),
      {
        metric: params.metric,
      },
    );

    // TODO query is broken if segment has template variables
    return format(
      `-- ${params.name} - ${params.metric.name} Metric
      WITH
        ${idJoinSQL}
        ${
          params.segment
            ? `segment as (${getSegmentCTE(
                this.getSqlHelpers(),
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
    return getPowerPopulationSourceCTE(this.getSqlHelpers(), {
      settings,
      factTableMap,
      segment,
    });
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
      __segment as (${getSegmentCTE(
        this.getSqlHelpers(),
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
    return getMetricAnalysisStatisticClauses(
      finalValueColumn,
      finalDenominatorColumn,
      ratioMetric,
    );
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
    const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
        objects: idTypeObjects,
        from: settings.startDate,
        to: settings.endDate ?? undefined,
        forcedBaseIdType: settings.userIdType,
      },
    );

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
      "m",
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

    const finalValueColumn = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: "value",
      metric,
      capTablePrefix: "cap",
      capValueCol: "value_capped",
      columnRef: metric.numerator,
    });
    const finalDenominatorColumn = capCoalesceValue(this.getSqlHelpers(), {
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
      __factTable AS (${getFactMetricCTE(this.getSqlHelpers(), {
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
    queryMetadata?: QueryMetadata,
  ): Promise<MetricAnalysisQueryResponse> {
    const { rows, statistics } = await this.runQuery(
      query,
      setExternalId,
      queryMetadata,
    );

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
    return quantileBoundsFromQueryResponseSql(row, prefix);
  }

  async runPopulationFactMetricsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<ExperimentFactMetricsQueryResponse> {
    return this.runExperimentFactMetricsQuery(
      query,
      setExternalId,
      queryMetadata,
    );
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
        users: parseIntWithDefault(row.users, 0),
        count: parseIntWithDefault(row.users, 0),
        ...metricData,
      };
    });
  }

  async runExperimentFactMetricsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<ExperimentFactMetricsQueryResponse> {
    const { rows, statistics } = await this.runQuery(
      query,
      setExternalId,
      queryMetadata,
    );

    return {
      rows: this.processExperimentFactMetricsQueryRows(rows),
      statistics: statistics,
    };
  }

  async runPopulationMetricQuery(
    query: string,
    setExternalId: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<ExperimentMetricQueryResponse> {
    return this.runExperimentMetricQuery(query, setExternalId, queryMetadata);
  }

  async runExperimentMetricQuery(
    query: string,
    setExternalId: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<ExperimentMetricQueryResponse> {
    const { rows, statistics } = await this.runQuery(
      query,
      setExternalId,
      queryMetadata,
    );

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
          users: parseIntWithDefault(row.users, 0),
          count: parseIntWithDefault(row.users, 0),
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
    queryMetadata?: QueryMetadata,
  ): Promise<ExperimentAggregateUnitsQueryResponse> {
    const { rows, statistics } = await this.runQuery(
      query,
      setExternalId,
      queryMetadata,
    );
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
    queryMetadata?: QueryMetadata,
  ): Promise<ExperimentUnitsQueryResponse> {
    return await this.runQuery(query, setExternalId, queryMetadata);
  }

  async runMetricValueQuery(
    query: string,
    setExternalId: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<MetricValueQueryResponse> {
    const { rows, statistics } = await this.runQuery(
      query,
      setExternalId,
      queryMetadata,
    );

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
    return getFreeFormQuery(this.getSqlHelpers(), sql, limit);
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
    queryType?: QueryType,
  ): Promise<TestQueryResult> {
    const queryStartTime = Date.now();
    const results = await this.runQuery(
      sql,
      undefined,
      queryType ? { queryType } : undefined,
    );
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
    return getDropUnitsTableQuery(params);
  }

  async runDropTableQuery(
    sql: string,
    setExternalId: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<DropTableQueryResponse> {
    const results = await this.runQuery(sql, setExternalId, queryMetadata);
    return results;
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
            return getConversionWindowClause(
              this.getSqlHelpers(),
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

  getDimensionInStatement(dimension: string, values: string[]): string {
    return getDimensionInStatement(this.getSqlHelpers(), dimension, values);
  }

  getPopulationMetricQuery(params: PopulationMetricQueryParams): string {
    const { factTableMap, segment, populationSettings } = params;
    // dimension date?
    const populationSQL = getPowerPopulationCTEs(this.getSqlHelpers(), {
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

    const populationSQL = getPowerPopulationCTEs(this.getSqlHelpers(), {
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

    const activationMetric = processActivationMetric(
      activationMetricDoc,
      settings,
    );

    const { experimentDimensions, unitDimensions } = processDimensions(
      params.dimensions,
      settings,
      activationMetric,
    );

    const exposureQuery = this.getExposureQuery(
      settings.exposureQueryId || "",
      undefined,
    );

    // Get any required identity join queries
    const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
        objects: [
          [exposureQuery.userIdType],
          activationMetric
            ? getUserIdTypes(activationMetric, factTableMap)
            : [],
          ...unitDimensions.map((d) => [d.dimension.userIdType || "user_id"]),
          segment ? [segment.userIdType || "user_id"] : [],
        ],
        from: settings.startDate,
        to: settings.endDate,
        forcedBaseIdType: exposureQuery.userIdType,
        experimentId: settings.experimentId,
      },
    );

    // Get date range for experiment
    const startDate: Date = settings.startDate;
    const endDate: Date = getExperimentEndDate(settings, 0);

    const timestampColumn = "e.timestamp";
    // BQ datetime cast for SELECT statements (do not use for where)
    const timestampDateTimeColumn = this.castUserDateCol(timestampColumn);
    const overrideConversionWindows =
      settings.attributionModel === "experimentDuration" ||
      settings.attributionModel === "lookbackOverride";

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
            startDate: getMetricStart(
              settings.startDate,
              getDelayWindowHours(activationMetric.windowSettings),
              0,
            ),
            endDate: getMetricEnd(
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
        ? `, __segment as (${getSegmentCTE(
            this.getSqlHelpers(),
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
          `, __dim_unit_${d.dimension.id} as (${getDimensionCTE(
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
        , ${
          !!settings.banditSettings?.useFirstExposure && settings.banditSettings
            ? getFirstVariationValuePerUnit(this.getSqlHelpers())
            : this.ifElse(
                "count(distinct e.variation) > 1",
                "'__multiple__'",
                "max(e.variation)",
              )
        } AS variation
        , MIN(${timestampColumn}) AS first_exposure_timestamp
        ${unitDimensions
          .map(
            (d) => `
          , ${getDimensionValuePerUnit(this.getSqlHelpers(), d)} AS dim_unit_${d.dimension.id}`,
          )
          .join("\n")}
        ${experimentDimensions
          .map(
            (d) => `
          , ${getDimensionValuePerUnit(this.getSqlHelpers(), d)} AS dim_exp_${d.id}`,
          )
          .join("\n")}
        ${
          activationMetric
            ? `, MIN(${this.ifElse(
                getConversionWindowClause(
                  this.getSqlHelpers(),
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
    const { baseIdType, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
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
      },
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
    return getUnitCountCTE(
      this.getSqlHelpers(),
      dimensionColumn,
      whereClause,
      ensureFloat,
    );
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
            , ${getDimensionValuePerUnit(this.getSqlHelpers(), d)} AS dim_exp_${d.id}`,
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
    queryMetadata?: QueryMetadata,
  ): Promise<DimensionSlicesQueryResponse> {
    const { rows, statistics } = await this.runQuery(
      query,
      setExternalId,
      queryMetadata,
    );
    return {
      rows: rows.map((row) => {
        return {
          dimension_value: row.dimension_value ?? "",
          dimension_name: row.dimension_name ?? "",
          units: parseIntWithDefault(row.units, 0),
          total_units: parseIntWithDefault(row.total_units, 0),
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

    const compiledFeatureEvalQuery = compileSqlTemplate(featureEvalQuery, {
      startDate: oneWeekAgo,
    });

    return format(
      `-- Feature Evaluation Diagnostics Query
      WITH __featureEvalQuery AS (
        ${compiledFeatureEvalQuery}
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
    const { rows, statistics } = await this.runQuery(query, undefined, {
      queryType: "userExposure",
    });

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
    const { rows, statistics } = await this.runQuery(query, undefined, {
      queryType: "featureEvalDiagnostics",
    });

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
    covariateTableAlias: string = "m",
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
      settings.attributionModel === "experimentDuration" ||
      settings.attributionModel === "lookbackOverride";

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
    const capCoalesceMetric = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: `m${numeratorAlias}.${alias}_value`,
      metric,
      capTablePrefix: `cap${numeratorAlias}`,
      capValueCol: `${alias}_value_cap`,
      columnRef: metric.numerator,
    });
    const capCoalesceDenominator = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: `m${denominatorAlias}.${alias}_denominator`,
      metric,
      capTablePrefix: `cap${denominatorAlias}`,
      capValueCol: `${alias}_denominator_cap`,
      columnRef: metric.denominator,
    });
    const capCoalesceCovariate = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: `${covariateTableAlias}${numeratorAlias}.${alias}_covariate_value`,
      metric,
      capTablePrefix: `cap${numeratorAlias}`,
      capValueCol: `${alias}_value_cap`,
      columnRef: metric.numerator,
    });
    const capCoalesceDenominatorCovariate = capCoalesceValue(
      this.getSqlHelpers(),
      {
        valueCol: `${covariateTableAlias}${denominatorAlias}.${alias}_covariate_denominator`,
        metric,
        capTablePrefix: `cap${denominatorAlias}`,
        capValueCol: `${alias}_denominator_cap`,
        columnRef: metric.denominator,
      },
    );
    const uncappedMetric = {
      ...metric,
      cappingSettings: {
        type: "" as const,
        value: 0,
      },
    };
    const uncappedCoalesceMetric = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: `m${numeratorAlias}.${alias}_value`,
      metric: uncappedMetric,
      capTablePrefix: `cap${numeratorAlias}`,
      capValueCol: `${alias}_value_cap`,
      columnRef: metric.numerator,
    });
    const uncappedCoalesceDenominator = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: `m${denominatorAlias}.${alias}_denominator`,
      metric: uncappedMetric,
      capTablePrefix: `cap${denominatorAlias}`,
      capValueCol: `${alias}_denominator_cap`,
      columnRef: metric.denominator,
    });
    const uncappedCoalesceCovariate = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: `${covariateTableAlias}${numeratorAlias}.${alias}_covariate_value`,
      metric: uncappedMetric,
      capTablePrefix: `cap${numeratorAlias}`,
      capValueCol: `${alias}_value_cap`,
      columnRef: metric.numerator,
    });
    const uncappedCoalesceDenominatorCovariate = capCoalesceValue(
      this.getSqlHelpers(),
      {
        valueCol: `${covariateTableAlias}${denominatorAlias}.${alias}_covariate_denominator`,
        metric: uncappedMetric,
        capTablePrefix: `cap${denominatorAlias}`,
        capValueCol: `${alias}_denominator_cap`,
        columnRef: metric.denominator,
      },
    );
    // Get rough date filter for metrics to improve performance
    const orderedMetrics = (activationMetric ? [activationMetric] : []).concat([
      metric,
    ]);
    const minMetricDelay = getMetricMinDelay(orderedMetrics);
    const metricStart = getMetricStart(
      settings.startDate,
      minMetricDelay,
      regressionAdjustmentHours,
    );
    const metricEnd = getMetricEnd(
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

    const maxHoursToConvert = getMaxHoursToConvert(
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
    return getBanditCaseWhen(this.getSqlHelpers(), periods);
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
    const activationMetric = processActivationMetric(
      params.activationMetric,
      settings,
    );

    metricsWithIndices.forEach((m) => {
      applyMetricOverrides(m.metric, settings);
    });
    // Replace any placeholders in the user defined dimension SQL
    const { unitDimensions } = processDimensions(
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
        "m",
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
    const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
        objects: idTypeObjects,
        from: settings.startDate,
        to: settings.endDate,
        forcedBaseIdType: userIdType,
        experimentId: settings.experimentId,
      },
    );

    // Get date range for experiment and analysis
    const endDate: Date = getExperimentEndDate(settings, maxHoursToConvert);

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
          ${getFactMetricCTE(this.getSqlHelpers(), {
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
                      ? `, ${addCaseWhenTimeFilter(this.getSqlHelpers(), {
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
                      ? `, ${addCaseWhenTimeFilter(this.getSqlHelpers(), {
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
            ${
              // CUPED pre-exposure covariate columns: emitted here so that
              // __userCovariateMetric can aggregate them from __userMetricJoin
              // instead of re-scanning __factTable. See getCovariateMetricCTE.
              regressionAdjustedTableIndices.has(f.index)
                ? regressionAdjustedMetrics
                    .map(
                      (metric) =>
                        `${
                          metric.numeratorSourceIndex === f.index
                            ? `, ${this.ifElse(
                                `m.timestamp >= d.${metric.alias}_preexposure_start AND m.timestamp < d.${metric.alias}_preexposure_end`,
                                `m.${metric.alias}_value`,
                                "NULL",
                              )} AS ${metric.alias}_covariate_value`
                            : ""
                        }${
                          metric.ratioMetric &&
                          metric.denominatorSourceIndex === f.index
                            ? `, ${this.ifElse(
                                `m.timestamp >= d.${metric.alias}_preexposure_start AND m.timestamp < d.${metric.alias}_preexposure_end`,
                                `m.${metric.alias}_denominator`,
                                "NULL",
                              )} AS ${metric.alias}_covariate_denominator`
                            : ""
                        }`,
                    )
                    .join("\n")
                : ""
            }
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
          ${
            regressionAdjustedTableIndices.has(f.index)
              ? regressionAdjustedMetrics
                  .map(
                    (metric) =>
                      `${
                        metric.numeratorSourceIndex === f.index
                          ? `, ${metric.covariateNumeratorAggFns.fullAggregationFunction(
                              `umj.${metric.alias}_covariate_value`,
                            )} AS ${metric.alias}_covariate_value`
                          : ""
                      }${
                        metric.ratioMetric &&
                        metric.denominatorSourceIndex === f.index
                          ? `, ${metric.covariateDenominatorAggFns.fullAggregationFunction(
                              `umj.${metric.alias}_covariate_denominator`,
                            )} AS ${metric.alias}_covariate_denominator`
                          : ""
                      }`,
                  )
                  .join("\n")
              : ""
          }
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
      `,
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
        capValueTableName: "__capValue",
        factTablesWithIndices,
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
    capValueTableName,
    factTablesWithIndices,
    percentileTableIndices,
  }: {
    dimensionCols: DimensionColumnData[];
    metricData: FactMetricData[];
    eventQuantileData: FactMetricQuantileData[];
    baseIdType: string;
    joinedMetricTableName: string;
    eventQuantileTableName: string;
    capValueTableName: string;
    factTablesWithIndices: { factTable: FactTableInterface; index: number }[];
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
    const activationMetric = processActivationMetric(
      activationMetricDoc,
      settings,
    );

    applyMetricOverrides(metric, settings);
    denominatorMetrics.forEach((m) => applyMetricOverrides(m, settings));

    // Replace any placeholders in the user defined dimension SQL
    const { unitDimensions } = processDimensions(
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
      settings.attributionModel === "experimentDuration" ||
      settings.attributionModel === "lookbackOverride";

    // Get capping settings and final coalesce statement
    const isPercentileCapped = isPercentileCappedMetric(metric);
    const computeUncappedMetric = eligibleForUncappedMetric(metric);

    const denominatorIsPercentileCapped = denominator
      ? isPercentileCappedMetric(denominator)
      : false;

    const denominatorComputeUncappedMetric = denominator
      ? eligibleForUncappedMetric(denominator)
      : false;

    const capCoalesceMetric = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: "m.value",
      metric,
      capTablePrefix: "cap",
      columnRef: null,
    });
    const capCoalesceDenominator = denominator
      ? capCoalesceValue(this.getSqlHelpers(), {
          valueCol: "d.value",
          metric: denominator,
          capTablePrefix: "capd",
          columnRef: null,
        })
      : "";
    const capCoalesceCovariate = capCoalesceValue(this.getSqlHelpers(), {
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
    const uncappedCoalesceMetric = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: "m.value",
      metric: uncappedMetric,
      capTablePrefix: "cap",
      columnRef: null,
    });
    const uncappedCoalesceDenominator = uncappedDenominator
      ? capCoalesceValue(this.getSqlHelpers(), {
          valueCol: "d.value",
          metric: uncappedDenominator,
          capTablePrefix: "capd",
          columnRef: null,
        })
      : "";
    const uncappedCoalesceCovariate = capCoalesceValue(this.getSqlHelpers(), {
      valueCol: "c.value",
      metric: uncappedCovariate,
      capTablePrefix: "cap",
      columnRef: null,
    });
    // Get rough date filter for metrics to improve performance
    const orderedMetrics = (activationMetric ? [activationMetric] : [])
      .concat(denominatorMetrics)
      .concat([metric]);
    const minMetricDelay = getMetricMinDelay(orderedMetrics);
    const metricStart = getMetricStart(
      settings.startDate,
      minMetricDelay,
      regressionAdjustmentHours,
    );
    const metricEnd = getMetricEnd(
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
    const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
        objects: idTypeObjects,
        from: settings.startDate,
        to: settings.endDate,
        forcedBaseIdType: userIdType,
        experimentId: settings.experimentId,
      },
    );

    // Get date range for experiment and analysis
    const endDate: Date = getExperimentEndDate(
      settings,
      getMaxHoursToConvert(
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
          , ${addCaseWhenTimeFilter(this.getSqlHelpers(), {
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
          , ${getAggregateMetricColumnLegacyMetrics(this.getSqlHelpers(), {
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
                , ${getAggregateMetricColumnLegacyMetrics(
                  this.getSqlHelpers(),
                  {
                    metric: denominator,
                  },
                )} as value
              FROM
                __distinctUsers d
                JOIN __denominator${denominatorMetrics.length - 1} m ON (
                  m.${baseIdType} = d.${baseIdType}
                )
              WHERE
                ${getConversionWindowClause(
                  this.getSqlHelpers(),
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
            , ${getAggregateMetricColumnLegacyMetrics(this.getSqlHelpers(), {
              metric,
            })} as value
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
      ? getBanditStatisticsCTE(this.getSqlHelpers(), {
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
    return getBanditStatisticsCTE(this.getSqlHelpers(), {
      baseIdType,
      metricData,
      dimensionCols,
      hasRegressionAdjustment,
      hasCapping,
      ignoreNulls,
      denominatorIsPercentileCapped,
    });
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
    return getBanditStatisticsFactMetricCTE(this.getSqlHelpers(), {
      baseIdType,
      metricData,
      dimensionCols,
      factTablesWithIndices,
      regressionAdjustedTableIndices,
      percentileTableIndices,
    });
  }

  approxQuantile(value: string, quantile: string | number): string {
    return `APPROX_PERCENTILE(${value}, ${quantile})`;
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
    return percentileCapSelectClauseStandalone(
      this.getSqlHelpers(),
      values,
      metricTable,
      where,
    );
  }

  getExperimentResultsQuery(): string {
    return getExperimentResultsQuery();
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
          getEventFilterWhereClause: (_eventName: string) => "",
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
    return getFilterColumnsClause(filterColumns);
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

  getQuantileGridColumns(
    metricQuantileSettings: MetricQuantileSettings,
    prefix: string,
  ) {
    return `, ${quantileColumn(
      this.getSqlHelpers(),
      `m.${prefix}value`,
      `${prefix}quantile`,
      metricQuantileSettings.quantile,
    )}
    ${N_STAR_VALUES.map((nstar) => {
      const { lower, upper } = getQuantileBoundValues(
        metricQuantileSettings.quantile,
        0.05,
        nstar,
      );
      return `, ${quantileColumn(
        this.getSqlHelpers(),
        `m.${prefix}value`,
        `${prefix}quantile_lower_${nstar}`,
        lower,
      )}
          , ${quantileColumn(
            this.getSqlHelpers(),
            `m.${prefix}value`,
            `${prefix}quantile_upper_${nstar}`,
            upper,
          )}`;
    }).join("\n")}`;
  }

  /**
   * Like getQuantileGridColumns but extracts points from a merged KLL sketch
   * column instead of calling APPROX_PERCENTILE on raw values. Used by the
   * incremental-refresh path where the metric source table stores per-user-date
   * sketches that are merged at stats time.
   */
  getKllQuantileGridColumns(
    metricQuantileSettings: MetricQuantileSettings,
    sketchCol: string,
    prefix: string,
  ) {
    return `, ${this.kllExtractPoint(sketchCol, metricQuantileSettings.quantile)} AS ${prefix}quantile
    ${N_STAR_VALUES.map((nstar) => {
      const { lower, upper } = getQuantileBoundValues(
        metricQuantileSettings.quantile,
        0.05,
        nstar,
      );
      return `, ${this.kllExtractPoint(sketchCol, lower)} AS ${prefix}quantile_lower_${nstar}
          , ${this.kllExtractPoint(sketchCol, upper)} AS ${prefix}quantile_upper_${nstar}`;
    }).join("\n")}`;
  }

  public getColumnsTopValuesQuery(params: ColumnTopValuesParams) {
    return getColumnsTopValuesQueryStandalone(this.getSqlHelpers(), params);
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
    const cols = getMetricColumns(
      this.getSqlHelpers(),
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
    const queryFormat = isFact ? "fact" : getMetricQueryFormat(metric);
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

  // Pipeline validation queries (engine-aware)
  getPipelineValidationInsertQuery({
    tableFullName,
  }: {
    tableFullName: string;
  }): string {
    return getPipelineValidationInsertQuery(this.getSqlHelpers(), {
      tableFullName,
    });
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
      // For incremental refresh, event quantile metrics store a KLL sketch of
      // event values per user-date. Sketches are merged (per user, then per
      // variation) at stats-query time and the quantile grid is extracted via
      // kllExtractPoint. The per-user "count below threshold" (main_sum) is
      // recovered via two-pass rank recovery (kllRankApprox) — see
      // getIncrementalRefreshStatisticsQuery.
      return {
        intermediateDataType: "kll",
        partialAggregationFunction: (column: string) => this.kllInit(column),
        reAggregationFunction: (column: string) => this.kllMergePartial(column),
        finalDataType: "integer",
        fullAggregationFunction: (column: string, quantileColumn?: string) =>
          `SUM(${this.ifElse(`${column} <= ${quantileColumn ?? ""}`, "1", "0")})`,
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

    const activationMetric = processActivationMetric(
      activationMetricDoc,
      settings,
    );

    const { experimentDimensions } = processDimensions(
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
    covariateTableAlias: string;
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

    const activationMetric = processActivationMetric(
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
        params.covariateTableAlias,
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

    const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
        objects: [
          [exposureQuery.userIdType],
          // activationMetric ? getUserIdTypes(activationMetric, factTableMap) : [],
          segment ? [segment.userIdType || "user_id"] : [],
        ],
        from: settings.startDate,
        to: settings.endDate,
        forcedBaseIdType: exposureQuery.userIdType,
        experimentId: settings.experimentId,
      },
    );

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
    const endDate = getExperimentEndDate(settings, 0);

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
            ? `, __segment as (${getSegmentCTE(
                this.getSqlHelpers(),
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
              , ${getDimensionValuePerUnit(this.getSqlHelpers(), d, "dim_exp_")} AS dim_exp_${d.id}`,
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
    return getDropOldIncrementalUnitsQuery(this.getSqlHelpers(), params);
  }

  getAlterNewIncrementalUnitsQuery(
    params: AlterNewIncrementalUnitsQueryParams,
  ): string {
    return getAlterNewIncrementalUnitsQuery(this.getSqlHelpers(), params);
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
    queryMetadata?: QueryMetadata,
  ): Promise<MaxTimestampQueryResponse> {
    const { rows, statistics } = await this.runQuery(
      sql,
      setExternalId,
      queryMetadata,
    );

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
    queryMetadata?: QueryMetadata,
  ): Promise<IncrementalWithNoOutputQueryResponse> {
    const results = await this.runQuery(sql, setExternalId, queryMetadata);
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
      case "kll":
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
    return getDropMetricSourceCovariateTableQuery(this.getSqlHelpers(), params);
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
      covariateTableAlias: string;
      forcedUserIdType?: string;
      lastMaxTimestamp: Date | null;
    } = {
      ...params,
      metrics: sortedMetrics,
      covariateWindowType: "phaseStart",
      covariateTableAlias: "c",
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

    const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
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
      },
    );

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
        __factTable AS (${getFactMetricCTE(this.getSqlHelpers(), {
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
                      )} AS ${m.alias}_covariate_value`
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
                      )} AS ${m.alias}_covariate_denominator`
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
              `, ${m.capCoalesceCovariate} AS ${encodeMetricIdForColumnName(m.id)}_value
              ${m.ratioMetric ? `, ${m.capCoalesceDenominatorCovariate} AS ${encodeMetricIdForColumnName(m.id)}_denominator_value` : ""}
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
      sortedMetrics.some((m) => quantileMetricType(m) === "event") &&
      !this.hasQuantileKLL()
    ) {
      throw new Error(
        "Event quantile metrics with incremental refresh require a data source that supports KLL quantile sketches.",
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
        `${encodeMetricIdForColumnName(metric.id)}_value`,
        this.getDataType(numeratorMetadata.intermediateDataType),
      );

      if (isRatioMetric(metric)) {
        const denominatorMetadata = this.getAggregationMetadata({
          metric,
          useDenominator: true,
        });
        schema.set(
          `${encodeMetricIdForColumnName(metric.id)}_denominator_value`,
          this.getDataType(denominatorMetadata.intermediateDataType),
        );
      }

      // Event quantile metrics store a KLL sketch in _value plus a raw event
      // count per user-date. The count is needed to compute n_events and the
      // clustered-variance denominator at stats time (sketches cannot answer
      // rank queries).
      if (quantileMetricType(metric) === "event") {
        schema.set(
          `${encodeMetricIdForColumnName(metric.id)}_n_events`,
          this.getDataType("integer"),
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
        `${encodeMetricIdForColumnName(metric.id)}_value`,
        this.getDataType(numeratorMetadata.finalDataType),
      );

      if (isRatioMetric(metric)) {
        const denominatorMetadata = this.getAggregationMetadata({
          metric,
          useDenominator: true,
        });
        schema.set(
          `${encodeMetricIdForColumnName(metric.id)}_denominator_value`,
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

    const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
        objects: [[exposureQuery.userIdType], factTable?.userIdTypes || []],
        // TODO(incremental-refresh): this gets all identities from history
        // of experiment, which we think is right, but could be improved
        from: params.settings.startDate,
        to: params.settings.endDate,
        forcedBaseIdType: exposureQuery.userIdType,
        experimentId: params.settings.experimentId,
      },
    );

    const sortedMetrics = params.metrics.sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const paramsMetricsSorted = {
      ...params,
      metrics: sortedMetrics,
    };

    // TODO(incremental-refresh): use max hours to convert from here
    // for eventual "skipPartialData" feature
    const { factTablesWithMetricData } = this.parseExperimentFactMetricsParams({
      ...paramsMetricsSorted,
      covariateTableAlias: "c",
    });

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
        __factTable AS (${getFactMetricCTE(this.getSqlHelpers(), {
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
                  `, ${addCaseWhenTimeFilter(this.getSqlHelpers(), {
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
                    ? `, ${addCaseWhenTimeFilter(this.getSqlHelpers(), {
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
                , ${aggfunction(`${m.alias}_value`)} AS ${encodeMetricIdForColumnName(m.id)}_value
                ${
                  !!denomAggFunction && isRatioMetric(m.metric)
                    ? `, ${denomAggFunction(`${m.alias}_denominator`)} AS ${encodeMetricIdForColumnName(m.id)}_denominator_value`
                    : ""
                }
                ${
                  m.quantileMetric === "event"
                    ? `, COUNT(${m.alias}_value) AS ${encodeMetricIdForColumnName(m.id)}_n_events`
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
                `, ${encodeMetricIdForColumnName(m.id)}_value AS ${encodeMetricIdForColumnName(m.id)}_value${
                  m.ratioMetric
                    ? `\n, ${encodeMetricIdForColumnName(m.id)}_denominator_value AS ${encodeMetricIdForColumnName(m.id)}_denominator_value`
                    : ""
                }${
                  m.quantileMetric === "event"
                    ? `\n, ${encodeMetricIdForColumnName(m.id)}_n_events AS ${encodeMetricIdForColumnName(m.id)}_n_events`
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

    const { factTablesWithMetricData } = this.parseExperimentFactMetricsParams({
      ...params,
      // Covariate data joined to single table with `m` alias before columns are extracted
      covariateTableAlias: "m",
    });

    // TODO(incremental-refresh): generalize to multiple sources
    if (factTablesWithMetricData.length !== 1) {
      throw new Error("Expected exactly one fact table with metric data");
    }
    const factTableWithMetricData = factTablesWithMetricData[0];
    const metricData = factTableWithMetricData.metricData;
    const percentileData = factTableWithMetricData.percentileData;
    const eventQuantileData = factTableWithMetricData.eventQuantileData;
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
      processDimensions(
        params.dimensionsForAnalysis,
        params.settings,
        params.activationMetric,
      );

    const idTypeObjects = [
      [exposureQuery.userIdType],
      ...unitDimensions.map((d) => [d.dimension.userIdType]),
    ];

    const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
      this.getSqlHelpers(),
      this.datasource.settings,
      {
        objects: idTypeObjects,
        from: params.settings.startDate,
        to: params.settings.endDate,
        forcedBaseIdType: exposureQuery.userIdType,
        experimentId: params.settings.experimentId,
      },
    );

    const unitDimensionCols = unitDimensions.map((d) => ({
      // override value with the a MAX statement that will get one
      // value per unit
      value: getDimensionValuePerUnit(this.getSqlHelpers(), d),
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
            `, __dim_unit_${d.dimension.id} AS (${getDimensionCTE(
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
            ${this.castToString(`__dim_unit_${d.dimension.id}.${baseIdType}`)} = e.${baseIdType}
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
              return `, ${reAggFunction(`umj.${encodeMetricIdForColumnName(data.metric.id)}_value`)} AS ${encodeMetricIdForColumnName(data.metric.id)}_value
                ${
                  data.ratioMetric && denomReAggFunction
                    ? `, ${denomReAggFunction(`umj.${encodeMetricIdForColumnName(data.metric.id)}_denominator_value`)} AS ${encodeMetricIdForColumnName(data.metric.id)}_denominator_value`
                    : ""
                }
                ${
                  data.quantileMetric === "event"
                    ? `, SUM(COALESCE(umj.${encodeMetricIdForColumnName(data.metric.id)}_n_events, 0)) AS ${encodeMetricIdForColumnName(data.metric.id)}_n_events`
                    : ""
                }`;
            })
            .join("\n")}
        FROM __metricSourceData umj
        GROUP BY
          ${baseIdType}
      )
      ${
        eventQuantileData.length > 0
          ? `
      , __eventQuantileSketch AS (
        -- Pass 1 of two-pass KLL rank recovery: merge per-user sketches by
        -- variation+dimension. __eventQuantileMetric extracts the quantile grid
        -- (including q_hat) from these merged sketches; __joinedData then uses
        -- q_hat as the threshold for per-user rank recovery (pass 2).
        SELECT
          u.variation AS variation
          ${allDimensionCols.map((c) => `, u.${c.alias} AS ${c.alias}`).join("")}
          ${metricData
            .filter((d) => d.quantileMetric === "event")
            .map(
              (d) =>
                `, ${this.kllMergePartial(`m.${encodeMetricIdForColumnName(d.metric.id)}_value`)} AS ${d.alias}_sketch`,
            )
            .join("\n")}
        FROM __experimentUnits u
        INNER JOIN __metricDataAggregated m ON u.${baseIdType} = m.${baseIdType}
        GROUP BY
          u.variation
          ${allDimensionCols.map((c) => `, u.${c.alias}`).join("")}
      )
      , __eventQuantileMetric AS (
        SELECT
          variation
          ${allDimensionCols.map((c) => `, ${c.alias}`).join("")}
          ${metricData
            .filter((d) => d.quantileMetric === "event")
            .map((d) =>
              this.getKllQuantileGridColumns(
                d.metricQuantileSettings,
                `${d.alias}_sketch`,
                `${d.alias}_`,
              ),
            )
            .join("\n")}
        FROM __eventQuantileSketch
      )
      `
          : ""
      }
      , __joinedData AS (
          SELECT
            u.${baseIdType}
            ${allDimensionCols.map((d) => `, u.${d.alias} AS ${d.alias}`).join("")}
            , u.variation
            ${metricData
              .map((data) => {
                if (data.quantileMetric === "event") {
                  // Two-pass KLL rank recovery: __eventQuantileMetric provides
                  // the global q_hat per variation+dimension (pass 1). Here we
                  // extract a 100-point CDF from each user's merged sketch and
                  // count the fraction below q_hat to recover a per-user
                  // "count below threshold" with ±0.5% rank precision (pass 2).
                  // This preserves per-user variance in both event volume and
                  // fraction-below-threshold, so the cluster-adjusted variance
                  // estimator in QuantileClusteredStatistic is correct.
                  // Note: ignoreZeros for event quantiles is handled upstream in
                  // addCaseWhenTimeFilter (zeros are filtered out of __newMetricRows
                  // before sketching, so they never enter the KLL sketch or n_events).
                  const nEventsCol = `COALESCE(m.${encodeMetricIdForColumnName(data.metric.id)}_n_events, 0)`;
                  const sketchCol = `m.${encodeMetricIdForColumnName(data.metric.id)}_value`;
                  const thresholdCol = `qm.${data.alias}_quantile`;
                  return `, ${this.kllRankApprox(sketchCol, thresholdCol, nEventsCol, 100)} AS ${data.alias}_value
                  , ${nEventsCol} AS ${data.alias}_n_events`;
                }
                // Unit quantiles with ignoreZeros: reAggregationFunction already
                // returns NULLIF(..., 0) so _value is NULL for zero-sum users.
                // Preserve that NULL here (don't COALESCE) so approxQuantile
                // excludes them. For all other metrics COALESCE is correct — a
                // NULL from the LEFT JOIN means zero events for that user.
                const nullIfZero =
                  data.quantileMetric === "unit" &&
                  data.metricQuantileSettings.ignoreZeros;
                const valueCol = nullIfZero
                  ? `m.${encodeMetricIdForColumnName(data.metric.id)}_value`
                  : `COALESCE(m.${encodeMetricIdForColumnName(data.metric.id)}_value, 0)`;
                return `, ${data.aggregatedValueTransformation({
                  column: valueCol,
                  initialTimestampColumn: "u.first_exposure_timestamp",
                  analysisEndDate: params.settings.endDate,
                })} AS ${data.alias}_value ${
                  data.ratioMetric
                    ? `, ${data.aggregatedValueTransformation({
                        column: `COALESCE(m.${encodeMetricIdForColumnName(data.metric.id)}_denominator_value, 0)`,
                        initialTimestampColumn: "u.first_exposure_timestamp",
                        analysisEndDate: params.settings.endDate,
                      })} AS ${data.alias}_denominator`
                    : ""
                }`;
              })
              .join("\n")}
            ${
              regressionAdjustedMetrics.length > 0
                ? regressionAdjustedMetrics
                    .map(
                      (data) =>
                        `, c.${data.alias}_covariate_value AS ${data.alias}_covariate_value
                        ${
                          data.ratioMetric
                            ? `, c.${data.alias}_covariate_denominator AS ${data.alias}_covariate_denominator`
                            : ""
                        }`,
                    )
                    .join("\n")
                : ""
            }
          FROM __experimentUnits u
          LEFT JOIN __metricDataAggregated m ON u.${baseIdType} = m.${baseIdType}
          ${
            // TODO(incremental-refresh): GROUP BY is not necessary but is a failsafe
            // against bad insertions into covariate table
            regressionAdjustedMetrics.length > 0
              ? `LEFT JOIN (
                SELECT
                  ${baseIdType}
                  ${regressionAdjustedMetrics
                    .map(
                      (data) =>
                        `, MAX(${encodeMetricIdForColumnName(data.id)}_value) AS ${data.alias}_covariate_value
                        ${
                          data.ratioMetric
                            ? `, MAX(${encodeMetricIdForColumnName(data.id)}_denominator_value) AS ${data.alias}_covariate_denominator`
                            : ""
                        }`,
                    )
                    .join("\n")}
                FROM ${params.metricSourceCovariateTableFullName}
                GROUP BY ${baseIdType}
              ) c ON u.${baseIdType} = c.${baseIdType}`
              : ""
          }
          ${
            // Dimension-equality join mirrors the existing pattern at
            // getExperimentFactMetricStatisticsCTE (NULL = NULL → false is
            // acceptable; dimensions are COALESCEd to a sentinel upstream).
            eventQuantileData.length > 0
              ? `LEFT JOIN __eventQuantileMetric qm ON (
                  qm.variation = u.variation
                  ${allDimensionCols.map((c) => `AND qm.${c.alias} = u.${c.alias}`).join("\n")}
                )`
              : ""
          }
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
      ${this.getExperimentFactMetricStatisticsCTE({
        dimensionCols: allDimensionCols,
        metricData,
        eventQuantileData,
        baseIdType,
        joinedMetricTableName: "__joinedData",
        eventQuantileTableName: "__eventQuantileMetric",
        capValueTableName: "__capValue",
        factTablesWithIndices: [
          {
            factTable: factTableWithMetricData.factTable,
            index: 0,
          },
        ],
        percentileTableIndices,
      })}
      `,
      this.getFormatDialect(),
    );
  }

  async runIncrementalRefreshStatisticsQuery(
    sql: string,
    setExternalId: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<ExperimentFactMetricsQueryResponse> {
    const { rows, statistics } = await this.runQuery(
      sql,
      setExternalId,
      queryMetadata,
    );
    return {
      rows: this.processExperimentFactMetricsQueryRows(rows),
      statistics: statistics,
    };
  }

  getSampleUnitsCTE(): string {
    return getSampleUnitsCTE(this.getSqlHelpers());
  }

  getSqlHelpers(): SqlHelpers {
    return {
      dateTrunc: this.dateTrunc.bind(this),
      escapeStringLiteral: this.escapeStringLiteral.bind(this),
      jsonExtract: this.extractJSONField.bind(this),
      evalBoolean: this.evalBoolean.bind(this),
      percentileApprox: this.approxQuantile.bind(this),
      toTimestamp: this.toTimestamp.bind(this),
      formatDialect: this.getFormatDialect(),
      formatDateTimeString: this.formatDateTimeString.bind(this),
      castToFloat: this.ensureFloat.bind(this),
      castToString: this.castToString.bind(this),
      castToTimestamp: this.castToTimestamp.bind(this),
      castUserDateCol: this.castUserDateCol.bind(this),
      getCurrentTimestamp: this.getCurrentTimestamp.bind(this),
      ifElse: this.ifElse.bind(this),
      getDataType: this.getDataType.bind(this),
      addTime: this.addTime.bind(this),
      selectStarLimit: this.selectStarLimit.bind(this),
    };
  }

  getProductAnalyticsQuery(
    config: ExplorationConfig,
    {
      factTableMap,
      metricMap,
    }: {
      factTableMap: FactTableMap;
      metricMap: Map<string, FactMetricInterface>;
    },
  ): {
    sql: string;
    orderedMetricIds: string[];
    startDate: Date;
    endDate: Date;
  } {
    const sqlHelpers = this.getSqlHelpers();

    const dateRange = calculateProductAnalyticsDateRange(config.dateRange);

    const { sql, orderedMetricIds } = generateProductAnalyticsSQL(
      config,
      factTableMap,
      metricMap,
      sqlHelpers,
      this.datasource,
    );

    return {
      sql: compileSqlTemplate(sql, {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      }),
      orderedMetricIds,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    };
  }

  async runProductAnalyticsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ) {
    return this.runQuery(query, setExternalId, queryMetadata);
  }
}
