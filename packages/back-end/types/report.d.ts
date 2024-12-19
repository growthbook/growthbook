import { ExperimentMetricInterface } from "shared/experiments";
import { OrganizationSettings } from "back-end/types/organization";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { DimensionInterface } from "back-end/types/dimension";
import { FactTableInterface, MetricPriorSettings } from "./fact-table";
import {
  AttributionModel,
  ExperimentPhase,
  ExperimentType,
  MetricOverride,
  Variation,
  ExperimentAnalysisSettings,
} from "./experiment";
import { SnapshotVariation } from "./experiment-snapshot";
import { Queries } from "./query";
import { DifferenceType, StatsEngine } from "./stats";

export interface ReportInterfaceBase {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  organization: string;
  experimentId?: string;
  userId?: string;
  title: string;
  description: string;
  runStarted: Date | null;
  status?: "published" | "private";
}

export interface ExperimentSnapshotReportInterface extends ReportInterfaceBase {
  type: "experiment-snapshot";
  uid: string;
  shareLevel: "public" | "organization" | "private";
  editLevel: "organization" | "private";
  snapshot: string;
  experimentMetadata: ExperimentReportMetadata;
  experimentAnalysisSettings: ExperimentReportAnalysisSettings;
}

export type ExperimentReportAnalysisSettings = ExperimentAnalysisSettings &
  ExperimentSnapshotReportArgs;

export type ExperimentSnapshotReportArgs = {
  userIdType?: "user" | "anonymous";
  differenceType?: DifferenceType;
  dimension?: string;
  dateStarted?: Date;
  dateEnded?: Date | null;
};

export interface ExperimentReportMetadata {
  type: ExperimentType;
  phases: ExperimentReportPhase[];
  variations: Omit<Variation, "description" | "screenshots">[];
}
export type ExperimentReportPhase = Pick<
  ExperimentPhase,
  | "dateStarted"
  | "dateEnded"
  | "name"
  | "variationWeights"
  | "banditEvents"
  | "coverage"
>;

/** @deprecated */
export interface ExperimentReportInterface extends ReportInterfaceBase {
  type: "experiment";
  args: ExperimentReportArgs;
  results?: ExperimentReportResults;
  error?: string;
  queries: Queries;
}

export interface ExperimentReportVariation {
  id: string;
  name: string;
  weight: number;
}
export interface ExperimentReportVariationWithIndex
  extends ExperimentReportVariation {
  index: number;
}
export interface MetricSnapshotSettings {
  metric: string;
  properPrior: boolean;
  properPriorMean: number;
  properPriorStdDev: number;
  regressionAdjustmentReason: string;
  regressionAdjustmentEnabled: boolean;
  regressionAdjustmentAvailable: boolean;
  regressionAdjustmentDays: number;
}

export type LegacyMetricRegressionAdjustmentStatus = {
  metric: string;
  regressionAdjustmentEnabled: boolean;
  regressionAdjustmentAvailable: boolean;
  regressionAdjustmentDays: number;
  reason: string;
};

export interface ExperimentReportArgs {
  trackingKey: string;
  datasource: string;
  /** @deprecated */
  userIdType?: "anonymous" | "user";
  exposureQueryId: string;
  startDate: Date;
  endDate?: Date;
  dimension?: string | null;
  variations: ExperimentReportVariation[];
  coverage?: number;
  segment?: string;
  goalMetrics: string[];
  secondaryMetrics: string[];
  metricOverrides?: MetricOverride[];
  guardrailMetrics: string[];
  activationMetric?: string;
  queryFilter?: string;
  skipPartialData?: boolean;
  attributionModel?: AttributionModel;
  statsEngine?: StatsEngine;
  regressionAdjustmentEnabled?: boolean;
  settingsForSnapshotMetrics?: MetricSnapshotSettings[];
  useLatestPriorSettings?: boolean;
  defaultMetricPriorSettings?: MetricPriorSettings;
  sequentialTestingEnabled?: boolean;
  sequentialTestingTuningParameter?: number;
  pValueThreshold?: number;
  differenceType?: DifferenceType;
}
export interface ExperimentReportResultDimension {
  name: string;
  srm: number;
  variations: SnapshotVariation[];
}
export interface ExperimentReportResults {
  unknownVariations: string[];
  multipleExposures: number;
  dimensions: ExperimentReportResultDimension[];
}

export type ReportInterface =
  | ExperimentSnapshotReportInterface
  | ExperimentReportInterface;

/** @deprecated */
export type LegacyReportInterface = Omit<ExperimentReportInterface, "args"> & {
  args: Omit<
    ExperimentReportArgs,
    "goalMetrics" | "guardrailMetrics" | "secondaryMetrics"
  > & {
    metricRegressionAdjustmentStatuses?: LegacyMetricRegressionAdjustmentStatus[];
    metrics?: string[];
    guardrails?: [];
    goalMetrics?: string[];
    guardrailMetrics?: string[];
    secondaryMetrics?: string[];
  };
};

export type SSRExperimentReportData = {
  metrics: Record<string, ExperimentMetricInterface>;
  metricGroups: MetricGroupInterface[];
  factTables: Record<string, FactTableInterface>;
  settings: OrganizationSettings;
  dimensions: DimensionInterface[];
};
