import { z } from "zod";

export const hooks = ["validateFeature", "validateFeatureRevision"] as const;

export const customHookValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    enabled: z.boolean(),
    projects: z.array(z.string()),
    name: z.string(),
    hook: z.enum(hooks),
    code: z.string(),
    lastSuccess: z.date().optional(),
    lastFailure: z.date().optional(),
    incrementalChangesOnly: z.boolean().optional(),
  })
  .strict();

export type CustomHookInterface = z.infer<typeof customHookValidator>;

export type CustomHookType = (typeof hooks)[number];
