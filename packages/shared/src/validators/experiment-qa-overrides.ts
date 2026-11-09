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
    // Omitted = no filters: every request in the environment gets the override.
    filters: qaOverrideFiltersValidator.optional(),
    assignment: experimentQaOverrideAssignmentValidator,
  })
  .strict();

export const updateExperimentQaOverrideBodyValidator = z
  .object({
    environment: z.string().min(1),
    filters: qaOverrideFiltersValidator,
    assignment: experimentQaOverrideAssignmentValidator,
    // Position among the experiment's overrides; the others shift around it.
    order: z.number().int().min(0),
  })
  .partial()
  .strict();

export const reorderExperimentQaOverridesBodyValidator = z
  .object({
    overrideIds: z.array(z.string()).min(1),
  })
  .strict();
