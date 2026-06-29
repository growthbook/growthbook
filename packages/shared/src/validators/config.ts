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
// Per-source naming captured from an import (a consuming codebase's type names),
// replayed when exporting that source's typed projection. Presentation metadata
// only — never part of the schema contract, so it never affects drift.
export const schemaProjectionValidator = z
  .object({
    rootName: z.string().optional(),
    typeNames: z.record(z.string(), z.string()),
  })
  .strict();

export const configValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    key: z.string(),
    name: z.string(),
    owner: ownerField,
    // Lineage parent (another config's `key`): the primary spine of the lineage
    // tree. `$extends` is synthesized from this at resolution time, never stored
    // in `value`.
    parent: z.string().optional(),
    // Additional composition bases (mixins) beyond `parent`, in precedence order
    // (later overrides earlier; all override `parent`; own keys win last). Like
    // `parent`, these are config `key`s synthesized into `$extends` at resolution
    // time and never stored in `value`.
    extends: z.array(z.string()).optional(),
    // Own value, a JSON object stored as a JSON-encoded string.
    //
    // DECISION: configs are environment-agnostic — they expose a single `value`
    // and have NO per-environment overrides anywhere (no `environmentValues`
    // field, on any API or the model). For per-environment values, use a Constant
    // (which supports env overrides) as the value source.
    value: z.string().optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    archived: z.boolean().optional(),
    // Defines each field and its type for the Configuration UI.
    schema: simpleSchemaValidator.optional(),
    // Whether this config family permits extension (extra keys) by child configs,
    // feature rules, and ad-hoc overrides. Only the root config's value applies.
    // Absent = inherit the org default (`configsExtensibleByDefault`).
    extensible: z.boolean().optional(),
    // Per-source render projections (source id → captured type names), used to
    // reproduce a consumer's named types on export. Presentation metadata, set at
    // import time; never part of the schema contract or drift.
    renderProjections: z
      .record(z.string(), schemaProjectionValidator)
      .optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

// Fields revision-aware paths (revert, applyChanges) may mutate.
export const configUpdatableFieldsSchema = configValidator.pick({
  name: true,
  owner: true,
  parent: true,
  extends: true,
  value: true,
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
  extends: z.array(z.string()).optional(),
  value: z.string().optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  schema: simpleSchemaValidator.optional(),
  extensible: z.boolean().optional(),
});

export const putConfigBodyValidator = z.object({
  name: z.string().optional(),
  owner: ownerInputField.optional(),
  parent: z.string().optional(),
  extends: z.array(z.string()).optional(),
  value: z.string().optional(),
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
// pivot AND the recommended happy-path import format (highest fidelity, resolves
// `$ref`/`$defs`); other languages are best-effort and only need a converter —
// never an API change.
export const configSchemaFormatValidator = z.enum([
  "simple",
  "json-schema",
  "typescript",
]);

// Public schema-render formats. SimpleSchema is internal-only; the external API
// speaks JSON Schema (canonical) and TypeScript (rendered).
export const configSchemaRenderFormatValidator = z.enum([
  "json-schema",
  "typescript",
]);

// A JSON Schema document — an object, open by nature, so typed loosely. The
// converter (not Zod) validates/degrades its contents.
const jsonSchemaDocument = z
  .record(z.string(), z.unknown())
  .describe("A JSON Schema document (an object).");

// A config's value — always a JSON object. The external API takes/returns it as
// native JSON (not a JSON-encoded string); the value is stored as a string
// internally and parsed/stringified at the API boundary.
export const configValueObject = z.record(z.string(), z.unknown());

// Schema I/O envelope: a config's field schema supplied as a JSON Schema document
// (canonical, native JSON — no escaping) or TypeScript source. Used for
// create/update/import input and schema export. JSON Schema is the happy path
// (highest fidelity, resolves `$ref`/`$defs`); TypeScript is best-effort and
// degrades exotic constructs to permissive types WITH warnings.
export const configSchemaSourceValidator = namedSchema(
  "ConfigSchemaSource",
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("json-schema"),
        value: jsonSchemaDocument,
      })
      .strict(),
    z
      .object({
        type: z.literal("typescript"),
        value: z
          .string()
          .describe("TypeScript source — an interface or object type."),
      })
      .strict(),
  ]),
);

export type ConfigSchemaSource = z.infer<typeof configSchemaSourceValidator>;

// Read projection of a config's own schema: always JSON Schema (the canonical
// form). TypeScript output is available via the schema-export endpoint.
const configSchemaReadValidator = z
  .object({
    type: z.literal("json-schema"),
    value: jsonSchemaDocument,
  })
  .strict();

