import { BigQueryTimestamp } from "@google-cloud/bigquery";
import { ExperimentMetricInterface } from "shared/experiments";
import { MetricAnalysisSettings } from "shared/types/metric-analysis";
import { DimensionInterface } from "shared/types/dimension";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { MetricInterface, MetricType } from "shared/types/metric";
import { QueryStatistics } from "shared/types/query";
import {
  FactTableMap,
  ColumnInterface,
  FactMetricInterface,
  FactTableColumnType,
  FactTableInterface,
  MetricQuantileSettings,
} from "shared/types/fact-table";
import type { PopulationDataQuerySettings } from "shared/types/query";
import { SegmentInterface } from "shared/types/segment";
import { TemplateVariables } from "shared/types/sql";

export interface PipelineIntegration {
  getExperimentUnitsTableQueryFromCte(
    tableFullName: string,
    cte: string,
  ): string;
  getSampleUnitsCTE(): string;
  getPipelineValidationInsertQuery(params: { tableFullName: string }): string;
  getDropUnitsTableQuery(params: { fullTablePath: string }): string;
}

export type ExternalIdCallback = (id: string) => Promise<void>;

export type DataType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "date"
  | "timestamp"
  | "hll";

export type MetricAggregationType = "pre" | "post" | "noWindow";

export type FactMetricAggregationType =
  | "sum"
  | "count"
  | "countDistinctHLL"
  | "max"
  | "eventQuantile"
  | "unitQuantileIgnoreZeros"
  | "unitQuantile"
  | "binomial"
  | "binomialAggregateFilter"
  | "userCountAggregateFilter";

export type FactMetricAggregationMetadata = {
  // Every metric can be partially aggregated (e.g. per user-date) to `intermediateDataType`
  // to be stored in the experimenter's warehouse where it can later be re-aggregated
  // to produce the final metric value.
  intermediateDataType: DataType;

  // Takes the processed column from the fact table (e.g. 1 for binomial, or `column`
  // for a selected column) and produces a partially aggregated value that can be
  // stored at the user-date level as intermediateDataType.
  partialAggregationFunction: (column: string) => string;

  // Takes the partially aggregated value and re-aggregates it to the user level
  // for producing the final metric value. This should produce a value of type
  // `finalDataType`, but is returned directly to the back-end, not stored in
  // the experimenter's warehouse.
  reAggregationFunction: (column: string, quantileColumn?: string) => string;

  // Data type of the final value produced by the fullAggregationFunction and reAggregationFunction
  finalDataType: DataType;

  // Takes the processed column from the fact table and produces the final metric value
  // directly and is only used for CUPED metrics in the incremental refresh pipeline.
  fullAggregationFunction: (column: string, quantileColumn?: string) => string;
};

// "exposure" builds a window before the first exposure date for the user
// "phaseStart" builds a window before the phase start date for all users
export type CovariateWindowType = "firstExposure" | "phaseStart";

export type CovariatePhaseStartSettings = {
  covariateStartDate: Date;
  covariateEndDate: Date;
};

export type CovariateFirstExposureSettings = {
  hours: number;
  minDelay: number;
  alias: string;
};

/**
 * Transformation function applied to aggregated metric values at the user level.
 * For most metrics, this is an identity function that returns the column unchanged.
 * For dailyParticipation metrics, this divides by the participation window to
 * produce a participation rate.
 */
export type AggregatedValueTransformation = ({
  column,
  initialTimestampColumn,
  analysisEndDate,
}: {
  column: string;
  initialTimestampColumn: string;
  analysisEndDate: Date;
}) => string;

