import { z } from "zod";
import {
  createExperimentQaOverrideBodyValidator,
  experimentQaOverrideAssignmentValidator,
  experimentQaOverrideValidator,
  qaOverrideFiltersValidator,
  reorderExperimentQaOverridesBodyValidator,
  updateExperimentQaOverrideBodyValidator,
} from "shared/validators";
import {
  LinkedFeatureEnvState,
  LinkedFeatureState,
} from "shared/types/experiment";

export type QaOverrideFilters = z.infer<typeof qaOverrideFiltersValidator>;

export type ExperimentQaOverrideAssignment = z.infer<
  typeof experimentQaOverrideAssignmentValidator
>;

export type ExperimentQaOverrideInterface = z.infer<
  typeof experimentQaOverrideValidator
>;

export type CreateExperimentQaOverrideBody = z.infer<
  typeof createExperimentQaOverrideBodyValidator
>;
export type UpdateExperimentQaOverrideBody = z.infer<
  typeof updateExperimentQaOverrideBodyValidator
>;
export type ReorderExperimentQaOverridesBody = z.infer<
  typeof reorderExperimentQaOverridesBodyValidator
>;

export type QaOverrideWaitingFeature = {
  featureId: string;
  reason:
    | Exclude<LinkedFeatureState, "live">
    | Exclude<LinkedFeatureEnvState, "active">;
  draftVersion?: number;
};

// Something the override refers to is gone. Unlike `waiting`, this never
// resolves by itself: the override has to be edited or deleted.
export type QaOverrideInvalidReason =
  | "variation-removed"
  | "no-matching-connection";

export type QaOverrideStaleSdkConnection = {
  id: string;
  reason: "deleted" | "archived" | "other-environment";
};

export type QaOverrideStatus = {
  status: "active" | "waiting" | "invalid";
  waitingOn: QaOverrideWaitingFeature[];
  invalidReasons: QaOverrideInvalidReason[];
  staleSdkConnections: QaOverrideStaleSdkConnection[];
};

export type ExperimentQaOverrideWithStatus = ExperimentQaOverrideInterface &
  QaOverrideStatus;
