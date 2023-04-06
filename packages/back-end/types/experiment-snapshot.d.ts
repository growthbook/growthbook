import { QueryLanguage } from "./datasource";
import { MetricStats } from "./metric";
import { StatsEngine } from "./stats";
import { Queries } from "./query";
import { MetricRegressionAdjustmentStatus } from "./report";

export interface SnapshotMetric {
  value: number;
  cr: number;
  users: number;
  denominator?: number;
  ci?: [number, number];
  expected?: number;
  risk?: [number, number];
  stats?: MetricStats;
  pValue?: number;
  uplift?: {
    dist: string;
    mean?: number;
    stddev?: number;
  };
  buckets?: {
    x: number;
    y: number;
  }[];
  chanceToWin?: number;
}

export interface SnapshotVariation {
  users: number;
  metrics: {
    [key: string]: SnapshotMetric;
  };
}

export interface ExperimentSnapshotSettings {
  statsEngine: StatsEngine;
  regressionAdjustmentEnabled: boolean;
  metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[];
  sequentialTestingEnabled: boolean;
  sequentialTestingTuningParameter: number;
}

export interface ExperimentSnapshotInterface {
  id: string;
  organization: string;
  experiment: string;
  error?: string;
  phase: number;
  dateCreated: Date;
  runStarted: Date | null;
  manual: boolean;
  query?: string;
  queryLanguage?: QueryLanguage;
  queries: Queries;
  dimension: string | null;
  unknownVariations?: string[];
  multipleExposures?: number;
  hasCorrectedStats?: boolean;
  results?: {
    name: string;
    srm: number;
    variations: SnapshotVariation[];
  }[];
  hasRawQueries?: boolean;
  queryFilter?: string;
  segment?: string;
  activationMetric?: string;
  skipPartialData?: boolean;
  statsEngine?: StatsEngine;
  regressionAdjustmentEnabled?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  sequentialTestingEnabled?: boolean;
  sequentialTestingTuningParameter?: number;
}
