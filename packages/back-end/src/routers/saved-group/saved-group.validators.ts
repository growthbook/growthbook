import { z } from "zod";
import { savedGroupTargeting } from "shared/validators";

export const postSavedGroupBodyValidator = z.object({
  groupName: z.string(),
  owner: z.string(),
  type: z.enum(["condition", "list"]),
  condition: z.string().optional(),
  attributeKey: z.string().optional(),
  values: z.string().array().optional(),
  description: z.string().optional(),
  projects: z.string().array().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
});

export const putSavedGroupBodyValidator = z.object({
  groupName: z.string().optional(),
  owner: z.string().optional(),
  values: z.string().array().optional(),
  condition: z.string().optional(),
  description: z.string().optional(),
  projects: z.string().array().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
});
