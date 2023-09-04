import { NamespaceValue } from "./feature";

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

export interface LegacyVariation extends Variation {
  /** @deprecated */
  css?: string;
  /** @deprecated */
  dom?: DomChange[];
}

export interface Variation {
  id: string;
  name: string;
  description?: string;
  key: string;
  screenshots: Screenshot[];
}
export interface VariationWithIndex extends Variation {
  index: number;
}

export interface LegacyExperimentPhase extends ExperimentPhase {
  /** @deprecated */
  phase?: ExperimentPhaseType;
  /** @deprecated */
  groups?: string[];
}

export interface ExperimentPhase {
  dateStarted: Date;
  dateEnded?: Date;
  name: string;
  reason: string;
  coverage: number;
  condition: string;
  namespace: NamespaceValue;
  seed?: string;
  variationWeights: number[];
}

export type ExperimentPhaseStringDates = Omit<
  ExperimentPhase,
  "dateStarted" | "dateEnded"
> & {
  dateStarted?: string;
  dateEnded?: string;
};

export type ExperimentStatus = "draft" | "running" | "stopped";

export type AttributionModel = "firstExposure" | "experimentDuration";

export type ExperimentResultsType = "dnf" | "won" | "lost" | "inconclusive";

export type MetricOverride = {
  id: string;
  conversionWindowHours?: number;
  conversionDelayHours?: number;
  winRisk?: number;
  loseRisk?: number;
  regressionAdjustmentOverride?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentDays?: number;
};

export interface LegacyExperimentInterface
  extends Omit<
    ExperimentInterface,
    "phases" | "variations" | "attributionModel"
  > {
  /**
   * @deprecated
   */
  observations?: string;
  attributionModel: ExperimentInterface["attributionModel"] | "allExposures";
  variations: LegacyVariation[];
  phases: LegacyExperimentPhase[];
}

export interface ExperimentInterface {
  id: string;
  trackingKey: string;
  organization: string;
  project?: string;
  owner: string;
  datasource: string;
  exposureQueryId: string;
  /**
   * @deprecated Always set to 'code'
   */
  implementation: ImplementationType;
  /**
   * @deprecated
   */
  userIdType?: "anonymous" | "user";
  hashAttribute: string;
  hashVersion: 1 | 2;
  name: string;
  dateCreated: Date;
  dateUpdated: Date;
  tags: string[];
  description?: string;
  hypothesis?: string;
  metrics: string[];
  metricOverrides?: MetricOverride[];
  guardrails?: string[];
  activationMetric?: string;
  segment?: string;
  queryFilter?: string;
  skipPartialData?: boolean;
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
  releasedVariationId: string;
  excludeFromPayload?: boolean;
  lastSnapshotAttempt?: Date;
  nextSnapshotAttempt?: Date;
  autoSnapshots: boolean;
  ideaSource?: string;
  regressionAdjustmentEnabled?: boolean;
  hasVisualChangesets?: boolean;
  linkedFeatures?: string[];
  sequentialTestingEnabled?: boolean;
  sequentialTestingTuningParameter?: number;
}

export type ExperimentInterfaceStringDates = Omit<
  ExperimentInterface,
  "dateCreated" | "dateUpdated" | "phases"
> & {
  dateCreated: string;
  dateUpdated: string;
  phases: ExperimentPhaseStringDates[];
};

export type Changeset = Partial<ExperimentInterface>;

export type ExperimentTargetingData = Pick<
  ExperimentPhaseStringDates,
  "condition" | "coverage" | "namespace" | "seed" | "variationWeights"
> &
  Pick<
    ExperimentInterfaceStringDates,
    "hashAttribute" | "hashVersion" | "trackingKey"
  > & {
    newPhase: boolean;
    reseed: boolean;
  };

export interface ExperimentSearchFilters {
  search: string;
  results: string[];
  status: string[];
  expType: string[];
  tags: string[];
  projects: string[];
  dataSources: string[];
  metrics: string[];
  ownerName: string;
  startDate: Date | null;
  endDate: Date | null;
}
export interface ExperimentSearchColumns {
  hypothesis: boolean;
  description: boolean;
  trackingKey: boolean;
  tags: boolean;
  projects: boolean;
  status: boolean;
  ownerName: boolean;
  created: boolean;
  startDate: boolean;
  endDate: boolean;
  dataSources: boolean;
  metrics: boolean;
  graphs: boolean;
  results: boolean;
  analysis: boolean;
  variations: boolean;
}
export interface SavedSearchInterface {
  id: string;
  organization: string;
  name: string;
  description?: string;
  project?: string;
  owner: string;
  dateCreated: Date;
  dateUpdated: Date;
  tags?: string[];
  public: boolean;
  filters: ExperimentSearchFilters;
  show: ExperimentSearchColumns;
  sort: {
    field:
      | "name"
      | "hypothesis"
      | "trackingKey"
      | "startDate"
      | "endDate"
      | "dateCreated"
      | "ownerName"
      | "description"
      | "tags"
      | "project"
      | "status"
      | "datasource"
      | "results"
      | "analysis"
      | "variations";
    dir: number;
  };
  display: "box" | "list";
}
