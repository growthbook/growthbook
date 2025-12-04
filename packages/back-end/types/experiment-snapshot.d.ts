import { MidExperimentPowerCalculationResult } from "shared/enterprise";
import { PhaseSQLVar } from "shared/types/sql";
import { BanditResult } from "back-end/src/validators/experiments";
import {
  MetricSettingsForStatsEngine,
  QueryResultsForStatsEngine,
} from "back-end/src/services/stats";
import { QueryLanguage } from "./datasource";
import { MetricInterface, MetricStats } from "./metric";
import {
  DifferenceType,
  RiskType,
  StatsEngine,
  MetricPowerResponseFromStatsEngine,
} from "./stats";
import { Queries } from "./query";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  LegacyMetricRegressionAdjustmentStatus,
} from "./report";
import { DimensionInterface } from "./dimension";
import {
  AttributionModel,
  ExperimentInterfaceStringDates,
  LegacyBanditResult,
} from "./experiment";
import { MetricPriorSettings, MetricWindowSettings } from "./fact-table";

export interface SnapshotMetric {
  value: number;
  cr: number;
  users: number;
  denominator?: number;
  ci?: [number, number];
  ciAdjusted?: [number, number];
  expected?: number;
  risk?: [number, number];
  riskType?: RiskType;
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
  errorMessage?: string;
  power?: MetricPowerResponseFromStatsEngine;
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
  metricRegressionAdjustmentStatuses?: LegacyMetricRegressionAdjustmentStatus[];
  banditResult?: LegacyBanditResult;
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
    targetMDE?: number;
  };
}

export interface DimensionForSnapshot {
  // The same format we use today that encodes both the type and id
  // For example: `exp:country` or `pre:date`
  id: string;
  // Pre-defined dimension levels, if they exist
  slices?: string[];
  // Dimension settings at the time the snapshot was created
  // Used to show an "out-of-date" warning on the front-end
  settings?: Pick<DimensionInterface, "datasource" | "userIdType" | "sql">;
}

export interface ExperimentSnapshotAnalysisSettings {
  dimensions: string[];
  statsEngine: StatsEngine;
  regressionAdjusted?: boolean;
  postStratificationEnabled?: boolean;
  sequentialTesting?: boolean;
  sequentialTestingTuningParameter?: number;
  differenceType: DifferenceType;
  pValueCorrection?: null | "holm-bonferroni" | "benjamini-hochberg";
  pValueThreshold?: number;
  baselineVariationIndex?: number;
  numGoalMetrics: number;
  oneSidedIntervals?: boolean;
  holdoutAnalysisWindow?: {
    start: Date;
    end: Date;
  };
}

export type SnapshotType = "standard" | "exploratory" | "report";
export type SnapshotTriggeredBy =
  | "schedule"
  | "manual"
  | "manual-dashboard"
  | "update-dashboards";

export interface ExperimentSnapshotAnalysis {
  // Determines which analysis this is
  settings: ExperimentSnapshotAnalysisSettings;
  dateCreated: Date;
  status: "running" | "success" | "error";
  error?: string;
  results: ExperimentReportResultDimension[];
}

export interface SnapshotSettingsVariation {
  id: string;
  weight: number;
}

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

// Settings that control which queries are run
// Used to determine which types of analyses are possible
// Also used to determine when to show "out-of-date" in the UI
export interface ExperimentSnapshotSettings {
  manual: boolean;
  dimensions: DimensionForSnapshot[];
  metricSettings: MetricForSnapshot[];
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  activationMetric: string | null;
  defaultMetricPriorSettings: MetricPriorSettings;
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
  phase?: PhaseSQLVar;
  customFields?: Record<string, unknown>;
  variations: SnapshotSettingsVariation[];
  coverage?: number;
  banditSettings?: SnapshotBanditSettings;
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
  type?: SnapshotType;
  triggeredBy?: SnapshotTriggeredBy;
  report?: string;

  // List of queries that were run as part of this snapshot
  queries: Queries;

  // Results
  unknownVariations: string[];
  multipleExposures: number;
  analyses: ExperimentSnapshotAnalysis[];
  banditResult?: BanditResult;

  health?: ExperimentSnapshotHealth;
}

export interface ExperimentWithSnapshot extends ExperimentInterfaceStringDates {
  snapshot?: ExperimentSnapshotInterface;
}

export interface ExperimentSnapshotHealth {
  traffic: ExperimentSnapshotTraffic;
  power?: MidExperimentPowerCalculationResult;
}

export interface ExperimentSnapshotTraffic {
  overall: ExperimentSnapshotTrafficDimension;
  dimension: {
    [dimension: string]: ExperimentSnapshotTrafficDimension[];
  };
  error?: "NO_ROWS_IN_UNIT_QUERY" | "TOO_MANY_ROWS" | string;
}
export interface ExperimentSnapshotTrafficDimension {
  name: string;
  srm: number;
  variationUnits: number[];
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
