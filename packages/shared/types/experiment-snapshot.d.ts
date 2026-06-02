import { MidExperimentPowerCalculationResult } from "shared/enterprise";
import { BanditResult } from "shared/validators";
import { CovariateImbalanceResult } from "shared/health";
import {
  AnalysisKeyType,
  AnalysisMetaEntry,
} from "shared/snapshot-analysis-chunks";
import {
  MetricSettingsForStatsEngine,
  QueryResultsForStatsEngine,
  DifferenceType,
  RiskType,
  StatsEngine,
  MetricPowerResponseFromStatsEngine,
  RealizedSettings,
  SupplementalResults,
  ContextualBanditSnapshot,
} from "shared/types/stats";
import { QueryLanguage } from "./datasource";
import { MetricStats } from "./metric";
import { Queries } from "./query";
import {
  ExperimentReportResultDimension,
  ExperimentReportVariation,
  LegacyMetricRegressionAdjustmentStatus,
} from "./report";
import {
  ExperimentInterfaceStringDates,
  LegacyBanditResult,
} from "./experiment";
import {
  SnapshotBanditSettings,
  SnapshotMetricRequest,
} from "./snapshot-metric";

// The model-agnostic metric-query DTO and its sub-types live in
// `./snapshot-metric`. Re-exported here so existing imports from
// `shared/types/experiment-snapshot` continue to compile during the
// rename window — prefer importing from `shared/types/snapshot-metric`
// directly in new code.
export type {
  DimensionForSnapshot,
  MetricForSnapshot,
  SnapshotBanditSettings,
  SnapshotMetricRequest,
  SnapshotSettingsVariation,
} from "./snapshot-metric";

/**
 * @deprecated Renamed to `SnapshotMetricRequest`. This alias keeps existing
 * imports working during the model-agnostic rename — prefer the new name in
 * new code, and migrate sites incrementally.
 */
export type ExperimentSnapshotSettings = SnapshotMetricRequest;

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
  realizedSettings?: RealizedSettings;
  supplementalResults?: SupplementalResults;
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
  numGuardrailMetrics: number;
  oneSidedIntervals?: boolean;
  holdoutAnalysisWindow?: {
    start: Date;
    end: Date;
  };
  useCovariateAsResponse?: boolean;
}

export type SnapshotType = "standard" | "exploratory" | "report";
export type SnapshotTriggeredBy =
  | "schedule"
  | "manual"
  | "manual-dashboard"
  | "update-dashboards";

export interface ExperimentSnapshotAnalysis {
  // Stable per snapshot-analysis key used to identify the chunked row data
  analysisKey: string;
  // Determines which analysis this is
  settings: ExperimentSnapshotAnalysisSettings;
  dateCreated: Date;
  status: "running" | "success" | "error";
  error?: string;
  results: ExperimentReportResultDimension[];
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
  settings: SnapshotMetricRequest;
  type?: SnapshotType;
  triggeredBy?: SnapshotTriggeredBy;
  report?: string;

  // List of queries that were run as part of this snapshot
  queries: Queries;

  // Results
  unknownVariations: string[];
  multipleExposures: number;
  analyses: ExperimentSnapshotAnalysis[];
  hasChunkedAnalyses?: boolean;
  // Keyed by `ExperimentSnapshotAnalysis.analysisKey`
  chunkedAnalysesMeta?: Record<AnalysisKeyType, AnalysisMetaEntry>;
  banditResult?: BanditResult;
  contextualBanditSnapshot?: ContextualBanditSnapshot | null;
  health?: ExperimentSnapshotHealth;
}

export interface ExperimentWithSnapshot extends ExperimentInterfaceStringDates {
  snapshot?: ExperimentSnapshotInterface;
}

/**
 * Subset of `ExperimentSnapshotInterface` returned by the dedicated
 * `GET /experiment/:id/snapshot-summary/:phase` endpoint. The endpoint only
 * fetches top-level snapshot fields (no per-metric analysis chunks), so
 * `analyses[].results` are not available here — only fields needed to
 * render refresh status, queries, errors, and other top-level snapshot
 * metadata. The narrow return type, not a runtime flag, encodes the "no
 * per-metric results" contract.
 */
export type SnapshotStatusSummary = Pick<
  ExperimentSnapshotInterface,
  | "id"
  | "status"
  | "error"
  | "queries"
  | "runStarted"
  | "dateCreated"
  | "multipleExposures"
  | "health"
  | "banditResult"
  | "type"
  | "triggeredBy"
>;

export interface ExperimentSnapshotHealth {
  traffic: ExperimentSnapshotTraffic;
  power?: MidExperimentPowerCalculationResult;
  covariateImbalance?: CovariateImbalanceResult;
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
  snapshotSettings: SnapshotMetricRequest;
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
