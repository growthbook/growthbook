import { z } from "zod";

const SAVED_GROUP_TYPES = ["condition", "list"] as const;

export const savedGroupValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    groupName: z.string(),
    owner: z.string(),
    type: z.enum(SAVED_GROUP_TYPES),
    source: z.string().optional(),
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

export const createSavedGroupValidator = savedGroupValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});

export const updateSavedGroupValidator = savedGroupValidator
  .omit({
    id: true,
    organization: true,
    dateCreated: true,
    dateUpdated: true,
  })
  .partial();

export const postSavedGroupBodyValidator = createSavedGroupValidator;
export const putSavedGroupBodyValidator = updateSavedGroupValidator;
