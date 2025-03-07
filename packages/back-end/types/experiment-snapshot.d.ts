import {
  MetricSettingsForStatsEngine,
  QueryResultsForStatsEngine,
} from "back-end/src/services/stats";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotMetric,
} from "back-end/src/validators/experiment-snapshot";
import { MetricInterface } from "./metric";
import { DifferenceType, StatsEngine } from "./stats";
import { ExperimentReportVariation } from "./report";
import { DimensionInterface } from "./dimension";
import { ExperimentInterfaceStringDates } from "./experiment";
import { MetricWindowSettings } from "./fact-table";

export interface SnapshotVariation {
  users: number;
  metrics: {
    [key: string]: SnapshotMetric;
  };
}

export interface MetricForSnapshot {
  id: string;
  // Settings directly from the Metric object at the time the snapshot was created
  settings?: Pick<
    MetricInterface,
    | "datasource"
    | "aggregation"
    | "sql"
    | "cappingSettings"
    | "denominator"
    | "userIdTypes"
    | "type"
  >;
  // Computed settings that take into account overrides
  // see MetricSnapshotSettings
  computedSettings?: {
    regressionAdjustmentEnabled: boolean;
    regressionAdjustmentAvailable: boolean;
    regressionAdjustmentDays: number;
    regressionAdjustmentReason: string;
    properPrior: boolean;
    properPriorMean: number;
    properPriorStdDev: number;
    windowSettings: MetricWindowSettings;
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
  differenceType: DifferenceType;
  pValueCorrection?: null | "holm-bonferroni" | "benjamini-hochberg";
  pValueThreshold?: number;
  baselineVariationIndex?: number;
  numGoalMetrics: number;
}

export type SnapshotType = "standard" | "exploratory" | "report";
export type SnapshotTriggeredBy = "schedule" | "manual";

export interface SnapshotBanditSettings {
  reweight: boolean;
  decisionMetric: string;
  seed: number;
  currentWeights: number[];
  historicalWeights: {
    date: Date;
    weights: number[];
    totalUsers: number;
  }[];
}

export interface ExperimentWithSnapshot extends ExperimentInterfaceStringDates {
  snapshot?: ExperimentSnapshotInterface;
}

// Params for gbstats
export interface ExperimentMetricAnalysisParams {
  id: string;

  variations: ExperimentReportVariation[];
  phaseLengthHours: number;
  coverage: number;

  analyses: ExperimentSnapshotAnalysisSettings[];
  banditSettings?: SnapshotBanditSettings;
  metrics: Record<string, MetricSettingsForStatsEngine>;

  queryResults: QueryResultsForStatsEngine[];
}

export type ExperimentMetricAnalysisContext = {
  snapshotSettings: ExperimentSnapshotSettings;
  organization: string;
  snapshot: string;
};

export type ExperimentMetricAnalysisData = {
  analysisObj: ExperimentSnapshotAnalysis;
  unknownVariations: string[];
};

export type ExperimentAnalysisParamsContextData = {
  params: ExperimentMetricAnalysisParams;
  context: ExperimentMetricAnalysisContext;
  data: ExperimentMetricAnalysisData;
};
