// Model-agnostic DTO consumed by the SQL/stats pipeline.
//
// Historically this was named `ExperimentSnapshotSettings` and lived in
// `experiment-snapshot.d.ts`, but the same shape is used by Experiments,
// Contextual Bandits, and ad-hoc snapshot runs — none of which need to
// share the experiment-shaped vocabulary. Moving the DTO here decouples
// the SQL/stats integration path from the Experiment model.
//
// The sub-types in this file (DimensionForSnapshot, MetricForSnapshot,
// SnapshotSettingsVariation, SnapshotBanditSettings) are the snapshot-
// specific descriptors of inputs to a metric query — they are NOT
// experiment-specific and live here alongside the request DTO.
import { DimensionInterface } from "./dimension";
import { AttributionModel, LookbackOverride } from "./experiment";
import { MetricPriorSettings, MetricWindowSettings } from "./fact-table";
import { MetricInterface } from "./metric";
import { PhaseSQLVar } from "./sql";

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
  useFirstExposure?: boolean;
  windowSettings?: MetricWindowSettings;
  /**
   * True when the snapshot is a contextual-bandit run. Set by
   * `buildSnapshotMetricRequestForCb` directly from the CB doc; CB
   * snapshots no longer flow through ExperimentInterface so this flag
   * is sourced exclusively from the CB orchestrator.
   */
  banditIsContextual?: boolean;
  /** Targeting attribute column aliases from the experiment's exposure query at snapshot time. */
  targetingAttributeColumns?: string[];
  /**
   * When false, SQL still emits CUPED covariate aggregates but skips pooled
   * `__theta` calculation (used by contextual bandits). Defaults to true for MAB.
   */
  poolRegressionTheta?: boolean;
}

// Settings that control which queries are run
// Used to determine which types of analyses are possible
// Also used to determine when to show "out-of-date" in the UI
export interface SnapshotMetricRequest {
  dimensions: DimensionForSnapshot[];
  metricSettings: MetricForSnapshot[];
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  activationMetric: string | null;
  defaultMetricPriorSettings: MetricPriorSettings;
  regressionAdjustmentEnabled: boolean;
  attributionModel: AttributionModel;
  lookbackOverride?: LookbackOverride;
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
  /** @deprecated */
  manual?: boolean;
}
