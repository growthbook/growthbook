import { z } from "zod";

export const savedGroupTypeValidator = z.enum(["condition", "list"]);

export const savedGroupValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    groupName: z.string(),
    owner: z.string(),
    type: savedGroupTypeValidator,
    condition: z.string().optional(),
    attributeKey: z.string().optional(),
    values: z.array(z.string()).optional(),
    dateUpdated: z.date(),
    dateCreated: z.date(),
    description: z.string().optional(),
    projects: z.array(z.string()).optional(),
    useEmptyListGroup: z.boolean().optional(),
  })
  .strict();

export const postSavedGroupBodyValidator = z.object({
  groupName: z.string(),
  owner: z.string(),
  type: savedGroupTypeValidator,
  condition: z.string().optional(),
  attributeKey: z.string().optional(),
  values: z.string().array().optional(),
  description: z.string().optional(),
  projects: z.string().array().optional(),
});

export const putSavedGroupBodyValidator = z.object({
  groupName: z.string().optional(),
  owner: z.string().optional(),
  values: z.string().array().optional(),
  condition: z.string().optional(),
  description: z.string().optional(),
  projects: z.string().array().optional(),
});