export type FactMetricData = {
  alias: string;
  id: string;
  metric: FactMetricInterface;
  metricIndex: number;
  ratioMetric: boolean;
  funnelMetric: boolean;
  quantileMetric: "" | MetricQuantileSettings["type"];
  metricQuantileSettings: MetricQuantileSettings;
  regressionAdjusted: boolean;
  regressionAdjustmentHours: number;
  overrideConversionWindows: boolean;
  isPercentileCapped: boolean;
  computeUncappedMetric: boolean;
  numeratorSourceIndex: number;
  denominatorSourceIndex: number;
  capCoalesceMetric: string;
  capCoalesceDenominator: string;
  capCoalesceCovariate: string;
  capCoalesceDenominatorCovariate: string;
  numeratorAggFns: FactMetricAggregationMetadata;
  denominatorAggFns: FactMetricAggregationMetadata;
  covariateNumeratorAggFns: FactMetricAggregationMetadata;
  covariateDenominatorAggFns: FactMetricAggregationMetadata;
  uncappedCoalesceMetric: string;
  uncappedCoalesceDenominator: string;
  uncappedCoalesceCovariate: string;
  uncappedCoalesceDenominatorCovariate: string;
  minMetricDelay: number;
  raMetricFirstExposureSettings: CovariateFirstExposureSettings;
  raMetricPhaseStartSettings: CovariatePhaseStartSettings;
  metricStart: Date;
  metricEnd: Date | null;
  maxHoursToConvert: number;
  // Transformation applied to aggregated values at the user level
  aggregatedValueTransformation: AggregatedValueTransformation;
};

export type FactMetricSourceData = {
  factTable: FactTableInterface;
  index: number;
  metricData: FactMetricData[];
  percentileData: FactMetricPercentileData[];
  eventQuantileData: FactMetricQuantileData[];
  regressionAdjustedMetrics: FactMetricData[];
  minCovariateStartDate: Date;
  maxCovariateEndDate: Date;
  metricStart: Date;
  metricEnd: Date;
  maxHoursToConvert: number;
  activationMetric: ExperimentMetricInterface | null;
  bindingLastMaxTimestamp: boolean;
};

export type FactMetricQuantileData = {
  alias: string;
  valueCol: string;
  outputCol: string;
  metricQuantileSettings: MetricQuantileSettings;
};

export type FactMetricPercentileData = {
  valueCol: string;
  outputCol: string;
  percentile: number;
  ignoreZeros: boolean;
  sourceIndex: number;
};

export type BanditMetricData = Pick<
  FactMetricData,
  | "alias"
  | "id"
  | "ratioMetric"
  | "regressionAdjusted"
  | "isPercentileCapped"
  | "capCoalesceMetric"
  | "capCoalesceDenominator"
  | "capCoalesceCovariate"
  | "numeratorSourceIndex"
  | "denominatorSourceIndex"
>;

export type VariationPeriodWeight = {
  variationId: string;
  date: Date;
  weight: number;
};

export interface ExperimentMetricStats {
  metric_type: MetricType;
  count: number;
  main_sum: number;
  main_sum_squares: number;
}

export type VariationMetricResult = ExperimentMetricStats & {
  metric: string;
};

export type ExperimentResults = {
  dimensions: {
    dimension: string;
    variations: {
      variation: number;
      users: number;
      metrics: {
        [key: string]: ExperimentMetricStats;
      };
    }[];
  }[];
  unknownVariations: string[];
  multipleExposures?: number;
};

export type ExperimentQueryResponses = {
  dimension: string;
  variation: string;
  users: number;
  metrics: VariationMetricResult[];
}[];

export type UserDimension = {
  type: "user";
  dimension: DimensionInterface;
};
export type ExperimentDimension = {
  type: "experiment";
  id: string;
  specifiedSlices?: string[];
};

export type ExperimentDimensionWithSpecifiedSlices = Omit<
  ExperimentDimension,
  "specifiedSlices"
> & {
  specifiedSlices: string[];
};
export type DateDimension = {
  type: "date";
};
export type ActivationDimension = {
  type: "activation";
};
export type Dimension =
  | UserDimension
  | ExperimentDimension
  | DateDimension
  | ActivationDimension;

