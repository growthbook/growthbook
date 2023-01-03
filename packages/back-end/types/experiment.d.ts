export type ImplementationType = "visual" | "code" | "configuration" | "custom";

export type ExperimentPhaseType = "ramp" | "main" | "holdout";

export type DomChange = {
  selector: string;
  action: "append" | "set" | "remove";
  attribute: string;
  value: string;
};

export interface Screenshot {
  path: string;
  width?: number;
  height?: number;
  description?: string;
}

export interface Variation {
  name: string;
  description?: string;
  value?: string;
  key?: string;
  screenshots: Screenshot[];
  css?: string;
  dom?: DomChange[];
}

export interface ExperimentPhase {
  dateStarted: Date;
  dateEnded?: Date;
  phase: ExperimentPhaseType;
  reason: string;
  coverage: number;
  variationWeights: number[];
  groups?: string[];
}

export type ExperimentPhaseStringDates = Omit<
  ExperimentPhase,
  "dateStarted" | "dateEnded"
> & {
  dateStarted?: string;
  dateEnded?: string;
};

export type ExperimentStatus = "draft" | "running" | "stopped";

export type AttributionModel = "firstExposure" | "allExposures";

export type ExperimentResultsType = "dnf" | "won" | "lost" | "inconclusive";

export type MetricOverride = {
  id: string;
  conversionWindowHours?: number;
  conversionDelayHours?: number;
  winRisk?: number;
  loseRisk?: number;
};

export interface ExperimentInterface {
  id: string;
  trackingKey: string;
  organization: string;
  project?: string;
  owner: string;
  datasource: string;
  exposureQueryId: string;
  implementation: ImplementationType;
  /**
   * @deprecated
   */
  userIdType?: "anonymous" | "user";
  name: string;
  dateCreated: Date;
  dateUpdated: Date;
  tags: string[];
  description?: string;
  /**
   * @deprecated
   */
  observations?: string;
  hypothesis?: string;
  metrics: string[];
  metricOverrides?: MetricOverride[];
  guardrails?: string[];
  activationMetric?: string;
  segment?: string;
  queryFilter?: string;
  skipPartialData?: boolean;
  removeMultipleExposures?: boolean;
  attributionModel?: AttributionModel;
  autoAssign: boolean;
  previewURL: string;
  targetURLRegex: string;
  variations: Variation[];
  archived: boolean;
  status: ExperimentStatus;
  phases: ExperimentPhase[];
  results?: ExperimentResultsType;
  winner?: number;
  analysis?: string;
  data?: string;
  lastSnapshotAttempt?: Date;
  nextSnapshotAttempt?: Date;
  autoSnapshots: boolean;
  ideaSource?: string;
}

export type ExperimentInterfaceStringDates = Omit<
  ExperimentInterface,
  "dateCreated" | "dateUpdated" | "phases"
> & {
  dateCreated: string;
  dateUpdated: string;
  phases: ExperimentPhaseStringDates[];
};
