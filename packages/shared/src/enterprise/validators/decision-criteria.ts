import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";

export const decisionCriteriaAction = z.enum(["ship", "rollback", "review"]);

export const decisionCriteriaCondition = z.object({
  match: z.enum(["all", "any", "none"]),
  metrics: z.enum(["goals", "guardrails"]),
  direction: z.enum(["statsigWinner", "statsigLoser"]),
});

export const decisionCriteriaRule = z.object({
  conditions: z.array(decisionCriteriaCondition),
  action: decisionCriteriaAction,
});

// Ramp-aware health action vocabulary. "hold" only makes sense while a ramp
// is actively progressing; outside of a ramp context "hold" degrades to "warn".
export const decisionCriteriaRampHealthAction = z.enum([
  "warn",
  "hold",
  "rollback",
]);

// Ramp behavior block. Applies only while an experiment with a ramp schedule
// is actively stepping through ramp-up stages.
//
// Presets default every action to "warn" (i.e. surface but don't auto-act).
// Custom EDFs can choose stricter defaults; a specific experiment's ramp
// schedule can also override these per-signal at attach time.
export const decisionCriteriaRampBehavior = z
  .object({
    srmAction: decisionCriteriaRampHealthAction.optional(),
    noTrafficAction: decisionCriteriaRampHealthAction.optional(),
    noTrafficGracePeriodHours: z.number().positive().nullish(),
    multipleExposureAction: decisionCriteriaRampHealthAction.optional(),
  })
  .strict();

export type DecisionCriteriaAction = z.infer<typeof decisionCriteriaAction>;
export type DecisionCriteriaCondition = z.infer<
  typeof decisionCriteriaCondition
>;
export type DecisionCriteriaRule = z.infer<typeof decisionCriteriaRule>;
export type DecisionCriteriaRampHealthAction = z.infer<
  typeof decisionCriteriaRampHealthAction
>;
export type DecisionCriteriaRampBehavior = z.infer<
  typeof decisionCriteriaRampBehavior
>;

export const decisionCriteriaInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    project: z.string().optional(),
    owner: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),

    name: z.string(),
    description: z.string().optional(),

    rules: z.array(decisionCriteriaRule),
    defaultAction: decisionCriteriaAction,

    // Optional ramp-aware behavior. Ignored for experiments not running a ramp.
    rampBehavior: decisionCriteriaRampBehavior.optional(),
  })
  .strict();

export type DecisionCriteriaData = Omit<
  DecisionCriteriaInterface,
  "organization" | "project" | "owner" | "dateCreated" | "dateUpdated"
>;
export type CreateDecisionCriteriaProps =
  CreateProps<DecisionCriteriaInterface>;
export type UpdateDecisionCriteriaProps =
  UpdateProps<DecisionCriteriaInterface>;
export type DecisionCriteriaInterface = z.infer<
  typeof decisionCriteriaInterface
>;
