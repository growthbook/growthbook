import { MetricPriorSettings } from "./fact-table";
import { AttributionModel, MetricOverride } from "./experiment";
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
  error?: string;
  queries: Queries;
  status?: "published" | "private";
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
  /**
   * @deprecated
   */
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
export interface ExperimentReportInterface extends ReportInterfaceBase {
  type: "experiment";
  args: ExperimentReportArgs;
  results?: ExperimentReportResults;
}

export type ReportInterface = ExperimentReportInterface;

export type LegacyReportInterface = Omit<ReportInterface, "args"> & {
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
