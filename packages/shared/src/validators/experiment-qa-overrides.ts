import { z } from "zod";
import {
  qaOverrideBaseValidator,
  qaOverrideFiltersValidator,
} from "./qa-overrides";

export const experimentQaOverrideAssignmentValidator = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("random") }).strict(),
    z.object({ type: z.literal("forced"), variationId: z.string() }).strict(),
  ],
);

export const experimentQaOverrideValidator = qaOverrideBaseValidator
  .extend({
    experiment: z.string(),
    assignment: experimentQaOverrideAssignmentValidator,
  })
  .strict();

export const createExperimentQaOverrideBodyValidator = z
  .object({
    environment: z.string().min(1),
    filters: qaOverrideFiltersValidator,
    assignment: experimentQaOverrideAssignmentValidator,
  })
  .strict();

export const updateExperimentQaOverrideBodyValidator = z
  .object({
    filters: qaOverrideFiltersValidator,
    assignment: experimentQaOverrideAssignmentValidator,
  })
  .partial()
  .strict();

export const reorderExperimentQaOverridesBodyValidator = z
  .object({
    overrideIds: z.array(z.string()).min(1),
  })
  .strict();
