import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import {
  ownerField,
  ownerEmailField,
  ownerInputField,
  optionalOwnerInputField,
} from "./owner-field";
import { simpleSchemaValidator } from "./features";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";
import { namedSchema } from "./openapi-helpers";

// A JSON-object value with a field schema and `$extends` inheritance; resolves
// like a `json` constant. The schema only drives typing/validation/UX.
export const configValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    key: z.string(),
    name: z.string(),
    owner: ownerField,
    // Lineage parent (another config's `key`). `$extends` is synthesized from
    // this at resolution time, never stored in `value`.
    parent: z.string().optional(),
    // JSON-encoded object; resolved per env as `environmentValues[env] ?? value`.
    value: z.string().optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    archived: z.boolean().optional(),
    // Defines each field and its type for the Configuration UI.
    schema: simpleSchemaValidator.optional(),
    // Whether this config family permits extension (extra keys) by child configs,
    // feature rules, and ad-hoc overrides. Only the root config's value applies.
    // Absent = inherit the org default (`configsExtensibleByDefault`).
    extensible: z.boolean().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

// Fields revision-aware paths (revert, applyChanges) may mutate.
export const configUpdatableFieldsSchema = configValidator.pick({
  name: true,
  owner: true,
  parent: true,
  value: true,
  environmentValues: true,
  description: true,
  project: true,
  archived: true,
  schema: true,
  extensible: true,
});

const keyField = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9\-_]*$/,
    "Key must be lowercase alphanumeric with hyphens or underscores",
  );

export const postConfigBodyValidator = z.object({
  key: keyField,
  name: z.string(),
  // Optional — the controller defaults the owner to the requesting user.
  owner: optionalOwnerInputField,
  parent: z.string().optional(),
  value: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  schema: simpleSchemaValidator.optional(),
  extensible: z.boolean().optional(),
});

export const putConfigBodyValidator = z.object({
  name: z.string().optional(),
  owner: ownerInputField.optional(),
  parent: z.string().optional(),
  value: z.string().optional(),
  environmentValues: z.record(z.string(), z.string()).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  archived: z.boolean().optional(),
  schema: simpleSchemaValidator.optional(),
  extensible: z.boolean().optional(),
});

// ===========================================================================
// External REST API. Validators below carry the OpenAPI route metadata and are
// wired through `createApiRequestHandler`. Configs are addressed by their
// org-unique `key` (the `@config:` reference handle), mirroring constants.
// ===========================================================================

// Schema-import source formats. A caller may supply a `SimpleSchema` directly,
// a raw document to convert (`json-schema`/`typescript`), or ask GrowthBook to
// infer a schema from the config's value (`infer`). JSON Schema is the canonical
// pivot, so any added language only needs a converter — never an API change.
export const configSchemaFormatValidator = z.enum([
  "simple",
  "json-schema",
  "typescript",
]);

