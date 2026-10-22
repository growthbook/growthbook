import { z } from "zod";
import {
  aiExperimentQualityCheckKeys,
  processExperimentQualityCheckKeys,
} from "./experiments";

export const experimentQualitySectionKeys = [
  "setup",
  "process",
  "documentation",
  "ai",
] as const;
export type ExperimentQualitySectionKey =
  (typeof experimentQualitySectionKeys)[number];

export const deterministicExperimentQualityCheckKeys = [
  "hypothesis",
  "description",
  "goal-metrics",
  "guardrail-metrics",
  "max-variations",
  "screenshots",
  "tags-or-project",
  "decision",
  "analysis-written",
] as const;
export type DeterministicExperimentQualityCheckKey =
  (typeof deterministicExperimentQualityCheckKeys)[number];

export const experimentQualityCheckKeys = [
  ...deterministicExperimentQualityCheckKeys,
  ...processExperimentQualityCheckKeys,
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
    // max-variations: pass with at most this many variations, control included
    maxVariations: z.number().int().min(2).optional(),
    // no-early-stop: without a scheduled end, pass when the experiment ran
    // at least this many days
    minRuntimeDays: z.number().int().min(1).optional(),
  })
  .strict();
export type ExperimentQualityCheckParams = z.infer<
  typeof experimentQualityCheckParamsValidator
>;

const experimentQualityCheckSettingsValidator = z
  .object({
    enabled: z.boolean().optional(),
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
// projection of the experiment. Counts the same as any other AI check.
export const customQualityCheckValidator = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(100),
    rule: z.string().min(1).max(1000),
    enabled: z.boolean().optional(),
  })
  .strict();
export type CustomQualityCheck = z.infer<typeof customQualityCheckValidator>;

// The checks and section weights, stored on an Experimentation Health
// settings record (unset uses the built-in defaults)
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
