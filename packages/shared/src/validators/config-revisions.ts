import { z } from "zod";
import {
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
} from "./shared";
import { apiConfigValidator, configSchemaFormatValidator } from "./config";
import {
  jsonPatchOperationValidator,
  reviewDecision,
  revisionStatus,
  activityLogEntryValidator,
  reviewValidator,
} from "./revisions";
import { ownerInputField } from "./owner-field";
import { simpleSchemaValidator } from "./features";
import { namedSchema } from "./openapi-helpers";

// ---- Shared param schemas ----

// Configs are addressed by their immutable, org-unique `key`.
const configKeyParams = z.object({ key: z.string() });

/** Version param that also accepts the literal string "new" to auto-create a draft. */
export const configRevisionVersionParam = z.union([
  z.coerce.number().int(),
  z.literal("new"),
]);

const revisionParams = configKeyParams.extend({
  version: configRevisionVersionParam,
});

const revisionParamsStrict = configKeyParams.extend({
  version: z.coerce.number().int(),
});

// Optional metadata applied when an endpoint auto-creates a draft via
// `version: "new"`. Ignored when editing an existing revision.
const newDraftMetadataFields = {
  revisionTitle: z.string().optional(),
  revisionComment: z.string().optional(),
};

// ---- Shared response schemas ----

const booleanQueryField = z
  .union([
    z.literal("true"),
    z.literal("false"),
    z.literal("0"),
    z.literal("1"),
    z.boolean(),
  ])
  .optional();

const revisionStatusSchema = z.enum(revisionStatus);

// Combined status filter accepting individual statuses, "open", or comma-separated list
const revisionStatusQuery = z.string().refine(
  (val) => {
    if (!val) return true;
    const allowed = [...revisionStatus, "open"] as const;
    const parts = val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.every((p) => (allowed as readonly string[]).includes(p));
  },
  {
    message: `status must be a comma-separated list of: ${[
      ...revisionStatus,
      "open",
    ].join(", ")}`,
  },
);

const apiReviewValidator = namedSchema(
  "ConfigRevisionReview",
  reviewValidator
    .omit({ dateCreated: true })
    .extend({ dateCreated: z.string().meta({ format: "date-time" }) })
    .strict(),
);

const apiActivityLogEntryValidator = namedSchema(
  "ConfigRevisionActivityLogEntry",
  activityLogEntryValidator
    .omit({ dateCreated: true })
    .extend({ dateCreated: z.string().meta({ format: "date-time" }) })
    .strict(),
);

// Structured, machine-actionable warnings emitted by schema importers (e.g. an
// LLM/CI sync loop can act on `code` to self-correct). Mirrors the shared
// `SchemaWarning` shape in `shared/util/config-schema`.
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

