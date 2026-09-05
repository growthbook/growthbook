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
import type { ReviewAuthorityFootprint } from "shared/util";
import {
  ExperimentRefVariation,
  FeatureInterface,
  FeatureValueType,
} from "./feature";

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
      scheduledEndPassed: boolean;
    }
  | {
      status: "rollback-now";
      variations: DecisionFrameworkVariation[];
      powerReached: boolean;
      sequentialUsed: boolean;
      scheduledEndPassed: boolean;
    }
  | {
      status: "ready-for-review";
      variations: DecisionFrameworkVariation[];
      powerReached: boolean;
      sequentialUsed: boolean;
      scheduledEndPassed: boolean;
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
  | { status: "before-min-duration" }
  // The scheduled end date has passed but there is no decision recommendation
  // (e.g. no goal metrics, no results yet, or the Experiment Decision
  // Framework is not enabled). Schedule-driven, not EDF-driven.
  | { status: "scheduled-end-review" };

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
  NonNullable<ExperimentInterface["nextScheduledStatusUpdate"]>,
  "date"
> & {
  date: string;
};

type StatusUpdateScheduleStringDates = Omit<
  NonNullable<ExperimentInterface["statusUpdateSchedule"]>,
  "startAt" | "stopAt"
> & {
  startAt?: string;
  stopAt?: string;
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
    | "attributeScopeAllProjects"
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
   * Projects whose registered attributes are in scope for targeting through
   * this feature (primary + targeting projects, current ∪ draft-staged).
   * null = unscoped (the feature targets all projects).
   */
  attributeScopeProjects?: string[] | null;
  /**
   * True when the live revision has at least one experiment-ref rule for this
   * experiment.
   */
  liveHasMatchingRule?: boolean;
  /** Live rule's variation values — the "before" side of a pending edit. */
  liveValues?: ExperimentRefVariation[];
  /** Live rule's sparse flag, alongside `liveValues`. */
  liveSparse?: boolean;
  /** Live rule's `allEnvironments` flag. */
  liveAllEnvironments?: boolean;
  /** Where the live rule runs, keyed the same as `environmentStates`. */
  liveEnvironmentStates?: Record<string, LinkedFeatureEnvState>;
  /** The unpublished draft of this experiment's rule, if any. Populated regardless of `state`, which stays live-first. */
  pendingDraft?: {
    version: number;
    status: RevisionStatus;
    /** The revision's own title, for naming which draft a readout describes. */
    title?: string;
    /** Open drafts other than this one that also carry this experiment's rule. */
    otherDraftCount: number;
    /** Whether publishing would change anything, by the publish gate's own test. */
    hasChanges: boolean;
    values: ExperimentRefVariation[];
    sparse: boolean;
    allEnvironments?: boolean;
    pendingApproval: boolean;
    /** The type the draft would leave the flag as — it may re-type it. */
    valueType: FeatureValueType;
    /** The default value as of the draft, for expanding a sparse patch. */
    defaultValue: string;
    /** The publish gate's answer when review is required; "approved" can still be blocked. */
    approval?: {
      satisfied: boolean;
      footprint: ReviewAuthorityFootprint;
      /** One entry per rule; any team in an entry satisfies that rule. */
      unmetTeams: { id: string; name: string }[][];
      /** Approvals that stand but cannot sanction the publish, and why. */
      insufficientApprovers: { id: string; reason: string }[];
    };
    hasMergeConflict: boolean;
    hasUnrelatedDraftChanges: boolean;
    /** Live moved past the draft (or its approval) and the flag's policy wants a fresh base. */
    rebaseRequired: boolean;
    staleApproval: boolean;
    /** Where the draft would run once published, keyed the same as the live map. */
    environmentStates: Record<string, LinkedFeatureEnvState>;
  };
  /** True when the matching draft revision requires approval (regardless of whether it's been approved yet). */
  pendingApproval?: boolean;
  /** Version of the matching draft revision (present when state === "draft"). */
  draftRevisionVersion?: number;
  /** Status of the matching draft revision (present when state === "draft"). */
  draftRevisionStatus?: RevisionStatus;
  /** Whether that draft actually clears the publish gate, not just its status. */
  draftApprovalSatisfied?: boolean;
  /** True when the draft cannot be auto-merged into live due to conflicting changes. */
  hasMergeConflict?: boolean;
  /** The draft also changes something outside this experiment's rule; publish from the feature page. */
  hasUnrelatedDraftChanges?: boolean;
  /** Environments disabled live that the pending draft's auto-publish will enable. Only for `pendingFeatureDrafts` drafts. */
  environmentsToEnable?: string[];
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
    | "statusUpdateSchedule"
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
    | "statusUpdateSchedule"
  >,
  "type"
> & {
  // Contextual bandits are a separate model but reuse the experiment status
  // badge via an adapter, so allow their type here. Kept optional to match
  // the source `type` field.
  type?: ExperimentType | "contextual-bandit";
};
