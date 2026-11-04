import { z } from "zod";
import {
  qaOverrideAdditionalTargetingValidator,
  qaOverrideBaseValidator,
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
    applyExperimentTargeting: z.boolean(),
    applyExperimentCoverage: z.boolean(),
  })
  .strict();

export const experimentQaOverrideFieldsValidator = z
  .object({
    assignment: experimentQaOverrideAssignmentValidator,
    applyExperimentTargeting: z.boolean(),
    applyExperimentCoverage: z.boolean(),
    additionalTargeting: qaOverrideAdditionalTargetingValidator.nullable(),
  })
  .strict();

export const createExperimentQaOverridesBodyValidator =
  experimentQaOverrideFieldsValidator
    .extend({
      sdkConnections: z.array(z.string()).min(1),
    })
    .strict();

export const updateExperimentQaOverrideBodyValidator =
  experimentQaOverrideFieldsValidator.partial().strict();