// Structured, machine-actionable warnings emitted by schema importers (an LLM/CI
// sync loop can act on `code` to self-correct). Mirrors the shared `SchemaWarning`
// shape in `shared/util/config-schema`. Lives here (not config-revisions) so both
// the config and revision validators can reference it without an import cycle.
export const apiSchemaWarningValidator = namedSchema(
  "ConfigSchemaWarning",
  z
    .object({
      code: z.enum([
        "dropped-declaration",
        "non-object-root",
        "unresolved-type",
        "unsupported-member",
      ]),
      message: z.string(),
      path: z.string().optional(),
    })
    .strict(),
);

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
          "The `key` of the config this one inherits from (lineage parent — the primary spine). Synthesized into `$extends` at resolution time and never stored in `value`.",
        )
        .optional(),
      extends: z
        .array(z.string())
        .describe(
          "Additional composition bases (config `key`s) layered on top of `parent`, in precedence order (later overrides earlier; all override `parent`; this config's own keys win last). Like `parent`, set via this field — never via a `@config:` entry in `value`.",
        )
        .optional(),
      value: configValueObject
        .describe(
          "This config's own value as a JSON object (its declared fields only — inherited fields are layered in at resolution time, not stored here). Configs are environment-agnostic: there is no per-environment override (use a Constant for that).",
        )
        .optional(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
      project: z
        .string()
        .describe("The project this config belongs to (empty = all projects)")
        .optional(),
      archived: z.boolean().optional(),
      schema: configSchemaReadValidator
        .describe(
          "This config's own field definitions as a JSON Schema document (its contribution to the family's effective schema). Inherited fields are owned by ancestors and are not repeated here.",
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

// On create a config publishes immediately and never enters the approval flow,
// so this flag is a no-op here. Retained (deprecated) for backward compatibility;
// it remains meaningful on update.
const bypassApprovalCreateField = z
  .boolean()
  .describe(
    "Deprecated and ignored on create: a brand-new config publishes immediately and never enters the approval flow, so this flag has no effect. Approvals apply only to later changes via the update endpoint.",
  )
  .optional()
  .meta({ deprecated: true });

const postConfigApiBody = z
  .object({
    key: keyField.describe(
      "Stable reference handle (lowercase slug, unique per org), referenced as `@config:key`",
    ),
    name: z.string().describe("The display name of the config"),
    parent: z
      .string()
      .describe(
        "The `key` of the config to inherit from (the primary lineage spine). Express inheritance via `parent`/`extends`, NEVER via a `@config:` entry in `value` (which is rejected).",
      )
      .optional(),
    extends: z
      .array(z.string())
      .describe(
        "Additional composition bases (config `key`s) layered on top of `parent`, in precedence order (later overrides earlier; all override `parent`; own keys win last). Set inheritance here, never via a `@config:` entry in `value`.",
      )
      .optional(),
    value: configValueObject
      .describe(
        "This config's value as a JSON object. Configs are environment-agnostic — there is no per-environment override (use a Constant for that).",
      )
      .optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: optionalOwnerInputField,
    schema: configSchemaSourceValidator
      .describe(
        'Field definitions for this config, as a JSON Schema document (`{ type: "json-schema", value }`) or TypeScript source (`{ type: "typescript", value }`) — converted server-side in one call. Fields whose key an ancestor (via `parent`/`extends`) already owns are stripped on create (\'base wins\'); a field owned by two sibling bases is a conflict and is rejected. Omit to leave the config schema-less. Conversion warnings are returned in `warnings`.',
      )
      .optional(),
    source: z
      .string()
      .describe(
        "Optional identifier of the consuming codebase/service. When a `typescript` schema is supplied, its named-type structure is captured under this source so `GET /configs/:key/schema?source=<id>&format=typescript` can reproduce those names.",
      )
      .optional(),
    extensible: z.boolean().optional(),
    bypassApproval: bypassApprovalCreateField,
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
    extends: z
      .array(z.string())
      .describe(
        "Replace the composition bases (mixins) layered on top of `parent`, in precedence order (later overrides earlier; all override `parent`; own keys win last). Send the complete set; an empty array clears all mixins. Set inheritance here, never via a `@config:` entry in `value`.",
      )
      .optional(),
    value: configValueObject
      .describe(
        "This config's value as a JSON object. Configs are environment-agnostic — there is no per-environment override (use a Constant for that).",
      )
      .optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: ownerInputField.optional(),
    schema: configSchemaSourceValidator
      .describe(
        "Replace this config's field definitions, as a JSON Schema document (`{ type: \"json-schema\", value }`) or TypeScript source (`{ type: \"typescript\", value }`). Fields colliding with a published ancestor's key are stripped ('base wins'). A schema change cascades the 'base wins' normalization to descendants when published. Conversion warnings are returned in `warnings`.",
      )
      .optional(),
    source: z
      .string()
      .describe(
        "Optional identifier of the consuming codebase/service. When a `typescript` schema is supplied, its named-type structure is captured under this source for reproduction on export.",
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

// Create/update can convert a schema source (JSON Schema / TypeScript) inline, so
// they surface any importer warnings alongside the config.
const apiConfigResponseWithWarnings = z
  .object({
    config: apiConfigValidator,
    warnings: z.array(apiSchemaWarningValidator).optional(),
  })
  .strict();

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
      .describe(
        "The lineage parent's key (tree spine), or null for the family root.",
      ),
    extends: z
      .array(z.string())
      .describe(
        "Additional composition bases (mixin config keys) layered on top of `parent`. The tree shape follows `parent`/`depth`; these express composition beyond the parent/child spine.",
      )
      .optional(),
    project: z.string().optional(),
    archived: z.boolean(),
    depth: z
      .number()
      .int()
      .describe(
        "Distance from the family root along the `parent` spine (root is 0).",
      ),
    isTarget: z.boolean().describe("True for the requested config."),
    incompatibleFields: z
      .array(z.string())
      .describe(
        "Own value keys whose value no longer conforms to the effective (inherited) field type and must be fixed. Empty when all conform.",
      )
      .optional(),
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
      schema: configSchemaSourceValidator.describe(
        'The config\'s schema in the requested format: a JSON Schema document (`{ type: "json-schema", value }`) or rendered TypeScript source (`{ type: "typescript", value }`).',
      ),
      effective: z
        .boolean()
        .describe(
          "True when the schema includes inherited fields accumulated across the lineage; false when it is only this config's own fields.",
        ),
      additionalProperties: z
        .boolean()
        .describe("Whether the config family permits extra keys."),
    })
    .strict(),
);

const schemaFieldChangeValidator = z
  .object({
    key: z.string(),
    change: z.enum(["added", "removed", "changed"]),
  })
  .strict();

const apiConfigSchemaVerifyValidator = namedSchema(
  "ConfigSchemaVerify",
  z
    .object({
      inSync: z
        .boolean()
        .describe(
          "True when the supplied schema is canonically identical to the config's stored schema.",
        ),
      fingerprint: z
        .string()
        .describe("Canonical fingerprint of the config's stored schema."),
      incomingFingerprint: z
        .string()
        .describe("Canonical fingerprint of the supplied schema."),
      drift: z
        .object({
          contract: z
            .array(schemaFieldChangeValidator)
            .describe(
              "Changes that alter what validates (type/enum/required/nullable/bounds/structure, or an added/removed field).",
            ),
          docs: z
            .array(schemaFieldChangeValidator)
            .describe("Description-only changes (no effect on validation)."),
        })
        .strict()
        .optional()
        .describe("Present only when `inSync` is false."),
      warnings: z.array(apiSchemaWarningValidator).optional(),
    })
    .strict(),
);

export const verifyConfigSchemaValidator = {
  bodySchema: z
    .object({
      schema: configSchemaSourceValidator.describe(
        "The schema to check against the config's stored schema — a JSON Schema document or TypeScript source. Read-only: nothing is mutated.",
      ),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigSchemaVerifyValidator,
  summary: "Verify a config's schema against a source (drift check)",
  operationId: "verifyConfigSchema",
  tags: ["configs"],
  method: "post" as const,
  path: "/configs/:key/schema/verify",
  exampleRequest: {
    params: { key: "checkout-flow" },
    body: {
      schema: {
        type: "typescript" as const,
        value: "interface CheckoutFlow { timeout: number; retries: number }",
      },
    },
  },
};

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
  responseSchema: apiConfigResponseWithWarnings,
  summary: "Create a single config",
  operationId: "postConfig",
  tags: ["configs"],
  method: "post" as const,
  path: "/configs",
  exampleRequest: {
    body: {
      key: "checkout-flow",
      name: "Checkout Flow",
      value: { timeout: 30, retries: 3 },
    },
  },
};

export const updateConfigValidator = {
  bodySchema: updateConfigApiBody,
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigResponseWithWarnings,
  summary: "Partially update a single config",
  operationId: "updateConfig",
  tags: ["configs"],
  method: "post" as const,
  path: "/configs/:key",
  exampleRequest: {
    params: { key: "checkout-flow" },
    body: { value: { timeout: 60, retries: 3 } },
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
      format: configSchemaRenderFormatValidator
        .optional()
        .describe(
          "Output format. `json-schema` (default) returns a JSON Schema document; `typescript` renders the schema as TypeScript source.",
        ),
      effective: z
        .union([z.literal("true"), z.literal("false"), z.boolean()])
        .optional()
        .describe(
          "When true, includes fields inherited across the lineage (the family's accumulated schema). When false (default), returns only this config's own fields.",
        ),
      source: z
        .string()
        .optional()
        .describe(
          "Render using a previously-captured source projection (its named types). Only affects `typescript` output; ignored if the source has no projection.",
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
