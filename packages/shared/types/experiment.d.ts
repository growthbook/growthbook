import { StatusIndicatorData, DecisionCriteriaRule } from "shared/enterprise";
import {
  ExperimentPhase,
  Variation,
  MetricOverride,
  ExperimentInterface,
  BanditResult,
  BanditEvent,
  ExperimentDecisionFrameworkSettings,
  HoldoutInterface,
  RevisionStatus,
} from "shared/validators";
import { ExperimentRefVariation, FeatureInterface } from "./feature";

export {
  AttributionModel,
  ImplementationType,
  LookbackOverride,
  LookbackOverrideValueUnit,
  MetricOverride,
  BanditResult,
  ExperimentStatus,
  ExperimentType,
  ExperimentPhase,
  BanditStageType,
  ExperimentDecisionFrameworkSettings,
  DecisionFrameworkMetricOverrides,
  ExperimentAnalysisSettings,
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentAnalysisSummaryVariationStatus,
  ExperimentInterface,
  ExperimentNotification,
  ExperimentResultsType,
  PhaseVariation,
  Screenshot,
  Variation,
  VariationStatus,
} from "shared/validators";

export {
  ExperimentTemplateInterface,
  ApiExperimentTemplateInterface,
  CreateTemplateProps,
  UpdateTemplateProps,
} from "shared/validators";

export {
  DecisionCriteriaInterface,
  DecisionCriteriaData,
  DecisionCriteriaAction,
  DecisionCriteriaCondition,
  DecisionCriteriaRule,
} from "shared/enterprise";

export type DecisionFrameworkVariation = {
  variationId: string;
  decidingRule: DecisionCriteriaRule | null;
};

export type DecisionFrameworkExperimentRecommendationStatus =
  | { status: "days-left"; daysLeft: number }
  | {
      status: "ship-now";
      variations: DecisionFrameworkVariation[];
      powerReached: boolean;
      sequentialUsed: boolean;
    }
  | {
      status: "rollback-now";
      variations: DecisionFrameworkVariation[];
      powerReached: boolean;
      sequentialUsed: boolean;
    }
  | {
      status: "ready-for-review";
      variations: DecisionFrameworkVariation[];
      powerReached: boolean;
      sequentialUsed: boolean;
    };

export type ExperimentUnhealthyData = {
  // if key exists, the status is unhealthy
  srm?: boolean;
  multipleExposures?: {
    rawDecimal: number;
    multipleExposedUsers: number;
  };
  lowPowered?: boolean;
  covariateImbalance?: boolean;
};

export type ExperimentResultStatus =
  | DecisionFrameworkExperimentRecommendationStatus
  | { status: "no-data" }
  | { status: "unhealthy"; unhealthyData: ExperimentUnhealthyData }
  | { status: "before-min-duration" };

export type ExperimentResultStatusData = ExperimentResultStatus & {
  tooltip?: string;
};

export type ExperimentPhaseType = "ramp" | "main" | "holdout";

export type DomChange = {
  selector: string;
  action: "append" | "set" | "remove";
  attribute: string;
  value: string;
};

export type LegacyVariation = Variation & {
  /** @deprecated */
  css?: string;
  /** @deprecated */
  dom?: DomChange[];
};

export interface VariationWithIndex extends Variation {
  index: number;
}

export type LegacyBanditResult = BanditResult & {
  srm?: number;
};

export type LegacyBanditEvent = BanditEvent & {
  banditResult: LegacyBanditResult;
};

export interface LegacyExperimentPhase extends ExperimentPhase {
  /** @deprecated */
  phase?: ExperimentPhaseType;
  /** @deprecated */
  groups?: string[];
  banditEvents?: LegacyBanditEvent[];
}

export type ExperimentPhaseStringDates = Omit<
  ExperimentPhase,
  "dateStarted" | "dateEnded"
> & {
  dateStarted?: string;
  dateEnded?: string;
};

type NextScheduledStatusUpdateStringDates = Omit<
  NextScheduledStatusUpdate,
  "date"
> & {
  date: string;
};

type StatusUpdateScheduleStringDates = Omit<StatusUpdateSchedule, "startAt"> & {
  startAt?: string;
};

export type LegacyMetricOverride = MetricOverride & {
  conversionWindowHours?: number;
  conversionDelayHours?: number;
};

export interface LegacyExperimentInterface
  extends Omit<
    ExperimentInterface,
    | "phases"
    | "variations"
    | "attributionModel"
    | "releasedVariationId"
    | "metricOverrides"
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "decisionFrameworkSettings"
  > {
  /**
   * @deprecated
   */
  observations?: string;
  metricOverrides?: LegacyMetricOverride[];
  attributionModel: ExperimentInterface["attributionModel"] | "allExposures";
  variations: LegacyVariation[];
  phases: LegacyExperimentPhase[];
  releasedVariationId?: string;
  metrics?: string[];
  guardrails?: string[];
  goalMetrics?: string[];
  secondaryMetrics?: string[];
  guardrailMetrics?: string[];
  decisionFrameworkSettings?: ExperimentDecisionFrameworkSettings;
}

export type ExperimentInterfaceStringDates = Omit<
  ExperimentInterface,
  | "dateCreated"
  | "dateUpdated"
  | "phases"
  | "nextScheduledStatusUpdate"
  | "statusUpdateSchedule"
