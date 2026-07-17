import { z } from "zod";
import {
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
  publishOverrideBodyFields,
} from "./shared";
import { apiConstantValidator } from "./constant";
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

// Constants are addressed by their immutable, org-unique `key`.
const constantKeyParams = z.object({ key: z.string() });

/** Version param that also accepts the literal string "new" to auto-create a draft. */
export const constantRevisionVersionParam = z.union([
  z.coerce.number().int(),
  z.literal("new"),
]);

const revisionParams = constantKeyParams.extend({
  version: constantRevisionVersionParam,
});

const revisionParamsStrict = constantKeyParams.extend({
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
  "ConstantRevisionReview",
  reviewValidator
    .omit({ dateCreated: true })
    .extend({ dateCreated: z.string().meta({ format: "date-time" }) })
    .strict(),
);

const apiActivityLogEntryValidator = namedSchema(
  "ConstantRevisionActivityLogEntry",
  activityLogEntryValidator
    .omit({ dateCreated: true })
    .extend({ dateCreated: z.string().meta({ format: "date-time" }) })
    .strict(),
);

// API-facing revision projection. Hides the raw `target` shape used internally
// and surfaces the constant view directly (mirrors saved-group revisions).
export const apiConstantRevisionValidator = namedSchema(
  "ConstantRevision",
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
      // Snapshot of the constant at the time the revision was created.
      baseConstant: apiConstantValidator,
      // The constant with this revision's proposed changes applied — what it
      // would look like if merged against its current snapshot.
      proposedConstant: apiConstantValidator,
      // Raw JSON Patch ops (RFC 6902); escape hatch for inspecting deltas.
      proposedChanges: z.array(jsonPatchOperationValidator),
    })
    .strict(),
);

export type ApiConstantRevision = z.infer<typeof apiConstantRevisionValidator>;

