import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { apiBaseSchema } from "../../validators/base-model";
import {
  ownerEmailField,
  ownerField,
  ownerInputField,
} from "../../validators/owner-field";
import { namedSchema } from "../../validators/openapi-helpers";

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

export type DecisionCriteriaAction = z.infer<typeof decisionCriteriaAction>;
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
    defaultAction: decisionCriteriaAction,
  })
  .strict();

const decisionCriteriaApiFields = {
  project: z
    .string()
    .optional()
    .describe(
      "Project ID. Omit to make the criteria available to all projects.",
    ),
  name: z.string(),
  description: z.string().optional(),
  rules: z
    .array(decisionCriteriaRule)
    .describe(
      "Evaluated in order; the first rule whose conditions all hold decides the action.",
    ),
  defaultAction: decisionCriteriaAction.describe(
    "The action when no rule matches.",
  ),
};

export const apiDecisionCriteriaValidator = namedSchema(
  "DecisionCriteria",
  apiBaseSchema.safeExtend({
    owner: ownerField,
    ownerEmail: ownerEmailField,
    ...decisionCriteriaApiFields,
  }),
);

export const apiCreateDecisionCriteriaBody = z.strictObject({
  ...decisionCriteriaApiFields,
  owner: ownerInputField.optional(),
});
export const apiUpdateDecisionCriteriaBody =
  apiCreateDecisionCriteriaBody.partial();

export type ApiDecisionCriteria = z.infer<typeof apiDecisionCriteriaValidator>;

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