export type ProcessedDimensions = {
  unitDimensions: UserDimension[];
  experimentDimensions: ExperimentDimension[];
  activationDimension: ActivationDimension | null;
  dateDimension: DateDimension | null;
};

export interface DropTableQueryParams {
  fullTablePath: string;
}

export type TestQueryParams = {
  query: string;
  templateVariables?: TemplateVariables;
  testDays?: number;
  limit?: number;
};

export type ColumnTopValuesParams = {
  factTable: Pick<FactTableInterface, "sql" | "eventName">;
  columns: ColumnInterface[];
  limit?: number;
  lookbackDays?: number;
};
export type ColumnTopValuesResponseRow = {
  column: string;
  value: string;
  count: number;
};

interface ExperimentBaseQueryParams {
  settings: ExperimentSnapshotSettings;
  activationMetric: ExperimentMetricInterface | null;
  factTableMap: FactTableMap;
  dimensions: Dimension[];
  segment: SegmentInterface | null;
  unitsTableFullName?: string;
}

export interface ExperimentUnitsQueryParams extends ExperimentBaseQueryParams {
  includeIdJoins: boolean;
}

export interface CreateExperimentIncrementalUnitsQueryParams {
  settings: ExperimentSnapshotSettings;
  activationMetric: ExperimentMetricInterface | null;
  dimensions: Dimension[];
  factTableMap: FactTableMap;
  unitsTableFullName: string;
}

export interface UpdateExperimentIncrementalUnitsQueryParams
  extends CreateExperimentIncrementalUnitsQueryParams {
  segment: SegmentInterface | null;
  incrementalRefreshStartTime: Date;
  lastMaxTimestamp: Date | null;
  unitsTempTableFullName: string;
}

export interface DropOldIncrementalUnitsQueryParams {
  unitsTableFullName: string;
}

export interface AlterNewIncrementalUnitsQueryParams {
  unitsTableName: string;
  unitsTempTableFullName: string;
}

export interface MaxTimestampIncrementalUnitsQueryParams {
  unitsTableFullName: string;
  lastMaxTimestamp: Date | null;
}

export interface MaxTimestampMetricSourceQueryParams {
  metricSourceTableFullName: string;
  lastMaxTimestamp: Date | null;
}

export interface CreateMetricSourceTableQueryParams {
  settings: ExperimentSnapshotSettings;
  metrics: FactMetricInterface[];
  factTableMap: FactTableMap;
  metricSourceTableFullName: string;
}

export interface InsertMetricSourceDataQueryParams {
  settings: ExperimentSnapshotSettings;
  activationMetric: ExperimentMetricInterface | null;
  factTableMap: FactTableMap;
  metricSourceTableFullName: string;
  unitsSourceTableFullName: string;
  metrics: FactMetricInterface[];
  lastMaxTimestamp: Date | null;
}

export interface DropMetricSourceCovariateTableQueryParams {
  metricSourceCovariateTableFullName: string;
}

export interface CreateMetricSourceCovariateTableQueryParams {
  settings: ExperimentSnapshotSettings;
  metrics: FactMetricInterface[];
  metricSourceCovariateTableFullName: string;
}

export interface InsertMetricSourceCovariateDataQueryParams {
  settings: ExperimentSnapshotSettings;
  activationMetric: ExperimentMetricInterface | null;
  factTableMap: FactTableMap;
  metricSourceCovariateTableFullName: string;
  unitsSourceTableFullName: string;
  metrics: FactMetricInterface[];
  lastCovariateSuccessfulMaxTimestamp: Date | null;
}

export interface IncrementalRefreshStatisticsQueryParams {
  settings: ExperimentSnapshotSettings;
  activationMetric: ExperimentMetricInterface | null;
  dimensionsForPrecomputation: ExperimentDimensionWithSpecifiedSlices[];
  dimensionsForAnalysis: Dimension[];
  factTableMap: FactTableMap;
  metricSourceTableFullName: string;
  metricSourceCovariateTableFullName: string | null;
  unitsSourceTableFullName: string;
  metrics: FactMetricInterface[];
  lastMaxTimestamp: Date | null;
}

