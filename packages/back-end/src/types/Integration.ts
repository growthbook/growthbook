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
export interface VariationResult {
  variation: number;
  users: number;
  metrics: VariationMetricResult[];
}

export interface DimensionResult {
  dimension: string;
  variations: VariationResult[];
}

export interface ExperimentResults {
  query: string;
  results: DimensionResult[];
}

export interface ImpactEstimationResult {
  query: string;
  metricTotal: number;
  users: number;
  value: number;
}
export type UsersQueryParams = {
  name: string;
  userIdType: "anonymous" | "user" | "either";
  segmentQuery?: string;
  segmentName?: string;
  urlRegex?: string;
  from: Date;
  to: Date;
  conversionWindow: number;
  includeByDate?: boolean;
};
export type UsersResult = {
  users: number;
  dates?: {
    date: string;
    users: number;
  }[];
};
export type MetricValueParams = {
  from: Date;
  to: Date;
  metric: MetricInterface;
  name?: string;
  userIdType?: "anonymous" | "user" | "either";
  segmentQuery?: string;
  segmentName?: string;
  urlRegex?: string;
  conversionWindow?: number;
  includeByDate?: boolean;
  includePercentiles?: boolean;
};

export type MetricValueResultDate = {
  date: string;
  count?: number;
  mean?: number;
  stddev?: number;
};

export type MetricValueResult = {
  count?: number;
  stddev?: number;
  mean?: number;
  percentiles?: {
    [key: string]: number;
  };
  dates?: MetricValueResultDate[];
};

export type PastExperimentResult = {
  experiments: {
    experiment_id: string;
    variation_id: string;
    start_date: Date;
    end_date: Date;
    users: number;
  }[];
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
  // eslint-disable-next-line
  getNonSensitiveParams(): any;
  getExperimentResults(
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[],
    activationMetric: MetricInterface | null,
    dimension: DimensionInterface | null
  ): Promise<ExperimentResults>;
  testConnection(): Promise<boolean>;
  getSourceProperties(): DataSourceProperties;
  getImpactEstimation(
    urlRegex: string,
    metric: MetricInterface,
    segment?: SegmentInterface
  ): Promise<ImpactEstimationResult>;
  getUsersQuery(params: UsersQueryParams): string;
  getMetricValueQuery(params: MetricValueParams): string;
  runUsersQuery(query: string): Promise<UsersResult>;
  runMetricValueQuery(query: string): Promise<MetricValueResult>;
  getPastExperimentQuery(from: Date): string;
  runPastExperimentQuery(query: string): Promise<PastExperimentResult>;
}
