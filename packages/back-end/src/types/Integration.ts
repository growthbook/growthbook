import { ExperimentMetricInterface } from "shared/experiments";
import { FormatDialect, TemplateVariables } from "shared/types/sql";
import {
  AlterNewIncrementalUnitsQueryParams,
  AutoMetricTrackedEvent,
  ColumnTopValuesParams,
  ColumnTopValuesResponse,
  CreateExperimentIncrementalUnitsQueryParams,
  CreateMetricSourceCovariateTableQueryParams,
  CreateMetricSourceTableQueryParams,
  DimensionSlicesQueryParams,
  DimensionSlicesQueryResponse,
  DropMetricSourceCovariateTableQueryParams,
  DropOldIncrementalUnitsQueryParams,
  DropTableQueryParams,
  DropTableQueryResponse,
  ExperimentAggregateUnitsQueryParams,
  ExperimentAggregateUnitsQueryResponse,
  ExperimentFactMetricsQueryParams,
  ExperimentFactMetricsQueryResponse,
  ExperimentMetricQueryParams,
  ExperimentMetricQueryResponse,
  ExperimentQueryResponses,
  ExperimentUnitsQueryParams,
  ExperimentUnitsQueryResponse,
  ExternalIdCallback,
  FeatureUsageAggregateRow,
  FeatureUsageLookback,
  IncrementalRefreshStatisticsQueryParams,
  IncrementalWithNoOutputQueryResponse,
  InformationSchema,
  InsertMetricSourceCovariateDataQueryParams,
  InsertMetricSourceDataQueryParams,
  MaxTimestampIncrementalUnitsQueryParams,
  MaxTimestampMetricSourceQueryParams,
  MaxTimestampQueryResponse,
  MetricAnalysisParams,
  MetricAnalysisQueryResponse,
  MetricValueParams,
  MetricValueQueryResponse,
  PastExperimentParams,
  PastExperimentQueryResponse,
  PopulationFactMetricsQueryParams,
  PopulationMetricQueryParams,
  TestQueryParams,
  TestQueryResult,
  TrackedEventData,
  UpdateExperimentIncrementalUnitsQueryParams,
  UserExperimentExposuresQueryParams,
  UserExperimentExposuresQueryResponse,
} from "shared/types/integrations";
import {
  AutoFactTableSchemas,
  DataSourceInterface,
  DataSourceProperties,
  SchemaFormat,
} from "shared/types/datasource";
import { AdditionalQueryMetadata } from "shared/types/query";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { DimensionInterface } from "shared/types/dimension";
import { FactMetricInterface } from "shared/types/fact-table";
import { MetricInterface, MetricType } from "shared/types/metric";
import { ReqContext } from "back-end/types/request";

export type { MetricAnalysisParams };

export class MissingDatasourceParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingDatasourceParamsError";
  }
}

export class DataSourceNotSupportedError extends Error {
  constructor() {
    super("This data source is not supported yet.");
    this.name = "DataSourceNotSupportedError";
  }
}

