import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import {
  ownerField,
  ownerEmailField,
  ownerInputField,
  optionalOwnerInputField,
} from "./owner-field";
import { simpleSchemaValidator } from "./features";
import {
  apiPaginationFieldsValidator,
  booleanQueryField,
  paginationQueryFields,
  schemaValidationQueryFields,
} from "./shared";
import { namedSchema } from "./openapi-helpers";

// Per-source naming captured from an import, replayed on typed-projection export.
// Presentation metadata only — never part of the schema contract, so never affects drift.
export const schemaProjectionValidator = z
  .object({
    language: z.string(),
    rootName: z.string().optional(),
    typeNames: z.record(z.string(), z.string()),
    // Protobuf wire numbers captured on import (the proto converter always emits
    // these); must be accepted here or a captured protobuf projection can't be
    // persisted through this `.strict()` schema.
    fieldNumbers: z.record(z.string(), z.number().int()).optional(),
  })
  .strict();

// Freeze a config at a specific published revision. While locked, no publish path
// may advance the live state past `revisionId`/`version`; only an explicit unlock
// (requires `bypassApprovalChecks`) clears it. `null`/absent = unlocked. Set solely
// via the lock/unlock endpoints — deliberately kept out of `configUpdatableFieldsSchema`
// so a revision merge can never touch it.
export const configLockSchema = z
  .object({
    // The pinned published (merged) revision at lock time.
    revisionId: z.string(),
    version: z.number(),
    lockedBy: z.string(),
    dateLocked: z.date(),
    reason: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  })
  .strict();

// One entry in a config's ordered scopedOverrides list: an environment/project-
// scoped "flavor" — a child config (referenced by key) whose value patches this
// config's resolved value when the scope matches. Evaluated first-match-wins,
// deep-merged per layer at resolution (see resolveConfigChain / resolveConstantRefs).
// Inline scope keeps precedence + membership in one place; the flavor is a plain
// config. Empty environments+projects = a catch-all (applies to any scope).
export const scopedOverrideValidator = z.object({
  config: z
    .string()
    .describe(
      "The `key` of the flavor config (a child config) whose value patches this config when the scope matches.",
    ),
  environments: z
    .array(z.string())
    .describe(
      "Environment ids this entry applies to. Empty/omitted = any environment.",
    )
    .optional(),
  projects: z
    .array(z.string())
    .describe("Project ids this entry applies to. Empty/omitted = any project.")
    .optional(),
});

// API-facing description for the ordered selection list, shared by the response
// shape and the create/update bodies.
const apiScopedOverridesField = z
  .array(scopedOverrideValidator)
  .describe(
    "Ordered, first-match-wins environment/project-scoped variant selection. Each entry points at a flavor config (a child config, by `key`) whose value is deep-merged onto this config's resolved value when the (environment, project) scope matches — resolved at build time, per layer. This is how you create an environment-scoped override (as opposed to a plain child config): make a child config for the override value, then add it here with its scope. Send the complete list to replace it; an empty array clears all overrides. Entries must reference existing configs, may not reference this config itself, and may not be unreachable (fully subsumed by an earlier entry).",
  );

// Read-only marker present ONLY on a "flavor" — a config selected by some other
// config's `scopedOverrides`. Makes an environment/project-scoped override
// self-evident (vs. a plain child config) without reverse-scanning parents.
const apiScopedConfigField = z
  .object({
    parent: z
      .string()
      .describe("The base config this one is a scoped override of."),
    environments: z
      .array(z.string())
      .describe(
        "Environments this override applies to (empty/absent = every environment).",
      )
      .optional(),
    projects: z
      .array(z.string())
      .describe(
        "Projects this override applies to (empty/absent = every project).",
      )
      .optional(),
  })
  .describe(
    'Present ONLY when this config is an environment/project-scoped override (a "flavor") of another config. Its value is a patch that applies solely within the listed environments/projects, layered onto `parent` at resolution — it is NOT a standalone config. A plain config (including an ordinary child that just inherits from a `parent`) omits this field entirely. Read-only: create/change the relationship via the parent config\'s `scopedOverrides`, never by setting this directly.',
  );

