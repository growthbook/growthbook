import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";

export const decisionCriteriaAction = z.enum(["ship", "rollback", "review"]);

export const decisionCriteriaCondition = z.object({
  match: z.enum(["all", "any", "none"]),
  metrics: z.enum(["goals", "guardrails"]),
  direction: z.enum([
    "statsigWinner",
    "statsigLoser",
    "superStatsigWinner",
    "superStatsigLoser",
  ]),
});

export const decisionCriteriaRule = z.object({
  conditions: z.array(decisionCriteriaCondition),
  action: decisionCriteriaAction,
});

export type DecisionCriteriaAction = z.infer<typeof decisionCriteriaAction>;
export type DecisionCriteriaCondition = z.infer<
  typeof decisionCriteriaCondition
>;
export type DecisionCriteriaRule = z.infer<typeof decisionCriteriaRule>;

export const dcHealthSignalAction = z.enum(["off", "review", "rollback"]);
export type DcHealthSignalAction = z.infer<typeof dcHealthSignalAction>;

export const dcHealthSignals = z.object({
  srmAction: dcHealthSignalAction,
  multipleExposureAction: dcHealthSignalAction,
  noTrafficAction: dcHealthSignalAction,
  noTrafficGracePeriodHours: z.number().positive(),
});
export type DcHealthSignals = z.infer<typeof dcHealthSignals>;

export const DEFAULT_DC_HEALTH_SIGNALS: DcHealthSignals = {
  srmAction: "review",
  multipleExposureAction: "review",
  noTrafficAction: "review",
  noTrafficGracePeriodHours: 24,
};

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
    healthSignals: dcHealthSignals.optional(),
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
