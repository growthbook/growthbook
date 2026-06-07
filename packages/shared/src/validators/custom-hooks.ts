import { z } from "zod";

export const hooks = ["validateFeature", "validateFeatureRevision"] as const;

// The resource types a custom hook can be scoped to via entityType/entityId.
// Add new resource types here as more hook types are introduced.
export const customHookEntityTypes = ["feature"] as const;

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
    // Optional scoping to a single resource (e.g. one feature). When both are
    // set the hook only runs for that resource; when absent it's global or
    // project-scoped via `projects`.
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

// Single source of truth for which resource type each hook operates on.
// Used to validate that a hook's entityType matches its hook type.
export const hookEntityType: Record<CustomHookType, CustomHookEntityType> = {
  validateFeature: "feature",
  validateFeatureRevision: "feature",
};
