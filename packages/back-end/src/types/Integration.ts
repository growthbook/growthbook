import {
  DataSourceProperties,
  DataSourceSettings,
} from "../../types/datasource";
import { DimensionInterface } from "../../types/dimension";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { MetricInterface, MetricStats } from "../../types/metric";
import { SegmentInterface } from "../../types/segment";

export type VariationMetricResult = MetricStats & {
  metric: string;
};

export type ExperimentResults = {
  dimensions: {
    dimension: string;
    variations: {
      variation: number;
      users: number;
      metrics: {
        [key: string]: MetricStats;
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
export type ActivationDimension = {
  type: "activation";
};
export type Dimension =
  | UserDimension
  | ExperimentDimension
  | DateDimension
  | ActivationDimension;

export type ExperimentMetricQueryParams = {
  experiment: ExperimentInterface;
  phase: ExperimentPhase;
  metric: MetricInterface;
  activationMetrics: MetricInterface[];
  denominatorMetrics: MetricInterface[];
  dimension: Dimension | null;
  segment: SegmentInterface | null;
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

export type MetricValueQueryResponseRow = {
  date: string;
  count: number;
  mean: number;
  stddev: number;
};
export type MetricValueQueryResponse = MetricValueQueryResponseRow[];
export type PastExperimentResponse = {
  exposure_query: string;
  experiment_id: string;
  experiment_name?: string;
  variation_id: string;
  variation_name?: string;
  start_date: string;
  end_date: string;
  users: number;
}[];
export type ExperimentMetricQueryResponse = {
  dimension: string;
  variation: string;
  users: number;
  count: number;
  mean: number;
  stddev: number;
}[];

type SuccessfulTestQueryResult = {
  anonymous_id: string;
  timestamp: Date;
  experiment_id: string;
  variation_id: string;
  browser: string;
  country: string;
};

export interface SourceIntegrationConstructor {
  new (
    encryptedParams: string,
    settings: DataSourceSettings
  ): SourceIntegrationInterface;
}

export interface SourceIntegrationInterface {
  datasource: string;
  organization: string;
  settings: DataSourceSettings;
  // eslint-disable-next-line
  params: any;
  getSensitiveParamKeys(): string[];
  getExperimentResultsQuery(
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[],
    activationMetric: MetricInterface | null,
    dimension: DimensionInterface | null
  ): string;
  getExperimentResults(
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[],
    activationMetric: MetricInterface | null,
    dimension: DimensionInterface | null
  ): Promise<ExperimentQueryResponses>;
  testConnection(): Promise<boolean>;
  testQuery?(query: string): Promise<SuccessfulTestQueryResult[] | null>;
  getSourceProperties(): DataSourceProperties;
  getMetricValueQuery(params: MetricValueParams): string;
  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string;
  getPastExperimentQuery(params: PastExperimentParams): string;
  runMetricValueQuery(query: string): Promise<MetricValueQueryResponse>;
  runExperimentMetricQuery(
    query: string
  ): Promise<ExperimentMetricQueryResponse>;
  runPastExperimentQuery(query: string): Promise<PastExperimentResponse>;
}
