import { StatusIndicatorData } from "shared/enterprise";
import {
  ExperimentPhase,
  Variation,
  MetricOverride,
  ExperimentInterface,
  BanditResult,
  BanditEvent,
  ExperimentDecisionFrameworkSettings,
} from "shared/src/validators/experiments";
import { DecisionCriteriaRule } from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { ExperimentRefVariation, FeatureInterface } from "./feature";

export {
  AttributionModel,
  ImplementationType,
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
  Screenshot,
  Variation,
} from "shared/src/validators/experiments";

export {
  ExperimentTemplateInterface,
  CreateTemplateProps,
  UpdateTemplateProps,
} from "back-end/src/routers/experiment-template/template.validators";

export {
  DecisionCriteriaInterface,
  DecisionCriteriaData,
  DecisionCriteriaAction,
  DecisionCriteriaCondition,
  DecisionCriteriaRule,
} from "back-end/src/enterprise/routers/decision-criteria/decision-criteria.validators";

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
  "dateCreated" | "dateUpdated" | "phases"
> & {
  dateCreated: string;
  dateUpdated: string;
  phases: ExperimentPhaseStringDates[];
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

export type LinkedFeatureState = "locked" | "live" | "draft" | "discarded";

export type LinkedFeatureEnvState =
  | "missing"
  | "disabled-env"
  | "disabled-rule"
  | "active";

export interface LinkedFeatureInfo {
  feature: FeatureInterface;
  state: LinkedFeatureState;
  values: ExperimentRefVariation[];
  valuesFrom: string;
  inconsistentValues: boolean;
  rulesAbove: boolean;
  environmentStates: Record<string, LinkedFeatureEnvState>;
}

export type ExperimentHealthSettings = {
  decisionFrameworkEnabled: boolean;
  srmThreshold: number;
  multipleExposureMinPercent: number;
  experimentMinLengthDays: number;
};

export type ExperimentDataForStatusStringDates = Pick<
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
>;

export type ExperimentDataForStatus = Pick<
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
>;
