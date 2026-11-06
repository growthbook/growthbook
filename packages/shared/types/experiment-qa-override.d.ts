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
