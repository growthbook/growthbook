import { z } from "zod";
import {
  booleanQueryField,
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
  schemaValidationQueryFields,
  publishOverrideBodyFields,
  bypassApprovalPublishBodyField,
} from "./shared";
import {
  apiConfigValidator,
  apiSchemaWarningValidator,
  configSchemaSourceValidator,
  configValueObject,
} from "./config";
import {
  jsonPatchOperationValidator,
  reviewDecision,
  revisionStatus,
  activityLogEntryValidator,
  reviewValidator,
} from "./revisions";
import { ownerInputField } from "./owner-field";
import { namedSchema } from "./openapi-helpers";

// ---- Shared param schemas ----

// Configs are addressed by their immutable, org-unique `key`.
const configKeyParams = z.object({ key: z.string() });

/** Version param that also accepts the literal string "new" to auto-create a draft. */
const configRevisionVersionParam = z.union([
  z.coerce.number().int(),
  z.literal("new"),
]);

const revisionParams = configKeyParams.extend({
  version: configRevisionVersionParam,
});

const revisionParamsStrict = configKeyParams.extend({
  version: z.coerce.number().int(),
});

// Applied only when an endpoint auto-creates a draft via `version: "new"`.
const newDraftMetadataFields = {
  revisionTitle: z.string().optional(),
  revisionComment: z.string().optional(),
};

// ---- Shared response schemas ----

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

// Hides the raw internal `target` shape, surfacing the config view directly.
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
      // The config with this revision's changes applied, against its current snapshot.
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
      bypassApproval: bypassApprovalPublishBodyField,
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
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
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
  responseSchema: revisionResponse,
};

export const postConfigRevisionRebaseValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/rebase",
  operationId: "postConfigRevisionRebase",
  summary: "Rebase a draft revision onto the current live config",
  description:
    "Updates the draft's base snapshot to the current live state, applying the draft's changes on top. Supply `conflictResolutions` to resolve any conflicting fields. Strategies are `overwrite` (use the draft's value), `discard` (keep the live value), or `union` (merge arrays without duplicates — for array fields like `extends`; pass a `customValues` entry to supply the resolved array yourself).",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      conflictResolutions: z
        .record(z.string(), z.enum(["overwrite", "discard", "union"]))
        .optional(),
      customValues: z
        .record(z.string(), z.array(z.unknown()))
        .optional()
        .describe(
          "Custom values to use for `union` strategy fields. Keyed by field name.",
        ),
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
    .object({
      autoPublishOnApproval: z.boolean().optional(),
      ...publishOverrideBodyFields,
    })
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

export const postConfigRevisionSchedulePublishValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/schedule-publish",
  operationId: "postConfigRevisionSchedulePublish",
  summary: "Schedule (or cancel) a deferred publish",
  description:
    "Arms a revision to publish automatically at a future time. Pass `scheduledPublishAt` as an RFC3339 timestamp in the future to arm, or `null` to cancel a pending schedule. Requires the `scheduled-revisions` commercial feature and publish permission on the config. A draft that still requires approval must request review first (or be armed with `bypassApproval` by a caller who can bypass).",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      scheduledPublishAt: z.string().nullable(),
      lockEdits: z.boolean().optional(),
      lockOthers: z.boolean().optional(),
      bypassApproval: z.boolean().optional(),
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConfigRevisionReopenValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/reopen",
  operationId: "postConfigRevisionReopen",
  summary: "Reopen a discarded revision",
  description:
    "Returns a previously discarded revision to `draft` status so it can be edited and published again. Only discarded revisions can be reopened.",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({}).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConfigRevisionRecallReviewValidator = {
  method: "post" as const,
  path: "/configs-revisions/:key/:version/recall-review",
  operationId: "postConfigRevisionRecallReview",
  summary: "Recall a review request",
  description:
    "Pulls a revision in review (`pending-review`, `changes-requested`, or `approved`) back to `draft`, clearing existing reviews and disarming any auto-publish-on-approval.",
  tags: ["config-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({}).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
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
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
  // Warnings channel: a lineage change can strip identical re-declarations of
  // the new ancestors' fields from the staged schema ("base wins").
  responseSchema: revisionResponseWithWarnings,
};

export const putConfigRevisionValueValidator = {
  method: "put" as const,
  path: "/configs-revisions/:key/:version/value",
  operationId: "putConfigRevisionValue",
  summary: "Update the value of a config draft revision",
  description:
    'Stages a new `value` (this config\'s own JSON object) on the draft. Pass `version: "new"` to auto-create a draft. A `@config:` inheritance entry in the value is rejected — express lineage via the `parent`/`extends` metadata fields instead. Configs are environment-agnostic: there is no per-environment override (use a Constant for that).\n\nInheritance is a deep (targeted) patch: this value is merged onto the resolved parent recursively, key by key — restate only the leaves you want to change and the rest are inherited. Arrays and scalars replace wholesale, `null` is a value (it does not delete a key), and a value composed from a constant via `$extends` is applied whole.\n\nSet `inferSchemaIfMissing: true` to derive and stage a field schema from the value when the config has none yet.',
  tags: ["config-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      value: configValueObject
        .optional()
        .describe(
          "This config's own value as a JSON object — a targeted patch deep-merged onto the resolved parent value.",
        ),
      inferSchemaIfMissing: z
        .boolean()
        .optional()
        .describe(
          "When the config has no schema yet, infer one from the supplied `value` and stage it on the same draft.",
        ),
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
  responseSchema: revisionResponseWithWarnings,
};

export const putConfigRevisionSchemaValidator = {
  method: "put" as const,
  path: "/configs-revisions/:key/:version/schema",
  operationId: "putConfigRevisionSchema",
  summary: "Update or import the schema of a config draft revision",
  description:
    'Stages this config\'s field schema on the draft. Provide exactly ONE source:\n- `schema`: a schema document — `{ type: "json-schema", value }` (a JSON Schema object) or `{ type: "typescript", value }` (TypeScript source). **JSON Schema is the recommended ("happy path") format** — it is the canonical pivot, preserves nested objects/arrays, and resolves local `$ref`/`$defs` (so generator output with referenced types works). `typescript` is a best-effort convenience parser. All conversions are lossy-by-design and degrade exotic constructs to permissive types WITH warnings (returned in `warnings`).\n- `infer: true`: derive the schema from the draft\'s value.\n\nFields whose key a published ancestor already owns follow "base wins": an identical re-declaration is stripped with a `redundant-declaration` warning; one with a differing definition is rejected. Pass `version: "new"` to auto-create a draft.',
  tags: ["config-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      schema: configSchemaSourceValidator.optional(),
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
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
  responseSchema: revisionResponseWithWarnings,
};

export const putConfigRevisionProjectionValidator = {
  method: "put" as const,
  path: "/configs-revisions/:key/:version/projection",
  operationId: "putConfigRevisionProjection",
  summary: "Set (or update) a config's per-source render projection on a draft",
  description:
    'Stages a per-source render projection on the draft, AND the schema it implies. Provide a named `schema` source (`{ type: "typescript" | "protobuf" | "python" | "go" | "rust" | "json-schema", value }`) for the consuming codebase identified by `source`: GrowthBook derives the config\'s canonical schema from it (so the change projects into the Config) and captures that source\'s named-type structure under `renderProjections[source]`. Both are staged on the draft and published through the normal flow. Pass `version: "new"` to auto-create a draft. Lossy conversions degrade with `warnings`.',
  tags: ["config-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      source: z
        .string()
        .describe(
          "Identifier of the consuming codebase/service this projection belongs to.",
        ),
      schema: configSchemaSourceValidator.describe(
        "The named schema source for this projection. Its type names are captured; its structure derives the config's canonical schema.",
      ),
      additionalProperties: z
        .boolean()
        .optional()
        .describe(
          "Whether the resulting object schema permits extra keys (family extensibility).",
        ),
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
  responseSchema: revisionResponseWithWarnings,
};

export const deleteConfigRevisionProjectionValidator = {
  method: "delete" as const,
  path: "/configs-revisions/:key/:version/projection",
  operationId: "deleteConfigRevisionProjection",
  summary: "Remove a config's per-source render projection on a draft",
  description:
    'Stages removal of the `source` projection from `renderProjections` on the draft (the canonical schema is unchanged). Published through the normal flow. Pass `version: "new"` to auto-create a draft.',
  tags: ["config-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z.never(),
  querySchema: z
    .object({
      source: z
        .string()
        .describe("Identifier of the projection (source) to remove."),
    })
    .strict(),
  responseSchema: revisionResponse,
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
    .object({
      ...newDraftMetadataFields,
      archived: z.boolean(),
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};
