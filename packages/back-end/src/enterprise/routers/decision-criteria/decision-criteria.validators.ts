import { z } from "zod";
import { CreateProps, UpdateProps } from "back-end/types/models";

export const decisionCriteriaCondition = z.object({
  match: z.enum(["all", "any", "none"]),
  metrics: z.enum(["goals", "guardrails"]),
  direction: z.enum(["statsigWinner", "statsigLoser", "trendingLoser"]),
});

export const decisionCriteriaRule = z.object({
  conditions: z.array(decisionCriteriaCondition),
  action: z.enum(["ship", "rollback", "review"]),
});

export type DecisionCriteriaCondition = z.infer<
  typeof decisionCriteriaCondition
>;
export type DecisionCriteriaRule = z.infer<typeof decisionCriteriaRule>;

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
    defaultAction: z.enum(["ship", "rollback", "review"]),
  })
  .strict();

// TODO move to type file
export type CreateDecisionCriteriaProps = CreateProps<DecisionCriteriaInterface>;
export type UpdateDecisionCriteriaProps = UpdateProps<DecisionCriteriaInterface>;
export type DecisionCriteriaInterface = z.infer<
  typeof decisionCriteriaInterface
>;
