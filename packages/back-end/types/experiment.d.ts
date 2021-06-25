export type ImplementationType = "visual" | "code" | "configuration" | "custom";

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
  dateStarted?: Date;
  dateEnded?: Date;
  phase: "ramp" | "main" | "holdout";
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

export interface ExperimentInterface {
  id: string;
  trackingKey: string;
  organization: string;
  owner: string;
  datasource: string;
  implementation: ImplementationType;
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
  conversionWindowDays?: number;
  metrics: string[];
  activationMetric?: string;
  sqlOverride: Map<string, string>;
  autoAssign: boolean;
  previewURL: string;
  targetURLRegex: string;
  variations: Variation[];
  archived: boolean;
  status: "draft" | "running" | "stopped";
  phases: ExperimentPhase[];
  results?: "dnf" | "won" | "lost" | "inconclusive";
  winner?: number;
  analysis?: string;
  data?: string;
  lastSnapshotAttempt?: Date;
  autoSnapshots: boolean;
}

export type ExperimentInterfaceStringDates = Omit<
  ExperimentInterface,
  "dateCreated" | "dateUpdated" | "phases"
> & {
  dateCreated: string;
  dateUpdated: string;
  phases: ExperimentPhaseStringDates[];
};