// A reusable, typed, inheritable JSON object referenced from feature values via
// `@config:key`. Resolves like a `json` constant (composed via `$extends`), but
// carries a field `schema` and a lineage `parent`. `key` is the stable handle,
// unique per org across both constants and configs.
export const apiConfigValidator = namedSchema(
  "Config",
  z
    .object({
      id: z.string(),
      key: z
        .string()
        .describe("Stable reference handle; used as `@config:key` in values"),
      name: z.string(),
      owner: ownerField.optional(),
      ownerEmail: ownerEmailField,
      parent: z
        .string()
        .describe(
          "The `key` of the config this one inherits from (lineage parent). The `$extends` directive is synthesized from this at resolution time and is never stored in `value`.",
        )
        .optional(),
      value: z
        .string()
        .describe(
          "This config's own JSON-encoded object value (its declared fields only — inherited fields are layered in at resolution time, not stored here).",
        )
        .optional(),
      environmentValues: z
        .record(z.string(), z.string())
        .describe(
          "Per-environment value overrides (environment id → JSON-encoded object). Falls back to `value` when an environment is absent.",
        )
        .optional(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
      project: z
        .string()
        .describe("The project this config belongs to (empty = all projects)")
        .optional(),
      archived: z.boolean().optional(),
      schema: simpleSchemaValidator
        .describe(
          "This config's own field definitions (its contribution to the family's effective schema). Inherited fields are owned by ancestors and are not repeated here.",
        )
        .optional(),
      extensible: z
        .boolean()
        .describe(
          "Whether this config family permits extra keys beyond the declared fields (child configs, feature rules, ad-hoc overrides). Only the root config's flag applies. Absent = inherit the org default.",
        )
        .optional(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

export type ApiConfig = z.infer<typeof apiConfigValidator>;

const bypassApprovalField = z
  .boolean()
  .describe(
    "Set to true to skip the approval flow when the org requires approvals for this config's project. Requires the `bypassApprovalChecks` permission (or the org-level REST bypass setting). When approvals aren't required, this flag has no effect.",
  )
  .optional();

const postConfigApiBody = z
  .object({
    key: keyField.describe(
      "Stable reference handle (lowercase slug, unique per org), referenced as `@config:key`",
    ),
    name: z.string().describe("The display name of the config"),
    parent: z
      .string()
      .describe(
        "The `key` of the config to inherit from. Express inheritance here, NOT via a `@config:` entry in `value` (any such entry is stripped and migrated to `parent`).",
      )
      .optional(),
    value: z.string().optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: optionalOwnerInputField,
    schema: simpleSchemaValidator
      .describe(
        "Field definitions for this config. Fields whose key a published ancestor already owns are stripped on create ('base wins'). Omit to leave the config schema-less, or use the schema-import endpoints to derive one.",
      )
      .optional(),
    extensible: z.boolean().optional(),
    bypassApproval: bypassApprovalField,
  })
  .strict();

const updateConfigApiBody = z
  .object({
    name: z.string().optional(),
    parent: z
      .string()
      .describe(
        "Change the lineage parent (the `key` of the config to inherit from). Set to an empty string to detach from the parent and make this a root config.",
      )
      .optional(),
    value: z.string().optional(),
    environmentValues: z
      .record(z.string(), z.string())
      .describe(
        "Per-environment value overrides (environment id → JSON-encoded object). When provided, this REPLACES the entire override map — send the complete set, not just the environments you want to change (omit the field to leave overrides unchanged).",
      )
      .optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: ownerInputField.optional(),
    schema: simpleSchemaValidator
      .describe(
        "Replace this config's field definitions. Fields colliding with a published ancestor's key are stripped ('base wins'). A schema change cascades the 'base wins' normalization to descendants when published.",
      )
      .optional(),
    extensible: z.boolean().optional(),
    bypassApproval: bypassApprovalField,
  })
  .strict();

// Addressed by `key`, not internal id.
const configKeyParams = z
  .object({ key: z.string().describe("The key of the config") })
  .strict();

const apiConfigResponse = z.object({ config: apiConfigValidator }).strict();

export const apiConfigReferencesValidator = namedSchema(
  "ConfigReferences",
  z
    .object({
      features: z.array(
        z
          .object({
            id: z.string(),
            name: z.string().optional(),
            project: z.string().optional(),
          })
          .strict(),
      ),
      // Other constants/configs that reference this one (e.g. child configs that
      // extend it). `isConfig` distinguishes a config from a constant.
      constants: z.array(
        z
          .object({
            id: z.string(),
            key: z.string(),
            name: z.string(),
            project: z.string().optional(),
            isConfig: z.boolean().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
);

// One config in the family tree returned by the lineage endpoint.
const apiConfigLineageNodeValidator = z
  .object({
    key: z.string(),
    name: z.string(),
    parent: z
      .string()
      .nullable()
      .describe("The lineage parent's key, or null for the family root."),
    project: z.string().optional(),
    archived: z.boolean(),
    depth: z
      .number()
      .int()
      .describe("Distance from the family root (the root is 0)."),
    isTarget: z.boolean().describe("True for the requested config."),
  })
  .strict();

// The full family tree for a config: traversed up to the root and down through
// every descendant, so the whole lineage is returned regardless of which member
// was requested. Not revision-aware — always reflects the live configs.
const apiConfigLineageValidator = namedSchema(
  "ConfigLineage",
  z
    .object({
      root: z
        .string()
        .describe("The key of the family root (the topmost ancestor)."),
      target: z.string().describe("The requested config's key."),
      ancestors: z
        .array(z.string())
        .describe(
          "The target's ancestor keys, root-first, ending at its immediate parent.",
        ),
      descendants: z
        .array(z.string())
        .describe("Keys of every config that descends from the target."),
      nodes: z
        .array(apiConfigLineageNodeValidator)
        .describe(
          "Every config in the family (root plus all descendants), breadth-first.",
        ),
    })
    .strict(),
);

// Schema export: the config's own (or, with `effective=true`, the lineage's
// accumulated) field schema, rendered in the requested format. Not
// revision-aware — always reflects the live config.
const apiConfigSchemaExportValidator = namedSchema(
  "ConfigSchemaExport",
  z
    .object({
      format: configSchemaFormatValidator,
      effective: z
        .boolean()
        .describe(
          "True when the schema includes inherited fields accumulated across the lineage; false when it is only this config's own fields.",
        ),
      additionalProperties: z
        .boolean()
        .describe("Whether the config family permits extra keys."),
      // The canonical internal representation, always present.
      simpleSchema: simpleSchemaValidator.nullable(),
      // The schema rendered as a string in the requested language
      // (`json-schema`/`typescript`). Null when `format` is `simple`.
      rendered: z.string().nullable(),
    })
    .strict(),
);

export const listConfigsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ ...paginationQueryFields }).strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({ configs: z.array(apiConfigValidator) }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all configs",
  operationId: "listConfigs",
  tags: ["configs"],
  method: "get" as const,
  path: "/configs",
};

export const getConfigValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigResponse,
  summary: "Get a single config",
  operationId: "getConfig",
  tags: ["configs"],
  method: "get" as const,
  path: "/configs/:key",
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const postConfigValidator = {
  bodySchema: postConfigApiBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: apiConfigResponse,
  summary: "Create a single config",
  operationId: "postConfig",
  tags: ["configs"],
  method: "post" as const,
  path: "/configs",
  exampleRequest: {
    body: {
      key: "checkout-flow",
      name: "Checkout Flow",
      value: '{"timeout":30,"retries":3}',
    },
  },
};

export const updateConfigValidator = {
  bodySchema: updateConfigApiBody,
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigResponse,
  summary: "Partially update a single config",
  operationId: "updateConfig",
  tags: ["configs"],
  method: "post" as const,
  path: "/configs/:key",
  exampleRequest: {
    params: { key: "checkout-flow" },
    body: { value: '{"timeout":60,"retries":3}' },
  },
};

export const archiveConfigValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigResponse,
  summary: "Archive a single config",
  operationId: "archiveConfig",
  tags: ["configs"],
  method: "post" as const,
  path: "/configs/:key/archive",
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const unarchiveConfigValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigResponse,
  summary: "Unarchive a single config",
  operationId: "unarchiveConfig",
  tags: ["configs"],
  method: "post" as const,
  path: "/configs/:key/unarchive",
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const deleteConfigValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete a single config",
  operationId: "deleteConfig",
  tags: ["configs"],
  method: "delete" as const,
  path: "/configs/:key",
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const getConfigReferencesValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigReferencesValidator,
  summary: "Get features and configs that reference this config",
  operationId: "getConfigReferences",
  tags: ["configs"],
  method: "get" as const,
  path: "/configs/:key/references",
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const getConfigLineageValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigLineageValidator,
  summary: "Get the full lineage (family tree) for a config",
  operationId: "getConfigLineage",
  tags: ["configs"],
  method: "get" as const,
  path: "/configs/:key/lineage",
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const getConfigSchemaValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      format: configSchemaFormatValidator
        .optional()
        .describe(
          "Output format. `simple` returns the canonical SimpleSchema object; `json-schema` and `typescript` render it as a string. Defaults to `json-schema`.",
        ),
      effective: z
        .union([z.literal("true"), z.literal("false"), z.boolean()])
        .optional()
        .describe(
          "When true, includes fields inherited across the lineage (the family's accumulated schema). When false (default), returns only this config's own fields.",
        ),
    })
    .strict(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigSchemaExportValidator,
  summary: "Export a config's schema",
  operationId: "getConfigSchema",
  tags: ["configs"],
  method: "get" as const,
  path: "/configs/:key/schema",
  exampleRequest: { params: { key: "checkout-flow" } },
};