// API-facing revision projection. Hides the raw `target` shape used internally
// and surfaces the config view directly (mirrors constant revisions).
export const apiConfigRevisionValidator = namedSchema(
  "ConfigRevision",
  z
    .object({
      id: z.string(),
      version: z.number().int().optional(),
      title: z.string().optional(),
      status: revisionStatusSchema,
      authorId: z.string(),
      authorEmail: z.string().optional(),
      contributors: z.array(z.string()).optional(),
      revertedFrom: z.string().optional(),
      reviews: z.array(apiReviewValidator),
      activityLog: z.array(apiActivityLogEntryValidator),
      resolution: z
        .object({
          action: z.enum(["merged", "discarded"]),
          userId: z.string(),
          dateCreated: z.string().meta({ format: "date-time" }),
        })
        .strict()
        .optional(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      // Snapshot of the config at the time the revision was created.
      baseConfig: apiConfigValidator,
      // The config with this revision's proposed changes applied — what it would
      // look like if merged against its current snapshot.
      proposedConfig: apiConfigValidator,
      // Raw JSON Patch ops (RFC 6902); escape hatch for inspecting deltas.
      proposedChanges: z.array(jsonPatchOperationValidator),
    })
    .strict(),
);

export type ApiConfigRevision = z.infer<typeof apiConfigRevisionValidator>;

const revisionResponse = z.object({
  revision: apiConfigRevisionValidator,
});

// Schema-edit endpoints can surface importer warnings alongside the revision.
const revisionResponseWithWarnings = revisionResponse.extend({
  warnings: z.array(apiSchemaWarningValidator).optional(),
});

const mergeConflictSchema = z
  .object({
    field: z.string(),
    baseValue: z.unknown(),
    liveValue: z.unknown(),
    proposedValue: z.unknown(),
  })
  .strict();

// ---- Read endpoint validators ----

export const listConfigRevisionsValidator = {
  method: "get" as const,
  path: "/configs-revisions",
  operationId: "listConfigRevisions",
  summary: "List config revisions across the organization",
  description:
    "Returns a paginated list of revisions across all configs in the organization, sorted newest-first. Optionally filtered by config, status, author, or the calling user's involvement.",
  tags: ["config-revisions"],
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      ...skipPaginationQueryField,
      key: z
        .string()
        .optional()
        .describe(
          "Restrict results to revisions for a single config (by its key). When omitted, returns revisions across every config the caller can read.",
        ),
      status: revisionStatusQuery
        .optional()
        .describe(
          "Filter by revision status. Accepts a comma-separated list, or the literal `open` for non-merged/non-discarded revisions.",
        ),
      author: z.string().optional(),
      mine: booleanQueryField.describe(
        "If true, return only revisions authored by the calling user. Requires a user-scoped API key. Mutually exclusive with `author`.",
      ),
    })
    .strict(),
  responseSchema: z
    .object({ revisions: z.array(apiConfigRevisionValidator) })
    .extend(apiPaginationFieldsValidator.shape),
};

export const getConfigRevisionsValidator = {
  method: "get" as const,
  path: "/configs-revisions/:key",
  operationId: "getConfigRevisions",
  summary: "List revisions for a config",
  description:
    "Returns a paginated list of revisions for this config, sorted newest-first. Optionally filtered by status, author, or the calling user's involvement.",
  tags: ["config-revisions"],
  paramsSchema: configKeyParams,
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      ...skipPaginationQueryField,
      status: revisionStatusQuery
        .optional()
        .describe(
          "Filter by revision status. Accepts a comma-separated list, or the literal `open` for non-merged/non-discarded revisions.",
        ),
      author: z.string().optional(),
      mine: booleanQueryField.describe(
        "If true, return only revisions authored by the calling user. Requires a user-scoped API key. Mutually exclusive with `author`.",
      ),
    })
    .strict(),
  responseSchema: z
    .object({ revisions: z.array(apiConfigRevisionValidator) })
    .extend(apiPaginationFieldsValidator.shape),
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const getConfigRevisionLatestValidator = {
  method: "get" as const,
  path: "/configs-revisions/:key/latest",
  operationId: "getConfigRevisionLatest",
  summary: "Get the most recent active draft revision",
  description:
    "Returns the most recently updated open (non-merged, non-discarded) revision for the config. Returns 404 if there is no active draft. Pass `mine=true` to restrict to drafts authored by the calling user (requires a user-scoped API key).",
  tags: ["config-revisions"],
  paramsSchema: configKeyParams,
  bodySchema: z.never(),
  querySchema: z
    .object({
      mine: booleanQueryField.describe(
        "If true, return only the most recent active draft authored by the calling user. Requires a user-scoped API key.",
      ),
    })
    .strict(),
  responseSchema: revisionResponse,
  exampleRequest: { params: { key: "checkout-flow" } },
};

export const getConfigRevisionValidator = {
  method: "get" as const,
  path: "/configs-revisions/:key/:version",
  operationId: "getConfigRevision",
  summary: "Get a single config revision",
  description:
    "Returns the revision at the specified version for this config. Use `GET /configs-revisions/{key}/latest` for the most recent active draft.",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: { params: { key: "checkout-flow", version: 3 } },
};

export const getConfigRevisionMergeStatusValidator = {
  method: "get" as const,
  path: "/configs-revisions/:key/:version/merge-status",
  operationId: "getConfigRevisionMergeStatus",
  summary: "Get merge status for a draft revision",
  description:
    "Runs a dry-run merge of the draft against the current live config and returns any conflicts. Use this before publishing to preview changes and detect conflicting edits.",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z
    .object({
      success: z.boolean(),
      hasConflicts: z.boolean(),
      conflicts: z.array(mergeConflictSchema),
      canAutoMerge: z.boolean(),
    })
    .strict(),
};