> & {
  dateCreated: string;
  dateUpdated: string;
  phases: ExperimentPhaseStringDates[];
  nextScheduledStatusUpdate?: NextScheduledStatusUpdateStringDates | null;
  statusUpdateSchedule?: StatusUpdateScheduleStringDates | null;
};

export type HoldoutExperimentInterface = ExperimentInterfaceStringDates &
  Omit<HoldoutInterface, "experimentId" | "organization" | "owner">;

export type ComputedExperimentInterface = ExperimentInterfaceStringDates & {
  ownerName: string;
  metricNames?: (string | undefined)[];
  datasource: string;
  savedGroups?: (string | undefined)[];
  projectId?: string;
  projectName?: string;
  projectIsDeReferenced?: string | boolean;
  tab: string;
  date: string;
  statusSortOrder: number;
  statusIndicator: StatusIndicatorData;
  isWatched?: boolean;
  hasTempRollout: boolean;
  // Display string for the "State" column (e.g. "No data", "Unhealthy",
  // "Temp Rollout"), or "" when there's no health-related signal. Used for
  // both rendering and alphabetical sorting.
  healthStatus: string;
};

export type Changeset = Partial<ExperimentInterface>;

export type ExperimentTargetingData = Pick<
  ExperimentPhaseStringDates,
  | "condition"
  | "coverage"
  | "namespace"
  | "seed"
  | "variationWeights"
  | "variations"
  | "savedGroups"
  | "prerequisites"
> &
  Pick<
    ExperimentInterfaceStringDates,
    | "hashAttribute"
    | "fallbackAttribute"
    | "hashVersion"
    | "disableStickyBucketing"
    | "bucketVersion"
    | "minBucketVersion"
    | "trackingKey"
  > & {
    newPhase: boolean;
    reseed: boolean;
  };

export type LinkedFeatureState =
  | "locked"
  | "live"
  | "draft"
  | "discarded"
  | "archived";

export type LinkedFeatureEnvState =
  | "missing"
  | "disabled-env"
  | "disabled-rule"
  | "active";

export interface LinkedFeatureInfo {
  feature: FeatureInterface;
  state: LinkedFeatureState;
  values: ExperimentRefVariation[];
  /**
   * True when the matching experiment-ref rule stores its variation values as
   * sparse JSON patches (merged onto the feature default). Editors should render
   * the values in sparse mode so they aren't mistaken for full objects.
   */
  sparse?: boolean;
  valuesFrom: string;
  inconsistentValues: boolean;
  rulesAbove: boolean;
  environmentStates: Record<string, LinkedFeatureEnvState>;
  /**
   * True when the live revision has at least one experiment-ref rule for this
   * experiment.
   */
  liveHasMatchingRule?: boolean;
  /** True when the matching draft revision requires approval (regardless of whether it's been approved yet). */
  pendingApproval?: boolean;
  /** Version of the matching draft revision (present when state === "draft"). */
  draftRevisionVersion?: number;
  /** Status of the matching draft revision (present when state === "draft"). */
  draftRevisionStatus?: RevisionStatus;
  /** True when the draft cannot be auto-merged into live due to conflicting changes. */
  hasMergeConflict?: boolean;
  /**
   * True when the draft would publish changes outside the target experiment's
   * experiment-ref rule(s) — e.g. defaultValue, prerequisites, holdout, or
   * other rules. Forces the user to publish from the feature page so they
   * can review the full set of changes before they go live. Per-env kill
   * switches and metadata are excluded (auto-toggled / typically no SDK impact).
   */
  hasUnrelatedDraftChanges?: boolean;
}

export type LinkedChangeEnvState = "active" | "no-sdk-connection";

export type LinkedChangeEnvStates = Record<string, LinkedChangeEnvState>;

export type ExperimentHealthSettings = {
  decisionFrameworkEnabled: boolean;
  srmThreshold: number;
  multipleExposureMinPercent: number;
  experimentMinLengthDays: number;
};

export type ExperimentDataForStatusStringDates = Omit<
  Pick<
    ExperimentInterfaceStringDates,
    | "type"
    | "variations"
    | "status"
    | "archived"
    | "results"
    | "analysisSummary"
    | "phases"
    | "dismissedWarnings"
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "datasource"
    | "decisionFrameworkSettings"
    | "nextScheduledStatusUpdate"
  >,
  "type"
> & {
  // Contextual bandits are a separate model but reuse the experiment status
  // badge via an adapter, so allow their type here. Kept optional to match
  // the source `type` field.
  type?: ExperimentType | "contextual-bandit";
};

export type ExperimentDataForStatus = Omit<
  Pick<
    ExperimentInterface,
    | "type"
    | "variations"
    | "status"
    | "archived"
    | "results"
    | "analysisSummary"
    | "phases"
    | "dismissedWarnings"
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "datasource"
    | "decisionFrameworkSettings"
    | "nextScheduledStatusUpdate"
  >,
  "type"
> & {
  // Contextual bandits are a separate model but reuse the experiment status
  // badge via an adapter, so allow their type here. Kept optional to match
  // the source `type` field.
  type?: ExperimentType | "contextual-bandit";
};
