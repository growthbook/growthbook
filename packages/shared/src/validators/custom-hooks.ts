import { z } from "zod";

export const hooks = [
  "validateFeature",
  "validateFeatureRevision",
  "validateSavedGroup",
] as const;

// Resource types a hook can be scoped to via entityType/entityId.
export const customHookEntityTypes = ["feature", "savedGroup"] as const;

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
    // Optional scope to a single resource; absent = global/project-scoped via projects.
    entityType: z.enum(customHookEntityTypes).optional(),
    entityId: z.string().optional(),
    lastSuccess: z.date().optional(),
    lastFailure: z.date().optional(),
    incrementalChangesOnly: z.boolean().optional(),
  })
  .strict();

export type CustomHookInterface = z.infer<typeof customHookValidator>;

export type CustomHookType = (typeof hooks)[number];

export type CustomHookEntityType = (typeof customHookEntityTypes)[number];

// Which resource type each hook operates on (validated against entityType).
export const hookEntityType: Record<CustomHookType, CustomHookEntityType> = {
  validateFeature: "feature",
  validateFeatureRevision: "feature",
  validateSavedGroup: "savedGroup",
};