// ---- Lifecycle endpoint validators ----

export const postConfigRevisionValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key",
  operationId: "postConfigRevision",
  summary: "Create a draft revision",
  description:
    "Creates a new draft revision branched from the current live config. A config can have multiple concurrent drafts; use this to start an isolated line of edits.",
  tags: ["config-revisions"],
  paramsSchema: configKeyParams,
  bodySchema: z
    .object({ title: z.string().optional(), comment: z.string().optional() })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConfigRevisionDiscardValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/discard",
  operationId: "postConfigRevisionDiscard",
  summary: "Discard a draft revision",
  description:
    "Permanently discards a draft revision. Only open revisions (not merged or already-discarded) can be discarded.",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({ reason: z.string().optional() }).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConfigRevisionPublishValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/publish",
  operationId: "postConfigRevisionPublish",
  summary: "Publish a draft revision",
  description:
    "Publishes a draft revision, making it the live state of the config. Blocked if the org requires approvals and the revision is not approved (callers with the bypass-approval permission may still publish). Publishing a schema change cascades the 'base wins' normalization to descendant configs.",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      mergeNow: z
        .boolean()
        .optional()
        .describe(
          "When the org enforces same-base merges and the config changed since this revision was created, set to true to force-merge the stale revision instead of rebasing first. This only takes effect for callers with bypass-approval permission; otherwise it is ignored and the revision must be rebased.",
        ),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConfigRevisionRevertValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/revert",
  operationId: "postConfigRevisionRevert",
  summary: "Revert the config to a prior revision",
  description:
    "Creates a new draft (or immediately publishes) whose content matches the specified historical revision. Defaults to creating a draft; when the org enables 'reverts bypass approval' it defaults to publishing immediately. Pass `strategy` to override.",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      strategy: z.enum(["draft", "publish"]).optional(),
      title: z.string().optional(),
      comment: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConfigRevisionRebaseValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/rebase",
  operationId: "postConfigRevisionRebase",
  summary: "Rebase a draft revision onto the current live config",
  description:
    "Updates the draft's base snapshot to the current live state, applying the draft's changes on top. Supply `conflictResolutions` to resolve any conflicting fields. Strategies are `overwrite` (use the draft's value) or `discard` (keep the live value).",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      conflictResolutions: z
        .record(z.string(), z.enum(["overwrite", "discard"]))
        .optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

// ---- Approval endpoint validators ----

export const postConfigRevisionRequestReviewValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/request-review",
  operationId: "postConfigRevisionRequestReview",
  summary: "Request review for a draft revision",
  description:
    "Moves the draft from `draft` into `pending-review`. Notifies reviewers per the org's approval-flow settings.\n\nSet `autoPublishOnApproval` to `true` to publish the revision automatically the moment it is approved. This requires the org to have auto-publish-on-approval enabled and the caller to have publish permission on the config.",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({ autoPublishOnApproval: z.boolean().optional() })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConfigRevisionSubmitReviewValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/submit-review",
  operationId: "postConfigRevisionSubmitReview",
  summary: "Submit a review on a draft revision",
  description:
    "Submits an `approve`, `request-changes`, or `comment` review on the revision. Authors and contributors cannot submit `approve` reviews on their own drafts when the org has `blockSelfApproval` enabled.\n\nWhen `decision` is `approve` and the revision has `autoPublishOnApproval` enabled, the revision is automatically published after approval. The response includes `autoPublished: true` when this happens. Pass `skipAutoPublish: true` to approve without triggering auto-publish.",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      decision: z.enum(reviewDecision),
      comment: z.string().optional(),
      skipAutoPublish: z.boolean().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse.extend({
    autoPublished: z.boolean().optional(),
  }),
};

// ---- Field-edit endpoint validators ----

