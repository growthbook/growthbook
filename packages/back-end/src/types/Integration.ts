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
};

export type ExperimentQueryResponses = {
  dimension: string;
  variation: string;
  users: number;
  metrics: VariationMetricResult[];
}[];

export interface ExperimentUsersResult {
  dimensions: {
    dimension: string;
    variations: {
      variation: number;
      users: number;
    }[];
  }[];
  unknownVariations: string[];
}
export interface ExperimentMetricResult {
  dimensions: {
    dimension: string;
    variations: {
      variation: number;
      stats: MetricStats;
    }[];
  }[];
}

export interface ImpactEstimationResult {
  query: string;
  metricTotal: number;
  users: number;
  value: number;
}

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
export type Dimension = UserDimension | ExperimentDimension | DateDimension;

export type ExperimentUsersQueryParams = {
  experiment: ExperimentInterface;
  phase: ExperimentPhase;
  activationMetric: MetricInterface | null;
  dimension: Dimension | null;
};

export type ExperimentMetricQueryParams = {
  experiment: ExperimentInterface;
  phase: ExperimentPhase;
  metric: MetricInterface;
  activationMetric: MetricInterface | null;
  dimension: Dimension | null;
};

export type PastExperimentParams = {
  from: Date;
  minLength?: number;
};

export type UsersQueryParams = {
  name: string;
  userIdType: "anonymous" | "user" | "either";
  segmentQuery?: string;
  segmentName?: string;
  urlRegex?: string;
  from: Date;
  to: Date;
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
  name: string;
  userIdType?: "anonymous" | "user" | "either";
  segmentQuery?: string;
  segmentName?: string;
  urlRegex?: string;
  includeByDate?: boolean;
  includePercentiles?: boolean;
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

export type UsersQueryResponse = {
  date: string;
  users: number;
}[];
export type MetricValueQueryResponseRow = {
  date: string;
  count: number;
  mean: number;
  stddev: number;
  // eslint-disable-next-line
  [percentile: string]: any;
};
export type MetricValueQueryResponse = MetricValueQueryResponseRow[];
export type PastExperimentResponse = {
  experiment_id: string;
  variation_id: string;
  start_date: string;
  end_date: string;
  users: number;
}[];
export type ExperimentUsersQueryResponse = {
  dimension: string;
  variation: string;
  users: number;
}[];
export type ExperimentMetricQueryResponse = {
  dimension: string;
  variation: string;
  count: number;
  mean: number;
  stddev: number;
}[];

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
  getSourceProperties(): DataSourceProperties;
  getImpactEstimation(
    urlRegex: string,
    metric: MetricInterface,
    segment?: SegmentInterface
  ): Promise<ImpactEstimationResult>;
  getUsersQuery(params: UsersQueryParams): string;
  getMetricValueQuery(params: MetricValueParams): string;
  getExperimentUsersQuery(params: ExperimentUsersQueryParams): string;
  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string;
  getPastExperimentQuery(params: PastExperimentParams): string;
  runUsersQuery(query: string): Promise<UsersQueryResponse>;
  runMetricValueQuery(query: string): Promise<MetricValueQueryResponse>;
  runExperimentUsersQuery(query: string): Promise<ExperimentUsersQueryResponse>;
  runExperimentMetricQuery(
    query: string
  ): Promise<ExperimentMetricQueryResponse>;
  runPastExperimentQuery(query: string): Promise<PastExperimentResponse>;
}