type UnitsSource = "exposureQuery" | "exposureTable" | "otherQuery";
export interface ExperimentMetricQueryParams extends ExperimentBaseQueryParams {
  metric: MetricInterface;
  denominatorMetrics: MetricInterface[];
  unitsSource: UnitsSource;
  unitsSql?: string;
  forcedUserIdType?: string;
}

export interface ExperimentFactMetricsQueryParams
  extends ExperimentBaseQueryParams {
  metrics: FactMetricInterface[];
  unitsSource: UnitsSource;
  unitsSql?: string;
  forcedUserIdType?: string;
}

export interface PopulationBaseQueryParams {
  populationSettings: PopulationDataQuerySettings;
  factTableMap: FactTableMap;
  segment: SegmentInterface | null;
}
export interface PopulationMetricQueryParams
  extends ExperimentMetricQueryParams,
    PopulationBaseQueryParams {}
export interface PopulationFactMetricsQueryParams
  extends ExperimentFactMetricsQueryParams,
    PopulationBaseQueryParams {}

export interface ExperimentAggregateUnitsQueryParams
  extends Omit<ExperimentBaseQueryParams, "dimensions"> {
  dimensions: ExperimentDimensionWithSpecifiedSlices[];
  useUnitsTable: boolean;
}

export type DimensionSlicesQueryParams = {
  exposureQueryId: string;
  dimensions: ExperimentDimension[];
  lookbackDays: number;
};

export type UserExperimentExposuresQueryParams = {
  userIdType: string;
  unitId: string;
  lookbackDays: number;
};

export type FeatureEvalDiagnosticsQueryParams = {
  feature: string;
};

export type PastExperimentParams = {
  from: Date;
  forceRefresh?: boolean;
};

export type MetricValueParams = {
  from: Date;
  to: Date;
  metric: MetricInterface;
  name: string;
  factTableMap: FactTableMap;
  segment?: SegmentInterface;
  includeByDate?: boolean;
};

export type MetricAnalysisParams = {
  settings: MetricAnalysisSettings;
  metric: FactMetricInterface;
  factTableMap: FactTableMap;
  segment: SegmentInterface | null;
};

export type ProductAnalyticsExplorationParams = {
  factTableMap: FactTableMap;
  factMetricMap: Map<string, FactMetricInterface>;
};

export type DimensionColumnData = {
  // the column or expression coming from the units table
  value: string;
  // the final alias for analysis in the rest of the SQL query
  alias: string;
};

export type MetricValueResultDate = {
  date: string;
  count: number;
  mean: number;
  stddev: number;
};

export type MetricValueResult = {
  count: number;
  stddev: number;
  mean: number;
  dates?: MetricValueResultDate[];
};

export type PastExperimentResult = {
  mergeResults: boolean;
  experiments: {
    exposureQueryId: string;
    experiment_id: string;
    experiment_name?: string;
    variation_id: string;
    variation_name?: string;
    start_date: Date;
    end_date: Date;
    users: number;
    latest_data: Date;
    start_of_range: boolean;
  }[];
};

// NOTE: response rows must all be lower case to work across SQL integrations
export type TrackedEventResponseRow = {
  event: string;
  display_name: string;
  has_user_id: boolean;
  count: number;
  last_tracked_at: Date | BigQueryTimestamp;
};

export interface TrackedEventData {
  eventName: string;
  displayName: string;
  hasUserId: boolean;
  count: number;
  lastTrackedAt: Date;
}

export type AutoMetricToCreate = {
  name: string;
  sql: string;
  type: MetricType;
  shouldCreate: boolean;
  alreadyExists: boolean;
  userIdTypes: string[];
};

