import { z } from "zod";
import {
  createExperimentQaOverrideBodyValidator,
  experimentQaOverrideAssignmentValidator,
  experimentQaOverrideValidator,
  qaOverrideFiltersValidator,
  reorderExperimentQaOverridesBodyValidator,
  updateExperimentQaOverrideBodyValidator,
} from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";
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

export type CreateExperimentQaOverrideProps =
  CreateProps<ExperimentQaOverrideInterface>;
export type UpdateExperimentQaOverrideProps = UpdateProps<
  ExperimentQaOverrideInterface,
  "id" | "experiment" | "environment" | "createdBy"
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
};

// What the API returns: the stored override plus whether its linked Feature
// Flags will serve it in its environment right now.
export type ExperimentQaOverrideWithStatus = ExperimentQaOverrideInterface & {
  status: "active" | "waiting";
  waitingOn: QaOverrideWaitingFeature[];
};
