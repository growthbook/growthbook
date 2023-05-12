import { QueryLanguage } from "./datasource";
import { MetricInterface, MetricStats } from "./metric";
import { StatsEngine } from "./stats";
import { Queries } from "./query";
import {
  ExperimentReportResultDimension,
  MetricRegressionAdjustmentStatus,
} from "./report";
import { DimensionInterface } from "./dimension";

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
  pValueAdjusted?: number;
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

export type LegacyExperimentSnapshotInterface = ExperimentSnapshotInterface & {
  activationMetric?: string;
  statsEngine?: StatsEngine;
  hasRawQueries?: boolean;
  hasCorrectedStats?: boolean;
  results?: ExperimentReportResultDimension[];
  regressionAdjustmentEnabled?: boolean;
  metricRegressionAdjustmentStatuses?: MetricRegressionAdjustmentStatus[];
  sequentialTestingEnabled?: boolean;
  sequentialTestingTuningParameter?: number;
  queryFilter?: string;
  segment?: string;
  skipPartialData?: boolean;
  manual: boolean;
};

export interface SnapshotAnalysis {
  // Determines which analysis this is
  settings: {
    dimensions: string[];
    statsEngine: StatsEngine;
    frequentistSettings: null | {
      regressionAdjusted: boolean;
      sequentialTesting: boolean;
      sequentialTestingTuningParameter: number;
      pValueCorrection: null | "holm-bonferroni" | "benjamini-hochberg";
    };
  };
  dateCreated: Date;
  status: "running" | "success" | "error";
  error?: string;
  results: ExperimentReportResultDimension[];
}

export interface MetricForSnapshot {
  id: string;
  settings?: Pick<
    MetricInterface,
    | "datasource"
    | "aggregation"
    | "sql"
    | "cap"
    | "denominator"
    | "userIdTypes"
    | "type"
  >;
}

export type DimensionForSnapshot = {
  // The same format we use today that encodes both the type and id
  // For example: `exp:country` or `pre:date`
  id: string;
  // Dimension settings at the time the snapshot was created
  // Used to show an "out-of-date" warning on the front-end
  settings?: Pick<DimensionInterface, "datasource" | "userIdType" | "sql">;
};

export interface ExperimentSnapshotInterface {
  // Fields that uniquely define the snapshot
  id: string;
  organization: string;
  experiment: string;
  phase: number;
  dimension: string | null;

  // Status and meta info about the snapshot run
  error?: string;
  dateCreated: Date;
  runStarted: Date | null;
  status: "running" | "success" | "error";

  // Settings that control which queries are run
  // Used to determine which types of analyses are possible
  querySettings: {
    manual: boolean;
    dimensions: DimensionForSnapshot[];
    goalMetrics: MetricForSnapshot[];
    guardrailMetrics: MetricForSnapshot[];
    activationMetric: MetricForSnapshot | null;
    regressionAdjustmentEnabled: boolean;
    startDate: Date;
    endDate: Date;
  };

  // Experiment settings at the time the snapshot was run
  // These are only used to show an "out-of-date" warning on the front-end
  settings: {
    experimentId: string;
    queryFilter: string;
    segment: string;
    skipPartialData: boolean;
    datasourceId: string;
    exposureQuery: string;
  };

  // List of queries that were run as part of this snapshot
  query?: string;
  queryLanguage?: QueryLanguage;
  queries: Queries;

  // Results
  unknownVariations?: string[];
  multipleExposures?: number;
  analyses: SnapshotAnalysis[];
}