export interface AutoMetricTrackedEvent extends TrackedEventData {
  metricsToCreate: AutoMetricToCreate[];
}

export type MetricValueQueryResponseRow = {
  date: string;
  count: number;
  main_sum: number;
  main_sum_squares: number;
};

export type MetricValueQueryResponseRows = MetricValueQueryResponseRow[];

export type MetricAnalysisQueryResponseRow = {
  date: string;
  data_type: string;
  capped: boolean;
  units: number;
  main_sum: number;
  main_sum_squares: number;
  denominator_sum?: number;
  denominator_sum_squares?: number;
  main_denominator_sum_product?: number;

  value_min?: number;
  value_max?: number;
  bin_width?: number;
  units_bin_0?: number;
  units_bin_1?: number;
  units_bin_2?: number;
  units_bin_3?: number;
  units_bin_4?: number;
  units_bin_5?: number;
  units_bin_6?: number;
  units_bin_7?: number;
  units_bin_8?: number;
  units_bin_9?: number;
  units_bin_10?: number;
  units_bin_11?: number;
  units_bin_12?: number;
  units_bin_13?: number;
  units_bin_14?: number;
  units_bin_15?: number;
  units_bin_16?: number;
  units_bin_17?: number;
  units_bin_18?: number;
  units_bin_19?: number;
  units_bin_20?: number;
  units_bin_21?: number;
  units_bin_22?: number;
  units_bin_23?: number;
  units_bin_24?: number;
};

export type MetricAnalysisQueryResponseRows = MetricAnalysisQueryResponseRow[];

export type PastExperimentResponseRows = {
  exposure_query: string;
  experiment_id: string;
  experiment_name?: string;
  variation_id: string;
  variation_name?: string;
  start_date: string;
  end_date: string;
  users: number;
  latest_data: string;
}[];

export type ExperimentMetricQueryResponseRows = {
  variation: string;
  users: number;
  count: number;
  main_cap_value?: number;
  main_sum: number;
  main_sum_squares: number;
  denominator_cap_value?: number;
  denominator_sum?: number;
  denominator_sum_squares?: number;
  main_denominator_sum_product?: number;
  covariate_sum?: number;
  covariate_sum_squares?: number;
  main_covariate_sum_product?: number;

  theta?: number; // for bandits only

  quantile?: number;
  quantile_n?: number;
  quantile_lower?: number;
  quantile_upper?: number;
  quantile_nstar?: number;

  // This is used to store dimensions of unknown keys (e.g. dim_exp_country)
  [key: string]: number | string | undefined;
}[];

export type ExperimentFactMetricsQueryResponseRows = {
  variation: string;
  users: number;
  count: number;
  [key: string]: number | string;
}[];

export type ExperimentAggregateUnitsQueryResponseRows = {
  variation: string;
  dimension_value: string;
  dimension_name: string;
  units: number;
}[];

export type DimensionSlicesQueryResponseRows = {
  dimension_value: string;
  dimension_name: string;
  units: number;
  total_units: number;
}[];

export type MaxTimestampQueryResponseRow = {
  max_timestamp: string;
};

export type UserExperimentExposuresQueryResponseRows = {
  timestamp: string;
  experiment_id: string;
  variation_id: string;
  [key: string]: string | null;
}[];

export type FeatureEvalDiagnosticsQueryResponseRows = {
  timestamp: string;
  feature_key: string;
  [key: string]: unknown;
}[];

export type QueryResponseColumnData = {
  name: string;
  dataType?: FactTableColumnType;
  fields?: QueryResponseColumnData[];
};

// eslint-disable-next-line
export type QueryResponse<Rows = Record<string, any>[]> = {
  rows: Rows;
  columns?: QueryResponseColumnData[];
  statistics?: QueryStatistics;
};

export type MetricValueQueryResponse =
  QueryResponse<MetricValueQueryResponseRows>;
export type MetricAnalysisQueryResponse =
  QueryResponse<MetricAnalysisQueryResponseRows>;