export interface SourceIntegrationInterface {
  datasource: DataSourceInterface;
  context: ReqContext;
  additionalQueryMetadata?: AdditionalQueryMetadata;
  decryptionError: boolean;
  // eslint-disable-next-line
  params: any;
  setAdditionalQueryMetadata?(
    additionalQueryMetadata: AdditionalQueryMetadata,
  ): void;
  getSensitiveParamKeys(): string[];
  getExperimentResultsQuery(
    snapshotSettings: ExperimentSnapshotSettings,
    metricDocs: ExperimentMetricInterface[],
    activationMetricDoc: ExperimentMetricInterface | null,
    dimension: DimensionInterface | null,
  ): string;
  getFormatDialect?(): FormatDialect;
  getExperimentResults(
    snapshotSettings: ExperimentSnapshotSettings,
    metrics: ExperimentMetricInterface[],
    activationMetric: ExperimentMetricInterface | null,
    dimension: DimensionInterface | null,
  ): Promise<ExperimentQueryResponses>;
  getSourceProperties(): DataSourceProperties;
  testConnection(): Promise<boolean>;
  getTableData?(
    databaseName: string,
    tableSchema: string,
    tableName: string,
  ): Promise<{ tableData: null | unknown[] }>;
  getInformationSchema?(): Promise<InformationSchema[]>;
  getTestValidityQuery?(
    query: string,
    testDays?: number,
    templateVariables?: TemplateVariables,
  ): string;
  getTestQuery?(params: TestQueryParams): string;
  getFreeFormQuery?(query: string, limit?: number): string;
  runTestQuery?(
    sql: string,
    timestampCols?: string[],
  ): Promise<TestQueryResult>;
  getMetricAnalysisQuery(
    metric: FactMetricInterface,
    params: Omit<MetricAnalysisParams, "metric">,
  ): string;
  runMetricAnalysisQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<MetricAnalysisQueryResponse>;
  getDropUnitsTableQuery(params: DropTableQueryParams): string;
  runDropTableQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<DropTableQueryResponse>;
  getMetricValueQuery(params: MetricValueParams): string;
  getPopulationMetricQuery?(params: PopulationMetricQueryParams): string;
  getPopulationFactMetricsQuery?(
    params: PopulationFactMetricsQueryParams,
  ): string;
  getExperimentFactMetricsQuery?(
    params: ExperimentFactMetricsQueryParams,
  ): string;
  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string;
  getExperimentAggregateUnitsQuery(
    params: ExperimentAggregateUnitsQueryParams,
  ): string;
  getExperimentUnitsTableQuery(params: ExperimentUnitsQueryParams): string;
  getCreateExperimentIncrementalUnitsQuery(
    params: CreateExperimentIncrementalUnitsQueryParams,
  ): string;
  getUpdateExperimentIncrementalUnitsQuery(
    params: UpdateExperimentIncrementalUnitsQueryParams,
  ): string;
  getDropOldIncrementalUnitsQuery(
    params: DropOldIncrementalUnitsQueryParams,
  ): string;
  getAlterNewIncrementalUnitsQuery(
    params: AlterNewIncrementalUnitsQueryParams,
  ): string;
  getMaxTimestampIncrementalUnitsQuery(
    params: MaxTimestampIncrementalUnitsQueryParams,
  ): string;
  getMaxTimestampMetricSourceQuery(
    params: MaxTimestampMetricSourceQueryParams,
  ): string;
  getCreateMetricSourceTableQuery(
    params: CreateMetricSourceTableQueryParams,
  ): string;
  getInsertMetricSourceDataQuery(
    params: InsertMetricSourceDataQueryParams,
  ): string;
  getDropMetricSourceCovariateTableQuery(
    params: DropMetricSourceCovariateTableQueryParams,
  ): string;
  getCreateMetricSourceCovariateTableQuery(
    params: CreateMetricSourceCovariateTableQueryParams,
  ): string;
  getInsertMetricSourceCovariateDataQuery(
    params: InsertMetricSourceCovariateDataQueryParams,
  ): string;
  getIncrementalRefreshStatisticsQuery(
    params: IncrementalRefreshStatisticsQueryParams,
  ): string;
  runIncrementalWithNoOutputQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<IncrementalWithNoOutputQueryResponse>;
  runMaxTimestampQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<MaxTimestampQueryResponse>;
  runIncrementalRefreshStatisticsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentFactMetricsQueryResponse>;
  // Pipeline validation helpers
  getPipelineValidationInsertQuery?(params: { tableFullName: string }): string;
  getCurrentTimestamp(): string;
  getPastExperimentQuery(params: PastExperimentParams): string;
  getUserExperimentExposuresQuery(
    params: UserExperimentExposuresQueryParams,
  ): string;
  runUserExperimentExposuresQuery(
    query: string,
  ): Promise<UserExperimentExposuresQueryResponse>;
  getDimensionSlicesQuery(params: DimensionSlicesQueryParams): string;
  runDimensionSlicesQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<DimensionSlicesQueryResponse>;
  runMetricValueQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<MetricValueQueryResponse>;
  runPopulationMetricQuery?(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentMetricQueryResponse>;
  runPopulationFactMetricsQuery?(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentFactMetricsQueryResponse>;
  runExperimentMetricQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentMetricQueryResponse>;
  runExperimentFactMetricsQuery?(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentFactMetricsQueryResponse>;
  runExperimentAggregateUnitsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentAggregateUnitsQueryResponse>;
  runExperimentUnitsQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<ExperimentUnitsQueryResponse>;
  runPastExperimentQuery(
    query: string,
    setExternalId: ExternalIdCallback,
  ): Promise<PastExperimentQueryResponse>;
  runColumnTopValuesQuery?(sql: string): Promise<ColumnTopValuesResponse>;
  getColumnTopValuesQuery?: (params: ColumnTopValuesParams) => string;
  getEventsTrackedByDatasource?: (
    schemaFormat: AutoFactTableSchemas,
    schema?: string,
  ) => Promise<TrackedEventData[]>;
  getAutoMetricsToCreate?: (
    existingMetrics: MetricInterface[],
    schema: string,
  ) => Promise<AutoMetricTrackedEvent[]>;
  getAutoGeneratedMetricSqlQuery?(
    event: string,
    hasUserId: boolean,
    schemaFormat: SchemaFormat,
    type: MetricType,
  ): string;
  generateTablePath?(
    tableName: string,
    schema?: string,
    database?: string,
    requireSchema?: boolean,
  ): string;
  cancelQuery?(externalId: string): Promise<void>;
  getFeatureUsage?(
    feature: string,
    lookback: FeatureUsageLookback,
  ): Promise<{ start: number; rows: FeatureUsageAggregateRow[] }>;
}