export const putConfigRevisionMetadataValidator = {
  method: "put" as const,
  path: "/configs-revisions/:key/:version/metadata",
  operationId: "putConfigRevisionMetadata",
  summary: "Update config metadata in a draft revision",
  description:
    'Stages metadata changes (name, owner, description, project, lineage parent, extensibility) on the draft. Pass `version: "new"` to auto-create a draft. The change is only applied to the live config when the revision is merged.',
  tags: ["config-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      name: z.string().optional(),
      owner: ownerInputField.optional(),
      description: z.string().optional(),
      project: z.string().optional(),
      parent: z
        .string()
        .optional()
        .describe(
          "Change the lineage parent (the `key` to inherit from). Empty string detaches from the parent.",
        ),
      extends: z
        .array(z.string())
        .optional()
        .describe(
          "Replace the composition mixins layered on top of `parent`, in precedence order (later overrides earlier; all override `parent`; own keys win last). Send the complete set; an empty array clears all mixins.",
        ),
      extensible: z.boolean().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putConfigRevisionValueValidator = {
  method: "put" as const,
  path: "/configs-revisions/:key/:version/value",
  operationId: "putConfigRevisionValue",
  summary: "Update the value of a config draft revision",
  description:
    'Stages a new default `value` and/or per-environment `environmentValues` on the draft (this config\'s own JSON object fields). At least one must be supplied. Pass `version: "new"` to auto-create a draft. A `@config:` inheritance entry in the value is rejected — express lineage via the `parent`/`extends` metadata fields instead.\n\nSet `inferSchemaIfMissing: true` to derive and stage a field schema from the value when the config has none yet.',
  tags: ["config-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      value: z
        .string()
        .optional()
        .describe("This config's own JSON-encoded object value"),
      environmentValues: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Per-environment value overrides (environment id → JSON-encoded object)",
        ),
      inferSchemaIfMissing: z
        .boolean()
        .optional()
        .describe(
          "When the config has no schema yet, infer one from the supplied `value` and stage it on the same draft.",
        ),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponseWithWarnings,
};

export const putConfigRevisionSchemaValidator = {
  method: "put" as const,
  path: "/configs-revisions/:key/:version/schema",
  operationId: "putConfigRevisionSchema",
  summary: "Update or import the schema of a config draft revision",
  description:
    'Stages this config\'s field schema on the draft. Provide exactly ONE source:\n- `schema`: a SimpleSchema object directly.\n- `format` + `source`: a raw document to convert. **JSON Schema is the recommended ("happy path") format** — it is the canonical pivot, preserves nested objects/arrays, and resolves local `$ref`/`$defs` (so generator output with referenced types works). `typescript` is a best-effort convenience parser. All conversions are lossy-by-design and degrade exotic constructs to permissive types WITH warnings (returned in `warnings`).\n- `infer: true`: derive the schema from the draft\'s value.\n\nFields whose key a published ancestor already owns are stripped ("base wins"). Pass `version: "new"` to auto-create a draft.',
  tags: ["config-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      schema: simpleSchemaValidator.optional(),
      format: configSchemaFormatValidator
        .optional()
        .describe(
          "The language of `source`. Required when `source` is provided. `json-schema` is recommended (highest fidelity; resolves `$ref`/`$defs`). `typescript` is best-effort. `simple` expects `source` to be a JSON-encoded SimpleSchema.",
        ),
      source: z
        .string()
        .optional()
        .describe("Raw schema document to convert, in the language `format`."),
      infer: z
        .boolean()
        .optional()
        .describe("Derive the schema from the draft's value instead."),
      additionalProperties: z
        .boolean()
        .optional()
        .describe(
          "Whether the resulting object schema permits extra keys (family extensibility).",
        ),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponseWithWarnings,
};

export const putConfigRevisionArchiveValidator = {
  method: "put" as const,
  path: "/configs-revisions/:key/:version/archive",
  operationId: "putConfigRevisionArchive",
  summary: "Stage an archive/unarchive in a draft revision",
  description:
    'Stages an archive or unarchive on the draft. Pass `version: "new"` to auto-create a draft. Archived configs can be permanently deleted via `DELETE /configs/{key}` once the archive is published.',
  tags: ["config-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({ ...newDraftMetadataFields, archived: z.boolean() })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};
