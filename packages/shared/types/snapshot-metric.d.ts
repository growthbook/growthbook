// Model-agnostic DTO consumed by the SQL/stats pipeline; shared by Experiments,
// Contextual Bandits, and ad-hoc snapshot runs.
import { DimensionInterface } from "./dimension";
import { AttributionModel, LookbackOverride } from "./experiment";
import { MetricPriorSettings, MetricWindowSettings } from "./fact-table";
import { MetricInterface } from "./metric";
import { PhaseSQLVar } from "./sql";

export interface MetricForSnapshot {
  id: string;
  /** Snapshot-time copy of the Metric object's settings. */
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
  /** Settings after overrides applied; see MetricSnapshotSettings. */
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
  /** Encodes type and id (e.g. `exp:country`, `pre:date`). */
  id: string;
  slices?: string[];
  /** Snapshot-time settings, used by the front-end "out-of-date" warning. */
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
  /** Set by `buildSnapshotMetricRequestForCb` directly from the CB doc. */
  contextualBandit?: boolean;
  targetingAttributeColumns?: string[];
  /** When false, SQL skips pooled `__theta` (used by CB). Defaults to true for MAB. */
  poolRegressionTheta?: boolean;
}

export interface SnapshotMetricRequest {
  dimensions: DimensionForSnapshot[];
  /** Always-computed unit dimensions gathered in 1 pass and split into per-dimension analyses. */
  precomputedUnitDimensionIds?: string[];
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
