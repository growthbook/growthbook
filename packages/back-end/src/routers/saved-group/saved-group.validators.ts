import z from "zod";

export const postSavedGroupBodyValidator = z.object({
  groupName: z.string(),
  owner: z.string(),
  type: z.enum(["condition", "list"]),
  condition: z.string().optional(),
  attributeKey: z.string().optional(),
  values: z.union([z.string().array(), z.number().array()]).optional(),
  description: z.string().optional(),
  passByReferenceOnly: z.boolean().optional(),
});

export const putSavedGroupBodyValidator = z.object({
  groupName: z.string().optional(),
  owner: z.string().optional(),
  values: z.union([z.string().array(), z.number().array()]).optional(),
  condition: z.string().optional(),
  description: z.string().optional(),
  passByReferenceOnly: z.boolean().optional(),
});
