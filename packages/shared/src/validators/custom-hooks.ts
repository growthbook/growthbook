import { z } from "zod";
import { namedSchema } from "./openapi-helpers";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

export const hooks = [
  "validateFeature",
  "validateFeatureRevision",
  "validateConfig",
  "validateConfigRevision",
] as const;

// Resource types a hook can be scoped to via entityType/entityId.
export const customHookEntityTypes = ["feature", "config"] as const;

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
    // Optional scope to a single resource; absent/null = global/project-scoped
    // via projects (null because clearing the scope on update stores null).
    entityType: z.enum(customHookEntityTypes).nullable().optional(),
    entityId: z.string().nullable().optional(),
    // Config scope only: also match every config that inherits from entityId
    // (via parent/extends, transitively).
    includeDescendants: z.boolean().optional(),
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
  validateConfig: "config",
  validateConfigRevision: "config",
};

// External REST API. Validators carry the OpenAPI route metadata.
export const apiCustomHookValidator = namedSchema(
  "CustomHook",
  z
    .object({
      id: z.string(),
      name: z.string(),
      hook: z
        .enum(hooks)
        .describe(
          "Which save/publish event runs the hook (and which entity type it validates)",
        ),
      code: z
        .string()
        .describe(
          "JavaScript function body executed in the sandbox. Throw an Error to block the save; call `addWarning(msg)` for a soft warning.",
        ),
      enabled: z.boolean(),
      projects: z
        .array(z.string())
        .describe(
          "Project ids the hook applies to (empty = all projects). Always empty for entity-scoped hooks.",
        ),
      entityType: z
        .enum(customHookEntityTypes)
        .describe("Set (with entityId) to scope the hook to a single resource.")
        .optional(),
      entityId: z
        .string()
        .describe("The scoped resource: a feature id, or a config key.")
        .optional(),
      includeDescendants: z
        .boolean()
        .describe(
          "Config scope only: when true, the hook also runs for every config that inherits from entityId (via parent/extends, transitively)",
        )
        .optional(),
      incrementalChangesOnly: z
        .boolean()
        .describe(
          "When true, errors/warnings that already existed before the change being validated are suppressed",
        )
        .optional(),
      lastSuccess: z.string().meta({ format: "date-time" }).optional(),
      lastFailure: z.string().meta({ format: "date-time" }).optional(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

export type ApiCustomHook = z.infer<typeof apiCustomHookValidator>;

const postCustomHookApiBody = z
  .object({
    name: z.string().describe("The display name of the custom hook"),
    hook: z.enum(hooks),
    code: z.string(),
    enabled: z.boolean().optional().meta({ default: true }),
    projects: z
      .array(z.string())
      .describe("Project ids the hook applies to (empty/omitted = all)")
      .optional(),
    entityType: z.enum(customHookEntityTypes).optional(),
    entityId: z.string().optional(),
    includeDescendants: z
      .boolean()
      .describe(
        "Config scope only: also run the hook for every config that inherits from entityId (via parent/extends, transitively)",
      )
      .optional(),
    incrementalChangesOnly: z.boolean().optional(),
  })
  .strict();

const updateCustomHookApiBody = z
  .object({
    name: z.string().optional(),
    hook: z.enum(hooks).optional(),
    code: z.string().optional(),
    enabled: z.boolean().optional(),
    projects: z.array(z.string()).optional(),
    entityType: z
      .enum(customHookEntityTypes)
      .nullable()
      .describe(
        "Retarget the hook's scope (set with entityId). Pass null (with entityId: null) to make the hook global/project-scoped; omit to leave unchanged.",
      )
      .optional(),
    entityId: z
      .string()
      .nullable()
      .describe(
        "The scoped resource: a feature id, or a config key. Pass null (with entityType: null) to clear the scope; omit to leave unchanged.",
      )
      .optional(),
    includeDescendants: z
      .boolean()
      .describe(
        "Config scope only: also run the hook for every config that inherits from entityId (via parent/extends, transitively)",
      )
      .optional(),
    incrementalChangesOnly: z.boolean().optional(),
  })
  .strict();

const customHookIdParams = z
  .object({ id: z.string().describe("The id of the custom hook") })
  .strict();

const apiCustomHookResponse = z
  .object({ customHook: apiCustomHookValidator })
  .strict();

export const listCustomHooksValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ ...paginationQueryFields }).strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({ customHooks: z.array(apiCustomHookValidator) }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all custom hooks",
  operationId: "listCustomHooks",
  tags: ["custom-hooks"],
  method: "get" as const,
  path: "/custom-hooks",
};

export const getCustomHookValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: customHookIdParams,
  responseSchema: apiCustomHookResponse,
  summary: "Get a single custom hook",
  operationId: "getCustomHook",
  tags: ["custom-hooks"],
  method: "get" as const,
  path: "/custom-hooks/:id",
  exampleRequest: { params: { id: "hook_123abc" } },
};

export const postCustomHookValidator = {
  bodySchema: postCustomHookApiBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: apiCustomHookResponse,
  summary: "Create a single custom hook",
  operationId: "postCustomHook",
  tags: ["custom-hooks"],
  method: "post" as const,
  path: "/custom-hooks",
  exampleRequest: {
    body: {
      name: "Require a description",
      hook: "validateFeature" as const,
      code: 'if (!feature.description) {\n  throw new Error("Feature must have a description");\n}',
    },
  },
};

export const updateCustomHookValidator = {
  bodySchema: updateCustomHookApiBody,
  querySchema: z.never(),
  paramsSchema: customHookIdParams,
  responseSchema: apiCustomHookResponse,
  summary: "Partially update a single custom hook",
  operationId: "updateCustomHook",
  tags: ["custom-hooks"],
  method: "post" as const,
  path: "/custom-hooks/:id",
  exampleRequest: {
    params: { id: "hook_123abc" },
    body: { enabled: false },
  },
};

export const deleteCustomHookValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: customHookIdParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete a single custom hook",
  operationId: "deleteCustomHook",
  tags: ["custom-hooks"],
  method: "delete" as const,
  path: "/custom-hooks/:id",
  exampleRequest: { params: { id: "hook_123abc" } },
};

export const testCustomHookValidator = {
  bodySchema: z
    .object({
      functionBody: z
        .string()
        .describe("JavaScript function body to execute in the sandbox"),
      functionArgs: z
        .record(z.string(), z.unknown())
        .describe(
          "Arguments exposed to the function as named globals (e.g. `feature`, `config`, `revision`)",
        )
        .optional(),
      // Authorization scope only — a feature-scoped test is authorized against
      // that feature instead of the org-level manageCustomHooks permission.
      entityType: z.enum(customHookEntityTypes).optional(),
      entityId: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      success: z.boolean(),
      returnVal: z
        .string()
        .describe("JSON-stringified return value, when the hook returned one")
        .optional(),
      error: z.string().optional(),
      warnings: z.array(z.string()).optional(),
      log: z.string().describe("Captured console output").optional(),
    })
    .strict(),
  summary: "Dry-run hook code in the sandbox",
  operationId: "testCustomHook",
  tags: ["custom-hooks"],
  method: "post" as const,
  path: "/custom-hooks/test",
  exampleRequest: {
    body: {
      functionBody:
        'if (!feature.description) throw new Error("No description");',
      functionArgs: { feature: { id: "my-feature", description: "" } },
    },
  },
};
