import { BigQueryTimestamp } from "@google-cloud/bigquery";
import {
  DataSourceProperties,
  DataSourceSettings,
  SchemaFormat,
} from "../../types/datasource";
import { DimensionInterface } from "../../types/dimension";
import { ExperimentSnapshotSettings } from "../../types/experiment-snapshot";
import { MetricInterface, MetricType } from "../../types/metric";
import { QueryStatistics } from "../../types/query";
import { SegmentInterface } from "../../types/segment";
import { FormatDialect } from "../util/sql";
import { TemplateVariables } from "../../types/sql";

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

export type MetricAggregationType = "pre" | "post" | "noWindow";

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
};
export type DateDimension = {
  type: "date";
};

export type DateCumulativeDimension = {
  type: "datecumulative";
};
export type DateDailyDimension = {
  type: "datedaily";
};
export type ActivationDimension = {
  type: "activation";
};
export type Dimension =
  | UserDimension
  | ExperimentDimension
  | DateDimension
  | DateCumulativeDimension
  | DateDailyDimension
  | ActivationDimension;

export type ExperimentMetricQueryParams = {
  settings: ExperimentSnapshotSettings;
  metric: MetricInterface;
  activationMetric: MetricInterface | null;
  denominatorMetrics: MetricInterface[];
  dimension: Dimension | null;
  segment: SegmentInterface | null;
  useUnitsTable: boolean;
  unitsTableFullName?: string;
};

export type ExperimentUnitsQueryParams = {
  settings: ExperimentSnapshotSettings;
  activationMetric: MetricInterface | null;
  dimension: Dimension | null;
  segment: SegmentInterface | null;
  unitsTableFullName?: string;
  includeIdJoins: boolean;
};

export type PastExperimentParams = {
  from: Date;
};

export type MetricValueParams = {
  from: Date;
  to: Date;
  metric: MetricInterface;
  name: string;
  segment?: SegmentInterface;
  includeByDate?: boolean;
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
  experiments: {
    exposureQueryId: string;
    experiment_id: string;
    experiment_name?: string;
    variation_id: string;
    variation_name?: string;
    start_date: Date;
    end_date: Date;
    users: number;
  }[];
};

export type TrackedEventResponseRow = {
  event: string;
  displayName: string;
  hasUserId: boolean;
  count: number;
  lastTrackedAt: Date | BigQueryTimestamp;
};

export type TrackedEventData = {
  event: string;
  displayName: string;
  hasUserId: boolean;
  count: number;
  lastTrackedAt: Date;
  metricsToCreate: {
    name: string;
    sql: string;
    type: MetricType;
    shouldCreate?: boolean;
    exists?: boolean;
  }[];
};

export type MetricValueQueryResponseRow = {
  date: string;
  count: number;
  main_sum: number;
  main_sum_squares: number;
};
export type MetricValueQueryResponseRows = MetricValueQueryResponseRow[];

export type PastExperimentResponseRows = {
  exposure_query: string;
  experiment_id: string;
  experiment_name?: string;
  variation_id: string;
  variation_name?: string;
  start_date: string;
  end_date: string;
  users: number;
}[];

export type ExperimentMetricQueryResponseRows = {
  dimension: string;
  variation: string;
  users: number;
  count: number;
  statistic_type: "ratio" | "mean" | "mean_ra";
  main_metric_type: MetricType;
  main_cap_value?: number;
  main_sum: number;
  main_sum_squares: number;
  denominator_metric_type?: MetricType;
  denominator_cap_value?: number;
  denominator_sum?: number;
  denominator_sum_squares?: number;
  main_denominator_sum_product?: number;
  covariate_metric_type?: MetricType;
  covariate_sum?: number;
  covariate_sum_squares?: number;
  main_covariate_sum_product?: number;
}[];

// eslint-disable-next-line
export type QueryResponse<Rows = Record<string, any>[]> = {
  rows: Rows;
  statistics?: QueryStatistics;
};

export type MetricValueQueryResponse = QueryResponse<MetricValueQueryResponseRows>;
export type PastExperimentQueryResponse = QueryResponse<PastExperimentResponseRows>;
export type ExperimentMetricQueryResponse = QueryResponse<ExperimentMetricQueryResponseRows>;
export type ExperimentUnitsQueryResponse = QueryResponse;

export interface SourceIntegrationConstructor {
  new (
    encryptedParams: string,
    settings: DataSourceSettings
  ): SourceIntegrationInterface;
}

export interface TestQueryRow {
  [key: string]: unknown;
}

export interface TestQueryResult {
  results: TestQueryRow[];
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
  path: string;
  id: string;
  numOfColumns: number;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface Schema {
  schemaName: string;
  tables: Table[];
  path?: string;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface InformationSchema {
  databaseName: string;
  path?: string;
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

export interface SourceIntegrationInterface {
  datasource: string;
  organization: string;
  type: string;
  settings: DataSourceSettings;
  decryptionError: boolean;
  // eslint-disable-next-line
  params: any;
  getSensitiveParamKeys(): string[];
  getExperimentResultsQuery(
    snapshotSettings: ExperimentSnapshotSettings,
    metrics: MetricInterface[],
    activationMetric: MetricInterface | null,
    dimension: DimensionInterface | null
  ): string;
  getFormatDialect?(): FormatDialect;
  getExperimentResults(
    snapshotSettings: ExperimentSnapshotSettings,
    metrics: MetricInterface[],
    activationMetric: MetricInterface | null,
    dimension: DimensionInterface | null
  ): Promise<ExperimentQueryResponses>;
  getSourceProperties(): DataSourceProperties;
  testConnection(): Promise<boolean>;
  getTableData?(
    databaseName: string,
    tableSchema: string,
    tableName: string
  ): Promise<{ tableData: null | unknown[] }>;
  getInformationSchema?(): Promise<InformationSchema[]>;
  getTestValidityQuery?(
    query: string,
    templateVariables?: TemplateVariables
  ): string;
  getTestQuery?(query: string, templateVariables?: TemplateVariables): string;
  runTestQuery?(sql: string): Promise<TestQueryResult>;
  getMetricValueQuery(params: MetricValueParams): string;
  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string;
  getExperimentUnitsTableQuery(params: ExperimentUnitsQueryParams): string;
  getPastExperimentQuery(params: PastExperimentParams): string;
  runMetricValueQuery(query: string): Promise<MetricValueQueryResponse>;
  runExperimentMetricQuery(
    query: string
  ): Promise<ExperimentMetricQueryResponse>;
  runExperimentUnitsQuery(query: string): Promise<ExperimentUnitsQueryResponse>;
  runPastExperimentQuery(query: string): Promise<PastExperimentQueryResponse>;
  getEventsTrackedByDatasource?: (
    schemaFormat: SchemaFormat,
    existingMetrics: MetricInterface[]
  ) => Promise<TrackedEventData[]>;
  getAutoGeneratedMetricSqlQuery?(
    event: string,
    hasUserId: boolean,
    schemaFormat: SchemaFormat,
    type: MetricType
  ): string;
  generateTablePath?(
    tableName: string,
    schema?: string,
    database?: string,
    requireSchema?: boolean
  ): string;
}
