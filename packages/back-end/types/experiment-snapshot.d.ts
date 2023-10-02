import { QueryLanguage } from "./datasource";
import { MetricInterface, MetricStats } from "./metric";
import { StatsEngine } from "./stats";
import { Queries } from "./query";
import {
  ExperimentReportResultDimension,
  MetricRegressionAdjustmentStatus,
} from "./report";
import { DimensionInterface } from "./dimension";
import { AttributionModel } from "./experiment";

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
  query?: string;
  queryLanguage?: QueryLanguage;
};

export interface MetricForSnapshot {
  id: string;
  // Settings directly from the Metric object at the time the snapshot was created
  settings?: Pick<
    MetricInterface,
    | "datasource"
    | "aggregation"
    | "sql"
    | "capping"
    | "capValue"
    | "denominator"
    | "userIdTypes"
    | "type"
  >;
  // Computed settings that take into account overrides
  computedSettings?: {
    regressionAdjustmentEnabled: boolean;
    regressionAdjustmentDays: number;
    regressionAdjustmentReason: string;
    conversionWindowHours: number;
    conversionDelayHours: number;
  };
}

export interface DimensionForSnapshot {
  // The same format we use today that encodes both the type and id
  // For example: `exp:country` or `pre:date`
  id: string;
  // Dimension settings at the time the snapshot was created
  // Used to show an "out-of-date" warning on the front-end
  settings?: Pick<DimensionInterface, "datasource" | "userIdType" | "sql">;
}

export interface ExperimentSnapshotAnalysisSettings {
  dimensions: string[];
  statsEngine: StatsEngine;
  regressionAdjusted?: boolean;
  sequentialTesting?: boolean;
  sequentialTestingTuningParameter?: number;
  pValueCorrection?: null | "holm-bonferroni" | "benjamini-hochberg";
  baselineVariationIndex?: number;
}

export interface ExperimentSnapshotAnalysis {
  // Determines which analysis this is
  settings: ExperimentSnapshotAnalysisSettings;
  dateCreated: Date;
  status: "running" | "success" | "error";
  error?: string;
  results: ExperimentReportResultDimension[];
}

// Settings that control which queries are run
// Used to determine which types of analyses are possible
// Also used to determine when to show "out-of-date" in the UI
export interface ExperimentSnapshotSettings {
  manual: boolean;
  dimensions: DimensionForSnapshot[];
  metricSettings: MetricForSnapshot[];
  goalMetrics: string[];
  guardrailMetrics: string[];
  activationMetric: string | null;
  regressionAdjustmentEnabled: boolean;
  attributionModel: AttributionModel;
  experimentId: string;
  queryFilter: string;
  segment: string;
  skipPartialData: boolean;
  datasourceId: string;
  exposureQueryId: string;
  startDate: Date;
  endDate: Date;
  variations: {
    id: string;
    weight: number;
  }[];
}

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
  settings: ExperimentSnapshotSettings;

  // List of queries that were run as part of this snapshot
  queries: Queries;

  // Results
  unknownVariations: string[];
  multipleExposures: number;
  analyses: ExperimentSnapshotAnalysis[];
}