export const configValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    key: z.string(),
    name: z.string(),
    owner: ownerField,
    // Lineage parent's `key`; synthesized into `$extends` at resolution, never stored in `value`.
    parent: z.string().optional(),
    // Composition bases beyond `parent`, in precedence order (later wins; all override `parent`;
    // own keys win last). Synthesized into `$extends` at resolution, never stored in `value`.
    extends: z.array(z.string()).optional(),
    // The base value (all environments/projects) as a JSON object string.
    value: z.string().optional(),
    // Ordered, first-match-wins environment/project-scoped variant selection. Each
    // entry references a "flavor" child config (by key) whose value patches this
    // config's for the matching scope, deep-merged per layer at resolution. Absent
    // = a plain, scope-agnostic config.
    scopedOverrides: z.array(scopedOverrideValidator).optional(),
    // Present ONLY on a flavor (a config selected by some parent's
    // scopedOverrides): a self-describing marker + mirror of its scope, so a
    // flavor can be filtered out of list views / feature `baseConfig` selectors
    // without reverse-scanning every parent. NOT the source of truth for
    // resolution (the parent's scopedOverrides is) and NOT revision-controlled —
    // it's stamped/cleared immediately when scopedOverrides is written. `null`/
    // absent = a normal (non-flavor) config.
    scopedConfig: z
      .object({
        parent: z.string(),
        environments: z.array(z.string()).optional(),
        projects: z.array(z.string()).optional(),
      })
      .nullable()
      .optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    archived: z.boolean().optional(),
    // `.nullish()`, not `.optional()`: `null` is the explicit "clear the schema"
    // signal (a revert to a schema-less revision); undefined = never had one. Only
    // `null` survives the revision record's JSON round-trip and the update-diff
    // filters, both of which drop `undefined`.
    schema: simpleSchemaValidator.nullish(),
    // Whether this family permits extra keys. Only the root config's value applies;
    // absent = inherit the org default (`configsExtensibleByDefault`).
    extensible: z.boolean().optional(),
    // Presentation metadata only — never part of the schema contract or drift.
    renderProjections: z
      .record(z.string(), schemaProjectionValidator)
      .optional(),
    // Edit-protection / reproducibility pin (see configLockSchema). `null` = unlocked.
    lock: configLockSchema.nullable().optional(),
    // Opt-in "experiment guard": when true, publishing this config soft-blocks
    // (computed live) if a changed key is served to a running experiment. Seeded
    // from the org default at creation; turning it OFF requires bypassApprovalChecks
    // (asymmetric, mirrors unlock). Kept out of configUpdatableFieldsSchema — a
    // config-level setting toggled via the config controller, not a revision field.
    experimentGuard: z.boolean().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

// Fields revision-aware paths (revert, applyChanges) may mutate.
// NOTE: `scopedOverrides` is deliberately absent — the env/project variant
// selection writes IMMEDIATELY via its own endpoint (setConfigScopedOverrides),
// never through the revision merge, so the env-tab UI can always resolve the
// family from the live config.
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
  renderProjections: true,
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
  scopedOverrides: z.array(scopedOverrideValidator).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  schema: simpleSchemaValidator.optional(),
  extensible: z.boolean().optional(),
  // Omit to inherit the org default for new configs.
  experimentGuard: z.boolean().optional(),
});

export const putConfigBodyValidator = z.object({
  name: z.string().optional(),
  owner: ownerInputField.optional(),
  parent: z.string().optional(),
  extends: z.array(z.string()).optional(),
  value: z.string().optional(),
  scopedOverrides: z.array(scopedOverrideValidator).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  project: z.string().optional(),
  archived: z.boolean().optional(),
  schema: simpleSchemaValidator.optional(),
  extensible: z.boolean().optional(),
  renderProjections: z.record(z.string(), schemaProjectionValidator).optional(),
  // Toggle the experiment guard. Turning it OFF requires bypassApprovalChecks
  // (enforced in the controller).
  experimentGuard: z.boolean().optional(),
});

// Configs are addressed by their org-unique `key` (the `@config:` reference handle).

// JSON Schema is the canonical pivot and recommended import format (highest fidelity,
// resolves `$ref`/`$defs`); other languages are best-effort.
export const configSchemaFormatValidator = z.enum([
  "simple",
  "json-schema",
  "typescript",
  "protobuf",
  "python",
  "go",
  "rust",
]);

// SimpleSchema is internal-only; the external API speaks JSON Schema plus typed-code languages.
export const configSchemaRenderFormatValidator = z.enum([
  "json-schema",
  "typescript",
  "protobuf",
  "python",
  "go",
  "rust",
]);

// Typed loosely; the converter (not Zod) validates/degrades its contents.
const jsonSchemaDocument = z
  .record(z.string(), z.unknown())
  .describe("A JSON Schema document (an object).");

