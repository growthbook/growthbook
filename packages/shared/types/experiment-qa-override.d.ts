import { z } from "zod";
import {
  createExperimentQaOverridesBodyValidator,
  experimentQaOverrideAssignmentValidator,
  experimentQaOverrideValidator,
  qaOverrideAdditionalTargetingValidator,
  updateExperimentQaOverrideBodyValidator,
} from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";

export type QaOverrideAdditionalTargeting = z.infer<
  typeof qaOverrideAdditionalTargetingValidator
>;

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
  "id" | "experiment" | "sdkConnection" | "environment" | "createdBy"
>;

export type CreateExperimentQaOverridesBody = z.infer<
  typeof createExperimentQaOverridesBodyValidator
>;
export type UpdateExperimentQaOverrideBody = z.infer<
  typeof updateExperimentQaOverrideBodyValidator
>;
