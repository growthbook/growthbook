import { z } from "zod";
import { baseSchema } from "./base-model";

// The organization default's `project` value
export const ORG_DEFAULT_SCOPE = "";

// Experimentation Health settings for one scope: the organization default
// or a single Project. A field left unset on a Project record inherits the
// organization default's value.
export const experimentationHealthQualitySettingsValidator = z
  .object({
    enabled: z.boolean().optional(),
    // A named ExperimentQualityConfig; unset uses the built-in default (org
    // record) or the organization default's choice (Project record)
    configId: z.string().optional(),
  })
  .strict();
export type ExperimentationHealthQualitySettings = z.infer<
  typeof experimentationHealthQualitySettingsValidator
>;

export const experimentationHealthMetricKeys = [
  "experimentsStartedPerMonth",
  "averageQualityScore",
  "processScore",
  "winRate",
  "ideasPerMonth",
] as const;
export type ExperimentationHealthMetricKey =
  (typeof experimentationHealthMetricKeys)[number];

// Areas that count toward the letter grade
export const experimentationHealthGradedAreas = [
  "velocity",
  "quality",
  "process",
] as const;
export type ExperimentationHealthGradedArea =
  (typeof experimentationHealthGradedAreas)[number];

// A healthy range. Both bounds null = no target: hidden from the dashboard
// and left out of the grade. Checked further by getHealthTargetError.
export const experimentationHealthTargetValidator = z
  .object({
    min: z.number().min(0).nullable(),
    max: z.number().min(0).nullable(),
  })
  .strict();
export type ExperimentationHealthTarget = z.infer<
  typeof experimentationHealthTargetValidator
>;

export const experimentationHealthTargetsValidator = z.partialRecord(
  z.enum(experimentationHealthMetricKeys),
  experimentationHealthTargetValidator,
);
export type ExperimentationHealthTargets = z.infer<
  typeof experimentationHealthTargetsValidator
>;

// Integer shares totalling 100, stored and inherited as one group
export const experimentationHealthGradeWeightsValidator = z
  .object({
    velocity: z.number().int().min(0).max(100),
    quality: z.number().int().min(0).max(100),
    process: z.number().int().min(0).max(100),
  })
  .strict()
  .refine((w) => w.velocity + w.quality + w.process === 100, {
    message: "Grade weights must total 100",
  });
export type ExperimentationHealthGradeWeights = z.infer<
  typeof experimentationHealthGradeWeightsValidator
>;

export const experimentationHealthSettingsValidator = baseSchema
  .extend({
    project: z.string(),
    quality: experimentationHealthQualitySettingsValidator.optional(),
    targets: experimentationHealthTargetsValidator.optional(),
    gradeWeights: experimentationHealthGradeWeightsValidator.optional(),
  })
  .strict();
export type ExperimentationHealthSettingsInterface = z.infer<
  typeof experimentationHealthSettingsValidator
>;