// External API takes/returns native JSON; stored as a string internally and
// parsed/stringified at the API boundary.
export const configValueObject = z.record(z.string(), z.unknown());

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
    z
      .object({
        type: z.literal("protobuf"),
        value: z
          .string()
          .describe("Protobuf (proto3) source — a `message` definition."),
      })
      .strict(),
    z
      .object({
        type: z.literal("python"),
        value: z
          .string()
          .describe("Python source — a Pydantic `BaseModel` class."),
      })
      .strict(),
    z
      .object({
        type: z.literal("go"),
        value: z.string().describe("Go source — a `struct` definition."),
      })
      .strict(),
    z
      .object({
        type: z.literal("rust"),
        value: z
          .string()
          .describe("Rust source — a serde `struct` definition."),
      })
      .strict(),
  ]),
);

export type ConfigSchemaSource = z.infer<typeof configSchemaSourceValidator>;

// Always JSON Schema; other formats are available via the schema-export endpoint.
const configSchemaReadValidator = z
  .object({
    type: z.literal("json-schema"),
    value: jsonSchemaDocument,
  })
  .strict();

// Mirrors the shared `SchemaWarning` shape in `shared/util/config-schema`. Lives here
// (not config-revisions) so both config and revision validators reference it without a cycle.
export const apiSchemaWarningValidator = namedSchema(
  "ConfigSchemaWarning",
  z
    .object({
      code: z.enum([
        "dropped-declaration",
        "non-object-root",
        "unresolved-type",
        "unsupported-member",
        "redundant-declaration",
        "undeclared-rule-field",
      ]),
      message: z.string(),
      path: z.string().optional(),
    })
    .strict(),
);

// Cross-field validation rules. `rule` is a mongo condition object (mongrule) —
// the single representation on both read and write.
export const apiConfigInvariantValidator = z
  .object({
    name: z.string().max(128).describe("Unique name for the rule."),
    rule: z
      .record(z.string(), z.unknown())
      .describe(
        "A mongo condition (mongrule) boolean expression over the config's fields.",
      ),
    message: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .describe("Human-readable error shown when the rule is violated."),
  })
  .strict();

// Write shape: `rule` is a mongo condition object (mongrule) — the same
// condition syntax as feature targeting.
const apiConfigInvariantInputValidator = z
  .object({
    name: z.string().max(128),
    rule: z
      .record(z.string(), z.unknown())
      .describe(
        "The rule expression, as a mongo condition (mongrule) — the same " +
          "condition syntax as feature targeting, extended with " +
          '`{ "$ref": "otherField" }` to compare against another field, e.g. ' +
          '`{ "min_replicas": { "$lte": { "$ref": "max_replicas" } } }`.',
      ),
    message: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .describe(
        "Shown to editors when the rule is violated. Optional — defaults to a generic message naming the rule.",
      )
      .optional(),
  })
  .strict();

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
          "This config's own base value as a JSON object (its declared fields only — inherited fields are layered in at resolution time, not stored here). Per-environment/project variants are expressed via `scopedOverrides`, not here.",
        )
        .optional(),
      scopedOverrides: apiScopedOverridesField.optional(),
      scopedConfig: apiScopedConfigField.optional(),
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
      invariants: z
        .array(apiConfigInvariantValidator)
        .describe(
          "Cross-field validation rules (relational checks JSON Schema can't express, e.g. implications or comparing two fields), evaluated against the resolved value at publish.",
        )
        .optional(),
      locked: z
        .boolean()
        .describe(
          "Whether this config is locked: frozen at a published revision. While locked no change can be published past that revision until it is unlocked (which requires the `bypassApprovalChecks` permission). Drafts may still be created and edited.",
        )
        .optional(),
      experimentGuard: z
        .boolean()
        .describe(
          "Whether the experiment guard is enabled: publishing a change served to a running experiment soft-blocks (unless overridden with `?ignoreWarnings=true` or `bypassApprovalChecks`). Turning it off requires `bypassApprovalChecks`.",
        )
        .optional(),
      lockedRevision: z
        .object({ id: z.string(), version: z.number() })
        .strict()
        .describe(
          "The pinned published revision (present only when `locked`). Fetch it via `GET /configs-revisions/:key/:version` for a value guaranteed not to disappear or mutate — use it to pin reproducible builds.",
        )
        .optional(),
      lockedBy: z
        .string()
        .describe("Id of the user who locked the config (when `locked`).")
        .optional(),
      dateLocked: z
        .string()
        .meta({ format: "date-time" })
        .describe("When the config was locked (when `locked`).")
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