export type PastExperimentQueryResponse =
  QueryResponse<PastExperimentResponseRows>;
export type ExperimentMetricQueryResponse =
  QueryResponse<ExperimentMetricQueryResponseRows>;
export type ExperimentFactMetricsQueryResponse =
  QueryResponse<ExperimentFactMetricsQueryResponseRows>;
export type ExperimentUnitsQueryResponse = QueryResponse;
export type ExperimentAggregateUnitsQueryResponse =
  QueryResponse<ExperimentAggregateUnitsQueryResponseRows>;
export type DimensionSlicesQueryResponse =
  QueryResponse<DimensionSlicesQueryResponseRows>;
export type DropTableQueryResponse = QueryResponse;
export type IncrementalWithNoOutputQueryResponse = QueryResponse;
export type MaxTimestampQueryResponse = QueryResponse<
  MaxTimestampQueryResponseRow[]
>;

export type ColumnTopValuesResponse = QueryResponse<
  ColumnTopValuesResponseRow[]
>;
export type UserExperimentExposuresQueryResponse =
  QueryResponse<UserExperimentExposuresQueryResponseRows> & {
    truncated?: boolean;
  };
export type FeatureEvalDiagnosticsQueryResponse =
  QueryResponse<FeatureEvalDiagnosticsQueryResponseRows> & {
    truncated?: boolean;
  };

export interface TestQueryRow {
  [key: string]: unknown;
}

export interface TestQueryResult {
  results: TestQueryRow[];
  columns?: QueryResponseColumnData[];
  duration: number;
}

export interface RawInformationSchema {
  table_name: string;
  table_catalog: string;
  table_schema: string;
  column_count: string;
}

export interface Column {
  columnName: string;
  path?: string;
  dataType: string;
}

export interface Table {
  tableName: string;
  id: string;
  numOfColumns: number;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface Schema {
  schemaName: string;
  tables: Table[];
  dateCreated: Date;
  dateUpdated: Date;
}

export interface InformationSchema {
  databaseName: string;
  schemas: Schema[];
  dateCreated: Date;
  dateUpdated: Date;
}

export interface InformationSchemaError {
  errorType: "generic" | "not_supported" | "missing_params";
  message: string;
}

export interface InformationSchemaInterface {
  id: string;
  datasourceId: string;
  databases: InformationSchema[];
  organization: string;
  status: "PENDING" | "COMPLETE";
  refreshMS: number;
  error?: InformationSchemaError | null;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface InformationSchemaTablesInterface {
  id: string;
  datasourceId: string;
  organization: string;
  tableName: string;
  tableSchema: string;
  databaseName: string;
  columns: Column[];
  refreshMS: number;
  dateCreated: Date;
  dateUpdated: Date;
  informationSchemaId: string;
}

// Extended types that include path properties
export interface TableWithPath extends Table {
  path: string;
}

export interface SchemaWithPath extends Omit<Schema, "tables"> {
  path: string;
  tables: TableWithPath[];
}

export interface InformationSchemaWithPath
  extends Omit<InformationSchema, "schemas"> {
  path: string;
  schemas: SchemaWithPath[];
}

export interface InformationSchemaInterfaceWithPaths
  extends Omit<InformationSchemaInterface, "databases"> {
  databases: InformationSchemaWithPath[];
}

export interface InsertTrackEventProps {
  event_name: string;
  value?: number;
  properties?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

export interface InsertFeatureUsageProps {
  feature: string;
  env: string;
  revision: string;
  value: string;
  source: string;
  ruleId: string;
  variationId: string;
}

export interface FeatureUsageAggregateRow {
  timestamp: Date;
  environment: string;
  value: string;
  source: string;
  revision: string;
  ruleId: string;
  variationId: string;
  evaluations: number;
}
export type FeatureUsageLookback = "15minute" | "hour" | "day" | "week";
