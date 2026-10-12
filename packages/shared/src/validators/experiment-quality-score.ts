import { z } from "zod";
import { aiExperimentQualityCheckKeys } from "./experiments";
import { baseSchema } from "./base-model";

export const experimentQualitySectionKeys = [
  "documentation",
  "results",
  "health",
  "ai",
] as const;
export type ExperimentQualitySectionKey =
  (typeof experimentQualitySectionKeys)[number];

export const deterministicExperimentQualityCheckKeys = [
  "hypothesis",
  "description",
  "screenshots",
  "tags-or-project",
  "goal-metrics",
  "owner",
  "decision",
  "learnings",
  "health-no-issues",
  "health-powered",
  "min-runtime",
] as const;
export type DeterministicExperimentQualityCheckKey =
  (typeof deterministicExperimentQualityCheckKeys)[number];

export const experimentQualityCheckKeys = [
  ...deterministicExperimentQualityCheckKeys,
  ...aiExperimentQualityCheckKeys,
] as const;
export type ExperimentQualityCheckKey =
  (typeof experimentQualityCheckKeys)[number];

// Per-check tunable parameters. One flat optional bag keeps the schema
// simple; resolution applies per-key defaults and ignores irrelevant keys.
export const experimentQualityCheckParamsValidator = z
  .object({
    // goal-metrics: pass when 1 <= count < maxGoalMetrics
    maxGoalMetrics: z.number().int().min(2).optional(),
    // min-runtime: pass when the experiment ran at least this many days
    minRuntimeDays: z.number().int().min(1).optional(),
  })
  .strict();
export type ExperimentQualityCheckParams = z.infer<
  typeof experimentQualityCheckParamsValidator
>;

const experimentQualityCheckSettingsValidator = z
  .object({
    enabled: z.boolean().optional(),
    // Raw within-section split weight; normalized to a share on resolve
    weight: z.number().min(0).optional(),
    params: experimentQualityCheckParamsValidator.optional(),
    // Per-AI-check guidance for the AI judge
    aiContext: z.string().max(2000).optional(),
  })
  .strict();

const experimentQualitySectionSettingsValidator = z
  .object({
    enabled: z.boolean().optional(),
    // Raw cross-section share weight; normalized on resolve
    weight: z.number().min(0).optional(),
  })
  .strict();

export const MAX_CUSTOM_QUALITY_CHECKS = 5;

// User-defined AI rule, scored 0-1 by the AI judge against a trimmed JSON
// projection of the experiment. Joins the AI section's split like any
// other check.
export const customQualityCheckValidator = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(100),
    rule: z.string().min(1).max(1000),
    enabled: z.boolean().optional(),
    weight: z.number().min(0).optional(),
  })
  .strict();
export type CustomQualityCheck = z.infer<typeof customQualityCheckValidator>;

// The checks-and-weights config body. Stored on ExperimentQualityConfig
// documents (own collection) and referenced by id from org and project
// settings pointers.
export const experimentQualityConfigBodyValidator = z
  .object({
    aiChecksEnabled: z.boolean().optional(),
    sections: z
      .partialRecord(
        z.enum(experimentQualitySectionKeys),
        experimentQualitySectionSettingsValidator,
      )
      .optional(),
    checks: z
      .partialRecord(
        z.enum(experimentQualityCheckKeys),
        experimentQualityCheckSettingsValidator,
      )
      .optional(),
    customAiChecks: z
      .array(customQualityCheckValidator)
      .max(MAX_CUSTOM_QUALITY_CHECKS)
      .optional(),
  })
  .strict();
export type ExperimentQualityConfigBody = z.infer<
  typeof experimentQualityConfigBodyValidator
>;

// A named, shareable quality config document
export const experimentQualityConfigValidator = baseSchema
  .extend({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    ...experimentQualityConfigBodyValidator.shape,
  })
  .strict();
export type ExperimentQualityConfigInterface = z.infer<
  typeof experimentQualityConfigValidator
>;

// Pointer stored on org settings: the global gate + which config is the
// org-wide default (undefined = the built-in GrowthBook default)
export interface OrganizationExperimentQualityPointer {
  enabled: boolean;
  configId?: string;
}

// Pointer stored on project settings. `enabled` is tri-state: undefined
// inherits the org flag; `configId` undefined uses the org's config.
export const projectExperimentQualityPointerValidator = z
  .object({
    enabled: z.boolean().optional(),
    configId: z.string().optional(),
  })
  .strict();
export type ProjectExperimentQualityPointer = z.infer<
  typeof projectExperimentQualityPointerValidator
>;