// No-op on create (configs publish immediately); retained deprecated for compatibility.
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
        "This config's base value as a JSON object. Per-environment/project variants are expressed via `scopedOverrides`.",
      )
      .optional(),
    scopedOverrides: apiScopedOverridesField.optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: optionalOwnerInputField,
    schema: configSchemaSourceValidator
      .describe(
        'Field definitions for this config, as a JSON Schema document (`{ type: "json-schema", value }`) or typed-code source (`{ type: "typescript" | "protobuf" | "python" | "go" | "rust", value }`) — converted server-side in one call. Fields whose key an ancestor (via `parent`/`extends`) already owns follow "base wins": an identical re-declaration is stripped with a `redundant-declaration` warning; one with a differing definition is rejected. A field owned by two sibling bases is a conflict and is rejected. Omit to leave the config schema-less. Conversion warnings are returned in `warnings`.',
      )
      .optional(),
    source: z
      .string()
      .describe(
        "Optional identifier of the consuming codebase/service. When a typed-code schema (`typescript`/`protobuf`/`python`/`go`/`rust`) is supplied, its named-type structure is captured under this source so `GET /configs/:key/schema?source=<id>&format=<lang>` can reproduce those names.",
      )
      .optional(),
    extensible: z.boolean().optional(),
    experimentGuard: z
      .boolean()
      .describe(
        "Enable the experiment guard on this config: publishing a change served to a running experiment soft-blocks unless overridden. Omit to inherit the org default.",
      )
      .optional(),
    invariants: z
      .array(apiConfigInvariantInputValidator)
      .describe(
        "Cross-field validation rules. Each rule's expression is a mongo condition (mongrule). Stored on the config schema and enforced at publish.",
      )
      .optional(),
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
        "This config's base value as a JSON object. Per-environment/project variants are expressed via `scopedOverrides`.",
      )
      .optional(),
    scopedOverrides: apiScopedOverridesField
      .describe(
        "Replace the ordered, first-match-wins environment/project-scoped variant selection. Each entry points at a flavor config (a child config, by `key`) whose value is deep-merged onto this config's resolved value when the (environment, project) scope matches. Send the complete list; an empty array clears all overrides; omit to leave unchanged. Entries must reference existing configs, may not reference this config itself, and may not be unreachable.",
      )
      .optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    project: z.string().optional(),
    owner: ownerInputField.optional(),
    schema: configSchemaSourceValidator
      .describe(
        'Replace this config\'s field definitions, as a JSON Schema document (`{ type: "json-schema", value }`) or typed-code source (`{ type: "typescript" | "protobuf" | "python" | "go" | "rust", value }`). Fields whose key a published ancestor already owns follow "base wins": an identical re-declaration is stripped with a `redundant-declaration` warning; one with a differing definition is rejected. A schema change cascades the \'base wins\' normalization to descendants when published; a change that removes or retypes fields descendants still use soft-blocks with a 422 unless `?ignoreWarnings=true`. Conversion warnings are returned in `warnings`.',
      )
      .optional(),
    source: z
      .string()
      .describe(
        "Optional identifier of the consuming codebase/service. When a `typescript` or `protobuf` schema is supplied, its named-type structure is captured under this source for reproduction on export.",
      )
      .optional(),
    extensible: z.boolean().optional(),
    experimentGuard: z
      .boolean()
      .describe(
        "Enable or disable the experiment guard on this config. Turning it OFF requires the `bypassApprovalChecks` permission.",
      )
      .optional(),
    invariants: z
      .array(apiConfigInvariantInputValidator)
      .describe(
        "Replace the config's cross-field validation rules. Each rule's expression is a mongo condition (mongrule). Send the complete set; an empty array clears all rules. Omit to leave them unchanged.",
      )
      .optional(),
    bypassApproval: bypassApprovalField,
  })
  .strict();

// Addressed by `key`, not internal id.
const configKeyParams = z
  .object({ key: z.string().describe("The key of the config") })
  .strict();

const apiConfigResponse = z.object({ config: apiConfigValidator }).strict();

// Create/update convert a schema source inline, so they surface importer warnings.
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
      // Constants/configs that reference this one; `isConfig` distinguishes the two.
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

