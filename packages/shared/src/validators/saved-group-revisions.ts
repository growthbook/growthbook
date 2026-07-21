import { z } from "zod";
import {
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
  ignoreWarningsBodyField,
  bypassApprovalPublishBodyField,
  publishBypassedGatesField,
} from "./shared";
import { apiSavedGroupValidator } from "./saved-group";
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

const savedGroupIdParams = z.object({ savedGroupId: z.string() });

/** Version param that also accepts the literal string "new" to auto-create a draft. */
export const savedGroupRevisionVersionParam = z.union([
  z.coerce.number().int(),
  z.literal("new"),
]);

const revisionParams = savedGroupIdParams.extend({
  version: savedGroupRevisionVersionParam,
});

const revisionParamsStrict = savedGroupIdParams.extend({
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

// API-facing review object — matches Review from shared/enterprise but
// serializes `dateCreated` as an ISO string instead of a `Date`.
const apiReviewValidator = namedSchema(
  "SavedGroupRevisionReview",
  reviewValidator
    .omit({ dateCreated: true })
    .extend({
      dateCreated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

// API-facing activity log entry — matches ActivityLogEntry from shared/enterprise.
const apiActivityLogEntryValidator = namedSchema(
  "SavedGroupRevisionActivityLogEntry",
  activityLogEntryValidator
    .omit({ dateCreated: true })
    .extend({
      dateCreated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

// API-facing revision projection. Hides the raw `target` shape used internally
// and surfaces the saved-group view directly. Mirrors how feature revisions
// expose their domain model in `apiFeatureRevisionValidator`.
export const apiSavedGroupRevisionValidator = namedSchema(
  "SavedGroupRevision",
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
      // Snapshot of the saved group at the time the revision was created.
      baseSavedGroup: apiSavedGroupValidator,
      // The saved group with this revision's proposed changes applied — i.e.
      // what the saved group would look like if the revision were merged
      // against its current snapshot. Useful for previewing changes without
      // having to interpret the raw JSON Patch ops.
      proposedSavedGroup: apiSavedGroupValidator,
      // Raw JSON Patch ops (RFC 6902). Most callers can ignore this and use
      // `baseSavedGroup` / `proposedSavedGroup`; provided as an escape hatch
      // for callers who want to inspect the deltas directly.
      proposedChanges: z.array(jsonPatchOperationValidator),
    })
    .strict(),
);

export type ApiSavedGroupRevision = z.infer<
  typeof apiSavedGroupRevisionValidator
>;

const revisionResponse = z.object({
  revision: apiSavedGroupRevisionValidator,
});

// Mirrors the shape of `Conflict` returned by checkMergeConflicts in
// shared/src/revisions/helpers.ts. The `*Value` fields are typed as `unknown`
// because conflicts can be on any saved-group field.
const mergeConflictSchema = z
  .object({
    field: z.string(),
    baseValue: z.unknown(),
    liveValue: z.unknown(),
    proposedValue: z.unknown(),
  })
  .strict();

// ---- Read endpoint validators ----

export const listSavedGroupRevisionsValidator = {
  method: "get" as const,
  path: "/saved-groups-revisions",
  operationId: "listSavedGroupRevisions",
  summary: "List saved-group revisions across the organization",
  description:
    "Returns a paginated list of revisions across all saved groups in the organization, sorted newest-first. Optionally filtered by saved group, status, author, or the calling user's involvement.",
  tags: ["saved-group-revisions"],
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      ...skipPaginationQueryField,
      savedGroupId: z
        .string()
        .optional()
        .describe(
          "Restrict results to revisions for a single saved group. When omitted, returns revisions across every saved group the caller can read.",
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
    .object({
      revisions: z.array(apiSavedGroupRevisionValidator),
    })
    .extend(apiPaginationFieldsValidator.shape),
};

export const getSavedGroupRevisionsValidator = {
  method: "get" as const,
  path: "/saved-groups-revisions/:savedGroupId",
  operationId: "getSavedGroupRevisions",
  summary: "List revisions for a saved group",
  description:
    "Returns a paginated list of revisions for this saved group, sorted newest-first. Optionally filtered by status, author, or the calling user's involvement.",
  tags: ["saved-group-revisions"],
  paramsSchema: savedGroupIdParams,
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
    .object({
      revisions: z.array(apiSavedGroupRevisionValidator),
    })
    .extend(apiPaginationFieldsValidator.shape),
  exampleRequest: { params: { savedGroupId: "grp_abc123" } },
};

export const getSavedGroupRevisionLatestValidator = {
  method: "get" as const,
  path: "/saved-groups-revisions/:savedGroupId/latest",
  operationId: "getSavedGroupRevisionLatest",
  summary: "Get the most recent active draft revision",
  description:
    "Returns the most recently updated open (non-merged, non-discarded) revision for the saved group. Returns 404 if there is no active draft. Pass `mine=true` to restrict to drafts authored by the calling user (requires a user-scoped API key).",
  tags: ["saved-group-revisions"],
  paramsSchema: savedGroupIdParams,
  bodySchema: z.never(),
  querySchema: z
    .object({
      mine: booleanQueryField.describe(
        "If true, return only the most recent active draft authored by the calling user. Requires a user-scoped API key.",
      ),
    })
    .strict(),
  responseSchema: revisionResponse,
  exampleRequest: { params: { savedGroupId: "grp_abc123" } },
};

export const getSavedGroupRevisionValidator = {
  method: "get" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version",
  operationId: "getSavedGroupRevision",
  summary: "Get a single saved group revision",
  description:
    "Returns the revision at the specified version for this saved group. Use `GET /saved-groups-revisions/{savedGroupId}/latest` for the most recent active draft.",
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: { params: { savedGroupId: "grp_abc123", version: 3 } },
};

export const getSavedGroupRevisionMergeStatusValidator = {
  method: "get" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/merge-status",
  operationId: "getSavedGroupRevisionMergeStatus",
  summary: "Get merge status for a draft revision",
  description:
    "Runs a dry-run merge of the draft against the current live saved group and returns any conflicts. Use this before publishing to preview changes and detect conflicting edits.",
  tags: ["saved-group-revisions"],
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

export const postSavedGroupRevisionValidator = {
  method: "post" as const,
  path: "/saved-groups-revisions/:savedGroupId",
  operationId: "postSavedGroupRevision",
  summary: "Create a draft revision",
  description:
    "Creates a new draft revision branched from the current live saved group. A saved group can have multiple concurrent drafts; use this to start an isolated line of edits.",
  tags: ["saved-group-revisions"],
  paramsSchema: savedGroupIdParams,
  bodySchema: z
    .object({
      title: z.string().optional(),
      comment: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postSavedGroupRevisionDiscardValidator = {
  method: "post" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/discard",
  operationId: "postSavedGroupRevisionDiscard",
  summary: "Discard a draft revision",
  description:
    "Permanently discards a draft revision. Only open revisions (not merged or already-discarded) can be discarded.",
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      reason: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postSavedGroupRevisionPublishValidator = {
  method: "post" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/publish",
  operationId: "postSavedGroupRevisionPublish",
  summary: "Publish a draft revision",
  description:
    "Publishes a draft revision, making it the live state of the saved group. Blocked if the org requires approvals and the revision is not approved (callers with the bypass-approval permission may still publish). Under `requireRebaseBeforePublish`, a draft whose base has moved since it was created is blocked until rebased — a caller with the bypass-approval permission can force-merge instead by passing `ignoreWarnings: true` (the permission alone does not silently skip the rebase). When blocked, the 422 lists every applicable gate and how to clear each (see the response docs).",
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      mergeNow: z
        .boolean()
        .optional()
        .describe("Deprecated — pass `ignoreWarnings: true` instead.")
        .meta({ deprecated: true }),
      bypassApproval: bypassApprovalPublishBodyField,
      ignoreWarnings: ignoreWarningsBodyField,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse.extend({
    bypassedGates: publishBypassedGatesField,
  }),
};

export const postSavedGroupRevisionRevertValidator = {
  method: "post" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/revert",
  operationId: "postSavedGroupRevisionRevert",
  summary: "Revert the saved group to a prior revision",
  description:
    "Creates a new draft (or immediately publishes) whose content matches the specified historical revision. Defaults to creating a draft; when the org enables 'reverts bypass approval' it defaults to publishing immediately. Pass `strategy` to override.",
  tags: ["saved-group-revisions"],
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

export const postSavedGroupRevisionRebaseValidator = {
  method: "post" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/rebase",
  operationId: "postSavedGroupRevisionRebase",
  summary: "Rebase a draft revision onto the current live saved group",
  description:
    "Updates the draft's base snapshot to the current live state, applying the draft's changes on top. Supply `conflictResolutions` to resolve any conflicting fields. Strategies are `overwrite` (use the draft's value), `discard` (keep the live value), or `union` (merge arrays — use only on `values`). Optimistic locking is not enforced by this endpoint; callers who need strict locking should call `merge-status` before and after.",
  tags: ["saved-group-revisions"],
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

export const postSavedGroupRevisionRequestReviewValidator = {
  method: "post" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/request-review",
  operationId: "postSavedGroupRevisionRequestReview",
  summary: "Request review for a draft revision",
  description:
    "Moves the draft from `draft` into `pending-review`. Notifies reviewers per the org's approval-flow settings.\n\nSet `autoPublishOnApproval` to `true` to publish the revision automatically the moment it is approved (GitHub auto-merge model). This requires the org to have auto-publish-on-approval enabled and the caller to have publish permission on the saved group; the auto-publish then executes with the caller's authority.",
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      autoPublishOnApproval: z.boolean().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postSavedGroupRevisionSubmitReviewValidator = {
  method: "post" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/submit-review",
  operationId: "postSavedGroupRevisionSubmitReview",
  summary: "Submit a review on a draft revision",
  description:
    "Submits an `approve`, `request-changes`, or `comment` review on the revision. Authors and contributors cannot submit `approve` reviews on their own drafts when the org has `blockSelfApproval` enabled.\n\nWhen `decision` is `approve` and the revision has `autoPublishOnApproval` enabled, the revision is automatically published after approval. The response includes `autoPublished: true` when this happens. Pass `skipAutoPublish: true` to approve without triggering auto-publish.",
  tags: ["saved-group-revisions"],
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

export const putSavedGroupRevisionMetadataValidator = {
  method: "put" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/metadata",
  operationId: "putSavedGroupRevisionMetadata",
  summary: "Update saved group metadata in a draft revision",
  description:
    'Stages metadata changes (name, owner, description, projects) on the draft. Pass `version: "new"` to auto-create a draft. The change is only applied to the live saved group when the revision is merged.',
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      name: z.string().optional(),
      owner: ownerInputField.optional(),
      description: z.string().optional(),
      projects: z.array(z.string()).optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putSavedGroupRevisionConditionValidator = {
  method: "put" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/condition",
  operationId: "putSavedGroupRevisionCondition",
  summary: "Update the condition of a condition saved group draft revision",
  description:
    'Stages a new JSON-encoded condition for the draft. Only valid for `condition` saved groups. Pass `version: "new"` to auto-create a draft.',
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      condition: z
        .string()
        .describe("The JSON-encoded condition for the saved group"),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putSavedGroupRevisionValuesValidator = {
  method: "put" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/values",
  operationId: "putSavedGroupRevisionValues",
  summary: "Replace the values list in a list saved group draft revision",
  description:
    'Replaces the entire `values` array atomically. Only valid for `list` saved groups. For safe concurrent updates against a draft, prefer `POST .../items/add` and `POST .../items/remove`. Pass `version: "new"` to auto-create a draft.',
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      values: z.array(z.string()),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putSavedGroupRevisionArchiveValidator = {
  method: "put" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/archive",
  operationId: "putSavedGroupRevisionArchive",
  summary: "Stage an archive/unarchive in a draft revision",
  description:
    'Stages an archive or unarchive on the draft. Pass `version: "new"` to auto-create a draft. Archived saved groups can be permanently deleted via `DELETE /saved-groups/{id}` once the archive is published.',
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      archived: z.boolean(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postSavedGroupRevisionItemsAddValidator = {
  method: "post" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/items/add",
  operationId: "postSavedGroupRevisionItemsAdd",
  summary: "Append items to a list saved group draft revision",
  description:
    'Appends the provided items (deduplicated) to the draft\'s `values` array. Only valid for `list` saved groups. Pass `version: "new"` to auto-create a draft. Duplicate items are merged on top of any existing draft, so multiple successive add/remove calls accumulate.',
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      items: z.array(z.string()),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postSavedGroupRevisionItemsRemoveValidator = {
  method: "post" as const,
  path: "/saved-groups-revisions/:savedGroupId/:version/items/remove",
  operationId: "postSavedGroupRevisionItemsRemove",
  summary: "Remove items from a list saved group draft revision",
  description:
    'Removes the provided items from the draft\'s `values` array. Only valid for `list` saved groups. Pass `version: "new"` to auto-create a draft.',
  tags: ["saved-group-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      items: z.array(z.string()),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

// ---- Exported types for use in back-end handlers ----

export type SavedGroupRevisionApiShape = ApiSavedGroupRevision;
export type SavedGroupRevisionMetadataBody = z.infer<
  typeof putSavedGroupRevisionMetadataValidator.bodySchema
>;
export type SavedGroupRevisionConditionBody = z.infer<
  typeof putSavedGroupRevisionConditionValidator.bodySchema
>;
export type SavedGroupRevisionValuesBody = z.infer<
  typeof putSavedGroupRevisionValuesValidator.bodySchema
>;
export type SavedGroupRevisionArchiveBody = z.infer<
  typeof putSavedGroupRevisionArchiveValidator.bodySchema
>;
export type SavedGroupRevisionItemsBody = z.infer<
  typeof postSavedGroupRevisionItemsAddValidator.bodySchema
>;