const revisionResponse = z.object({
  revision: apiConstantRevisionValidator,
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

export const listConstantRevisionsValidator = {
  method: "get" as const,
  path: "/constants-revisions",
  operationId: "listConstantRevisions",
  summary: "List constant revisions across the organization",
  description:
    "Returns a paginated list of revisions across all constants in the organization, sorted newest-first. Optionally filtered by constant, status, author, or the calling user's involvement.",
  tags: ["constant-revisions"],
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
          "Restrict results to revisions for a single constant (by its key). When omitted, returns revisions across every constant the caller can read.",
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
    .object({ revisions: z.array(apiConstantRevisionValidator) })
    .extend(apiPaginationFieldsValidator.shape),
};

export const getConstantRevisionsValidator = {
  method: "get" as const,
  path: "/constants-revisions/:key",
  operationId: "getConstantRevisions",
  summary: "List revisions for a constant",
  description:
    "Returns a paginated list of revisions for this constant, sorted newest-first. Optionally filtered by status, author, or the calling user's involvement.",
  tags: ["constant-revisions"],
  paramsSchema: constantKeyParams,
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
    .object({ revisions: z.array(apiConstantRevisionValidator) })
    .extend(apiPaginationFieldsValidator.shape),
  exampleRequest: { params: { key: "config-snippet" } },
};

export const getConstantRevisionLatestValidator = {
  method: "get" as const,
  path: "/constants-revisions/:key/latest",
  operationId: "getConstantRevisionLatest",
  summary: "Get the most recent active draft revision",
  description:
    "Returns the most recently updated open (non-merged, non-discarded) revision for the constant. Returns 404 if there is no active draft. Pass `mine=true` to restrict to drafts authored by the calling user (requires a user-scoped API key).",
  tags: ["constant-revisions"],
  paramsSchema: constantKeyParams,
  bodySchema: z.never(),
  querySchema: z
    .object({
      mine: booleanQueryField.describe(
        "If true, return only the most recent active draft authored by the calling user. Requires a user-scoped API key.",
      ),
    })
    .strict(),
  responseSchema: revisionResponse,
  exampleRequest: { params: { key: "config-snippet" } },
};

export const getConstantRevisionValidator = {
  method: "get" as const,
  path: "/constants-revisions/:key/:version",
  operationId: "getConstantRevision",
  summary: "Get a single constant revision",
  description:
    "Returns the revision at the specified version for this constant. Use `GET /constants-revisions/{key}/latest` for the most recent active draft.",
  tags: ["constant-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: { params: { key: "config-snippet", version: 3 } },
};

export const getConstantRevisionMergeStatusValidator = {
  method: "get" as const,
  path: "/constants-revisions/:key/:version/merge-status",
  operationId: "getConstantRevisionMergeStatus",
  summary: "Get merge status for a draft revision",
  description:
    "Runs a dry-run merge of the draft against the current live constant and returns any conflicts. Use this before publishing to preview changes and detect conflicting edits.",
  tags: ["constant-revisions"],
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

export const postConstantRevisionValidator = {
  method: "post" as const,
  path: "/constants-revisions/:key",
  operationId: "postConstantRevision",
  summary: "Create a draft revision",
  description:
    "Creates a new draft revision branched from the current live constant. A constant can have multiple concurrent drafts; use this to start an isolated line of edits.",
  tags: ["constant-revisions"],
  paramsSchema: constantKeyParams,
  bodySchema: z
    .object({ title: z.string().optional(), comment: z.string().optional() })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConstantRevisionDiscardValidator = {
  method: "post" as const,
  path: "/constants-revisions/:key/:version/discard",
  operationId: "postConstantRevisionDiscard",
  summary: "Discard a draft revision",
  description:
    "Permanently discards a draft revision. Only open revisions (not merged or already-discarded) can be discarded.",
  tags: ["constant-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({ reason: z.string().optional() }).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConstantRevisionPublishValidator = {
  method: "post" as const,
  path: "/constants-revisions/:key/:version/publish",
  operationId: "postConstantRevisionPublish",
  summary: "Publish a draft revision",
  description:
    "Publishes a draft revision, making it the live state of the constant. Blocked if the org requires approvals and the revision is not approved (callers with the bypass-approval permission may still publish).",
  tags: ["constant-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({ ...publishOverrideBodyFields }).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConstantRevisionRevertValidator = {
  method: "post" as const,
  path: "/constants-revisions/:key/:version/revert",
  operationId: "postConstantRevisionRevert",
  summary: "Revert the constant to a prior revision",
  description:
    "Creates a new draft (or immediately publishes) whose content matches the specified historical revision. Defaults to creating a draft; when the org enables 'reverts bypass approval' it defaults to publishing immediately. Pass `strategy` to override.",
  tags: ["constant-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      strategy: z.enum(["draft", "publish"]).optional(),
      title: z.string().optional(),
      comment: z.string().optional(),
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postConstantRevisionRebaseValidator = {
  method: "post" as const,
  path: "/constants-revisions/:key/:version/rebase",
  operationId: "postConstantRevisionRebase",
  summary: "Rebase a draft revision onto the current live constant",
  description:
    "Updates the draft's base snapshot to the current live state, applying the draft's changes on top. Supply `conflictResolutions` to resolve any conflicting fields. Strategies are `overwrite` (use the draft's value) or `discard` (keep the live value).",
  tags: ["constant-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      // No `union` strategy: constants have no list/array field to merge (their
      // content is a scalar `value` + an `environmentValues` map).
      conflictResolutions: z
        .record(z.string(), z.enum(["overwrite", "discard"]))
        .optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

// ---- Approval endpoint validators ----

export const postConstantRevisionRequestReviewValidator = {
  method: "post" as const,
  path: "/constants-revisions/:key/:version/request-review",
  operationId: "postConstantRevisionRequestReview",
  summary: "Request review for a draft revision",
  description:
    "Moves the draft from `draft` into `pending-review`. Notifies reviewers per the org's approval-flow settings.\n\nSet `autoPublishOnApproval` to `true` to publish the revision automatically the moment it is approved. This requires the org to have auto-publish-on-approval enabled and the caller to have publish permission on the constant.",
  tags: ["constant-revisions"],
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

export const postConstantRevisionSubmitReviewValidator = {
  method: "post" as const,
  path: "/constants-revisions/:key/:version/submit-review",
  operationId: "postConstantRevisionSubmitReview",
  summary: "Submit a review on a draft revision",
  description:
    "Submits an `approve`, `request-changes`, or `comment` review on the revision. Authors and contributors cannot submit `approve` reviews on their own drafts when the org has `blockSelfApproval` enabled.\n\nWhen `decision` is `approve` and the revision has `autoPublishOnApproval` enabled, the revision is automatically published after approval. The response includes `autoPublished: true` when this happens. Pass `skipAutoPublish: true` to approve without triggering auto-publish.",
  tags: ["constant-revisions"],
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

export const putConstantRevisionMetadataValidator = {
  method: "put" as const,
  path: "/constants-revisions/:key/:version/metadata",
  operationId: "putConstantRevisionMetadata",
  summary: "Update constant metadata in a draft revision",
  description:
    'Stages metadata changes (name, owner, description, project) on the draft. Pass `version: "new"` to auto-create a draft. The change is only applied to the live constant when the revision is merged.',
  tags: ["constant-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      name: z.string().optional(),
      owner: ownerInputField.optional(),
      description: z.string().optional(),
      project: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putConstantRevisionValueValidator = {
  method: "put" as const,
  path: "/constants-revisions/:key/:version/value",
  operationId: "putConstantRevisionValue",
  summary: "Update the value of a constant draft revision",
  description:
    'Stages a new default `value` and/or per-environment `environmentValues` on the draft. At least one must be supplied. Pass `version: "new"` to auto-create a draft. The value must match the constant\'s type (valid JSON for `json` constants).',
  tags: ["constant-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      value: z
        .string()
        .optional()
        .describe(
          "The default value (raw string for `string` constants, JSON-encoded for `json` constants)",
        ),
      environmentValues: z
        .record(z.string(), z.string())
        .optional()
        .describe("Per-environment value overrides (environment id → value)"),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putConstantRevisionArchiveValidator = {
  method: "put" as const,
  path: "/constants-revisions/:key/:version/archive",
  operationId: "putConstantRevisionArchive",
  summary: "Stage an archive/unarchive in a draft revision",
  description:
    'Stages an archive or unarchive on the draft. Pass `version: "new"` to auto-create a draft. Archived constants can be permanently deleted via `DELETE /constants/{key}` once the archive is published.',
  tags: ["constant-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({ ...newDraftMetadataFields, archived: z.boolean() })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};