export const apiConfigKeyUsageValidator = namedSchema(
  "ConfigKeyUsage",
  z
    .object({
      // Every config in the target's lineage family (the config, its ancestors,
      // and all descendants) — the scope the implementations are drawn from.
      familyKeys: z.array(z.string()),
      // Each feature rule or default value that overrides one or more of the
      // family's keys, with the location needed to trace it back.
      implementations: z.array(
        z
          .object({
            featureId: z.string(),
            project: z.string().optional(),
            location: z.enum(["defaultValue", "rule"]),
            ruleType: z.string().optional(),
            ruleId: z.string().optional(),
            experimentId: z.string().optional(),
            experimentName: z.string().optional(),
            experimentStatus: z.string().optional(),
            variationId: z.string().optional(),
            // The family config this value extends.
            configKey: z.string(),
            // The backing config's relationship to the queried config.
            relation: z
              .enum(["self", "ancestor", "descendant", "other"])
              .optional(),
            // The config field keys this value overrides.
            keys: z.array(z.string()),
            // Whether the linkage is published or only in an open feature draft.
            state: z.enum(["live", "draft"]),
            revisionVersion: z.number().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
);

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
    orphanedFields: z
      .array(z.string())
      .describe(
        "Own value keys the effective schema no longer declares (e.g. an ancestor removed the field). They still resolve and are served, but nothing validates them and validation rules read them as null; a non-extensible family rejects them on the next changing publish.",
      )
      .optional(),
  })
  .strict();

// Not revision-aware — always reflects the live configs.
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

// Not revision-aware — always reflects the live config.
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
      ancestorOwnedFields: z
        .array(
          z
            .object({
              key: z.string(),
              ownedBy: z
                .string()
                .describe("Key of the ancestor config that owns the field."),
              identical: z
                .boolean()
                .describe(
                  "True when the supplied definition matches the ancestor's contract — a save would strip it harmlessly (with a warning). False means a save would be rejected.",
                ),
            })
            .strict(),
        )
        .optional()
        .describe(
          'Supplied fields an ancestor config already owns ("base wins"). Subtract these from `drift.contract` adds when round-tripping a full effective schema.',
        ),
      warnings: z.array(apiSchemaWarningValidator).optional(),
    })
    .strict(),
);

export const verifyConfigSchemaValidator = {
  bodySchema: z
    .object({
      schema: configSchemaSourceValidator.describe(
        "The schema to check against the config's stored schema — a JSON Schema document or typed-code source (`typescript`/`protobuf`/`python`/`go`/`rust`). Read-only: nothing is mutated.",
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
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
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
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
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
  querySchema: z
    .object({
      ignoreWarnings: booleanQueryField.describe(
        "Proceed despite the soft warning raised when archiving a config that is actively serving a value — archiving reverts anything resolving it (features, or the environments an override applies to) back to the base. Not needed when the config's live value is an empty patch or nothing uses it.",
      ),
    })
    .strict(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigResponse,
  summary: "Archive a single config",
  description:
    "Archives a config. A child config (including an environment/project override) is archived outright when its live value is an empty patch or nothing serves it; when it IS actively serving a value, this returns a 422 soft warning — re-submit with `?ignoreWarnings=true` to proceed. A root config that is still referenced by a feature or another config cannot be archived (400).",
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

export const lockConfigValidator = {
  bodySchema: z
    .object({
      reason: z
        .string()
        .max(MAX_DESCRIPTION_LENGTH)
        .describe("Optional note explaining why the config was locked.")
        .optional(),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigResponse,
  summary: "Lock a config at its current published revision",
  description:
    "Freezes the config at its current published (merged) revision. While locked, no change can be published past that revision — publish, revert-to-publish, direct update, scheduled publish, and archive are all blocked (drafts may still be created and edited). The pinned revision is returned as `lockedRevision` for reproducible build pinning. Unlocking requires the `bypassApprovalChecks` permission.",
  operationId: "lockConfig",
  tags: ["configs"],
  method: "post" as const,
  path: "/configs/:key/lock",
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const unlockConfigValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigResponse,
  summary: "Unlock a config",
  description:
    "Clears the lock so changes can be published again. Requires the `bypassApprovalChecks` permission on the config's project.",
  operationId: "unlockConfig",
  tags: ["configs"],
  method: "post" as const,
  path: "/configs/:key/unlock",
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

export const getConfigKeyUsageValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: configKeyParams,
  responseSchema: apiConfigKeyUsageValidator,
  summary: "Get the feature rules and default values implementing each key",
  description:
    "Lists every feature rule and default value that overrides a key of this config's lineage family, so you can see which keys are implemented and where.",
  operationId: "getConfigKeyUsage",
  tags: ["configs"],
  method: "get" as const,
  path: "/configs/:key/key-usage",
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const getConfigSchemaValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      format: configSchemaRenderFormatValidator
        .optional()
        .describe(
          "Output format. `json-schema` (default) returns a JSON Schema document; `typescript`, `protobuf`, `python` (Pydantic), `go`, and `rust` (serde) render the schema as source in that language.",
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
          "Render using a previously-captured source projection (its named types). Only affects the typed-code formats (`typescript`/`protobuf`/`python`/`go`/`rust`); ignored if the source has no projection.",
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
