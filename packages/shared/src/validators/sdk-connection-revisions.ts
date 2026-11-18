import { z } from "zod";
import { omit } from "lodash";
import {
  apiEventUser,
  actorIdField,
  REQUIRES_PERSON_NOTE,
  REVIEW_VERDICT_NOTE,
} from "./event-user";
import {
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
  booleanQueryField,
  HUMAN_OVERRIDE_NOTE,
  sdkConnectionHookOverrideFields,
  publishBypassedGatesField,
  revisionScheduleResponseFields,
} from "./shared";
import {
  jsonPatchOperationValidator,
  reviewDecision,
  revisionStatus,
  activityLogEntryValidator,
  reviewValidator,
} from "./revisions";
import { namedSchema } from "./openapi-helpers";
import {
  NEW_DRAFT_COMMENT_DESCRIPTION,
  NEW_DRAFT_TITLE_DESCRIPTION,
  REVIEW_COMMENT_DESCRIPTION,
  REVISION_COMMENT_DESCRIPTION,
  REVISION_TITLE_DESCRIPTION,
} from "./api-field-descriptions";
import { PUBLISH_OVERRIDE_ACTIONS } from "./confirmations";
import {
  putSdkConnectionBody,
  sdkConnectionSettingsSnapshotValidator,
  sdkWebhookSnapshotValidator,
} from "./sdk-connections";
import { sdkWebhookFields } from "./webhooks";

const TAGS = ["sdk-connection-revisions"];
const BASE = "/sdk-connections-revisions/:id";
const EXAMPLE = { params: { id: "sdk_abc123", version: 3 } };

const connectionParams = z.object({
  id: z.string().describe("The SDK Connection id"),
});
const versionParams = connectionParams.extend({
  version: z.coerce.number().int(),
});
// Edit endpoints also take "new", which creates the draft they write to.
const editParams = connectionParams.extend({
  version: z.union([z.coerce.number().int(), z.literal("new")]),
});
const webhookParams = editParams.extend({
  webhookId: z.string().describe("The webhook's id in this revision"),
});

// On every edit endpoint. The title and comment are used only when `version`
// is "new".
const newDraftFields = {
  revisionTitle: z.string().describe(NEW_DRAFT_TITLE_DESCRIPTION).optional(),
  revisionComment: z
    .string()
    .describe(NEW_DRAFT_COMMENT_DESCRIPTION)
    .optional(),
  ...sdkConnectionHookOverrideFields,
};

const statusQuery = z
  .string()
  .refine(
    (val) =>
      val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => [...revisionStatus, "open"].includes(s)),
    {
      message: `status must be a comma-separated list of: ${[
        ...revisionStatus,
        "open",
      ].join(", ")}`,
    },
  )
  .optional()
  .describe(
    "Filter by revision status. Accepts a comma-separated list, or the literal `open` for non-merged/non-discarded revisions.",
  );

const apiReviewValidator = namedSchema(
  "SdkConnectionRevisionReview",
  reviewValidator
    .omit({ dateCreated: true, user: true })
    .extend({
      dateCreated: z.string().meta({ format: "date-time" }),
      user: apiEventUser.optional(),
    })
    .strict(),
);

const apiActivityLogEntryValidator = namedSchema(
  "SdkConnectionRevisionActivityLogEntry",
  activityLogEntryValidator
    .omit({ dateCreated: true, user: true })
    .extend({
      dateCreated: z.string().meta({ format: "date-time" }),
      user: apiEventUser.optional(),
    })
    .strict(),
);

const apiSdkConnectionRevisionSettingsValidator = namedSchema(
  "SdkConnectionRevisionSettings",
  sdkConnectionSettingsSnapshotValidator.omit({ organization: true }),
);

const apiSdkConnectionRevisionWebhookValidator = namedSchema(
  "SdkConnectionRevisionWebhook",
  sdkWebhookSnapshotValidator
    .extend({
      headers: z
        .string()
        .optional()
        .describe(
          "JSON-encoded object of extra headers. Only returned by the read endpoints, to callers who can edit the webhook.",
        ),
    })
    .strict(),
);

// A revision holds the connection's settings and its webhooks together, so one
// review covers both.
export const apiSdkConnectionRevisionValidator = namedSchema(
  "SdkConnectionRevision",
  z
    .object({
      id: z.string(),
      version: z.number().int().optional(),
      title: z.string().optional(),
      status: z.enum(revisionStatus),
      authorId: actorIdField,
      author: apiEventUser
        .optional()
        .describe("Who created the revision, with an API key's name"),
      contributors: z.array(z.string()).optional(),
      revertedFrom: z.string().optional(),
      reviews: z.array(apiReviewValidator),
      activityLog: z.array(apiActivityLogEntryValidator),
      ...revisionScheduleResponseFields,
      resolution: z
        .object({
          action: z.enum(["merged", "discarded"]),
          userId: actorIdField,
          user: apiEventUser.optional(),
          dateCreated: z.string().meta({ format: "date-time" }),
        })
        .strict()
        .optional(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      baseSdkConnection: apiSdkConnectionRevisionSettingsValidator.describe(
        "The settings when the revision was created",
      ),
      proposedSdkConnection: apiSdkConnectionRevisionSettingsValidator.describe(
        "The settings with this revision's changes applied",
      ),
      baseSdkWebhooks: z
        .array(apiSdkConnectionRevisionWebhookValidator)
        .describe("The webhooks when the revision was created"),
      proposedSdkWebhooks: z
        .array(apiSdkConnectionRevisionWebhookValidator)
        .describe("The webhooks with this revision's changes applied"),
      proposedChanges: z
        .array(jsonPatchOperationValidator)
        .describe(
          "The raw JSON Patch ops. Most callers can read the `proposed*` fields instead.",
        ),
    })
    .strict(),
);
export type ApiSdkConnectionRevision = z.infer<
  typeof apiSdkConnectionRevisionValidator
>;

const revisionResponse = z.object({
  revision: apiSdkConnectionRevisionValidator,
});

const listQuery = z
  .object({
    ...paginationQueryFields,
    ...skipPaginationQueryField,
    status: statusQuery,
    author: z.string().optional(),
    mine: booleanQueryField.describe(
      `If true, return only revisions authored by the calling user. ${REQUIRES_PERSON_NOTE} Mutually exclusive with \`author\`.`,
    ),
  })
  .strict();

export const listSdkConnectionRevisionsValidator = {
  method: "get" as const,
  path: "/sdk-connections-revisions",
  operationId: "listSdkConnectionRevisions",
  summary: "List SDK Connection revisions across the organization",
  description:
    "Returns revisions across every SDK Connection the caller can read, newest first. Use `status=open` to find the drafts waiting on a review or a publish.",
  tags: TAGS,
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: listQuery
    .extend({
      sdkConnectionId: z
        .string()
        .optional()
        .describe("Restrict results to revisions of a single SDK Connection."),
    })
    .strict(),
  responseSchema: z
    .object({ revisions: z.array(apiSdkConnectionRevisionValidator) })
    .extend(apiPaginationFieldsValidator.shape),
};

export const getSdkConnectionRevisionsValidator = {
  method: "get" as const,
  path: BASE,
  operationId: "getSdkConnectionRevisions",
  summary: "List revisions for an SDK Connection",
  description:
    "Returns this SDK Connection's revisions, newest first: its drafts and its published history.",
  tags: TAGS,
  paramsSchema: connectionParams,
  bodySchema: z.never(),
  querySchema: listQuery,
  responseSchema: z
    .object({ revisions: z.array(apiSdkConnectionRevisionValidator) })
    .extend(apiPaginationFieldsValidator.shape),
  exampleRequest: { params: { id: "sdk_abc123" } },
};

export const getSdkConnectionRevisionLatestValidator = {
  method: "get" as const,
  path: `${BASE}/latest`,
  operationId: "getSdkConnectionRevisionLatest",
  summary: "Get the most recent active draft revision",
  description:
    "Returns the most recently updated open (non-merged, non-discarded) revision. Returns 404 if there is none. Pass `mine=true` to restrict to drafts authored by the calling user.",
  tags: TAGS,
  paramsSchema: connectionParams,
  bodySchema: z.never(),
  querySchema: z
    .object({
      mine: booleanQueryField.describe(
        `If true, return only the most recent active draft authored by the calling user. ${REQUIRES_PERSON_NOTE}`,
      ),
    })
    .strict(),
  responseSchema: revisionResponse,
  exampleRequest: { params: { id: "sdk_abc123" } },
};

export const getSdkConnectionRevisionValidator = {
  method: "get" as const,
  path: `${BASE}/:version`,
  operationId: "getSdkConnectionRevision",
  summary: "Get a single SDK Connection revision",
  description:
    "Returns one revision: the settings and webhooks it started from, the ones it proposes, its reviews, and its activity.",
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: EXAMPLE,
};

export const getSdkConnectionRevisionMergeStatusValidator = {
  method: "get" as const,
  path: `${BASE}/:version/merge-status`,
  operationId: "getSdkConnectionRevisionMergeStatus",
  summary: "Get merge status for a draft revision",
  description:
    "Dry-runs a merge of the draft into the live SDK Connection and returns any conflicts. A draft whose base is out of date can be brought up to date with `rebase`.",
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z
    .object({
      success: z.boolean(),
      hasConflicts: z.boolean(),
      conflicts: z.array(
        z
          .object({
            field: z.string(),
            baseValue: z.unknown().optional(),
            liveValue: z.unknown().optional(),
            proposedValue: z.unknown().optional(),
          })
          .strict(),
      ),
      canAutoMerge: z.boolean(),
    })
    .strict(),
  exampleRequest: EXAMPLE,
};

export const postSdkConnectionRevisionValidator = {
  method: "post" as const,
  path: BASE,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "postSdkConnectionRevision",
  summary: "Create a draft revision",
  description:
    'Creates an empty draft from the live SDK Connection. The edit endpoints also create one when called with `version: "new"`.',
  tags: TAGS,
  paramsSchema: connectionParams,
  bodySchema: z
    .object({
      title: z.string().describe(REVISION_TITLE_DESCRIPTION).optional(),
      comment: z.string().describe(REVISION_COMMENT_DESCRIPTION).optional(),
      ...sdkConnectionHookOverrideFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: { params: { id: "sdk_abc123" }, body: {} },
};

export const putSdkConnectionRevisionSettingsValidator = {
  method: "put" as const,
  path: `${BASE}/:version/settings`,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "putSdkConnectionRevisionSettings",
  summary: "Update SDK Connection settings in a draft revision",
  description:
    'Stages settings changes on the draft. Takes the same fields as `PUT /sdk-connections/{id}`, and only the fields sent are changed. Pass `version: "new"` to create the draft. Nothing changes on the live SDK Connection until the revision is published.',
  tags: TAGS,
  paramsSchema: editParams,
  bodySchema: putSdkConnectionBody
    .omit({ archived: true, bypassApproval: true })
    .extend(newDraftFields)
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: {
    params: { id: "sdk_abc123", version: "new" as const },
    body: { includeRuleIds: true },
  },
};

export const putSdkConnectionRevisionArchiveValidator = {
  method: "put" as const,
  path: `${BASE}/:version/archive`,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "putSdkConnectionRevisionArchive",
  summary: "Stage an archive or restore in a draft revision",
  description:
    'Stages archiving (`true`) or restoring (`false`) the SDK Connection. Pass `version: "new"` to create the draft. An archived connection serves no payload, and can be deleted once the archive is published.',
  tags: TAGS,
  paramsSchema: editParams,
  bodySchema: z.object({ ...newDraftFields, archived: z.boolean() }).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: {
    params: { id: "sdk_abc123", version: "new" as const },
    body: { archived: true },
  },
};

const draftWebhookFields = omit(sdkWebhookFields, "bypassApproval");

export const postSdkConnectionRevisionWebhookValidator = {
  method: "post" as const,
  path: `${BASE}/:version/webhooks`,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "postSdkConnectionRevisionWebhook",
  summary: "Add a webhook in a draft revision",
  description:
    'Stages a new webhook on the draft. Its id is in the returned revision\'s `proposedSdkWebhooks`. Pass `version: "new"` to create the draft.',
  tags: TAGS,
  paramsSchema: editParams,
  bodySchema: z.object({ ...newDraftFields, ...draftWebhookFields }).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: {
    params: { id: "sdk_abc123", version: "new" as const },
    body: { name: "Purge CDN", endpoint: "https://example.com/purge" },
  },
};

export const putSdkConnectionRevisionWebhookValidator = {
  method: "put" as const,
  path: `${BASE}/:version/webhooks/:webhookId`,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "putSdkConnectionRevisionWebhook",
  summary: "Update a webhook in a draft revision",
  description:
    'Stages changes to one of the draft\'s webhooks. Only the fields sent are changed. Pass `version: "new"` to create the draft.',
  tags: TAGS,
  paramsSchema: webhookParams,
  bodySchema: z
    .object({
      ...newDraftFields,
      ...z.object(draftWebhookFields).partial().shape,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: {
    params: { id: "sdk_abc123", version: 3, webhookId: "wh_abc123" },
    body: { endpoint: "https://example.com/purge-v2" },
  },
};

export const deleteSdkConnectionRevisionWebhookValidator = {
  method: "delete" as const,
  path: `${BASE}/:version/webhooks/:webhookId`,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "deleteSdkConnectionRevisionWebhook",
  summary: "Remove a webhook in a draft revision",
  description:
    'Stages removing one of the SDK Connection\'s webhooks. Pass `version: "new"` to create the draft.',
  tags: TAGS,
  paramsSchema: webhookParams,
  bodySchema: z.object(newDraftFields).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: {
    params: { id: "sdk_abc123", version: 3, webhookId: "wh_abc123" },
  },
};

export const postSdkConnectionRevisionRequestReviewValidator = {
  method: "post" as const,
  path: `${BASE}/:version/request-review`,
  // Asking for review is draft work; arming a publish is a change to live.
  confirmation: ["sdkConnection.draft", "sdkConnection.edit"] as const,
  confirmationInHandler: true,
  operationId: "postSdkConnectionRevisionRequestReview",
  summary: "Request review for a draft revision",
  description:
    "Moves the draft into `pending-review`. Set `autoPublishOnApproval` to publish it the moment it is approved; that needs the organization to allow it and the caller to be able to publish the change.",
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: z
    .object({ autoPublishOnApproval: z.boolean().optional() })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: { ...EXAMPLE, body: {} },
};

export const postSdkConnectionRevisionSubmitReviewValidator = {
  method: "post" as const,
  path: `${BASE}/:version/submit-review`,
  confirmation: ["sdkConnection.review"] as const,
  operationId: "postSdkConnectionRevisionSubmitReview",
  summary: "Submit a review on a draft revision",
  description: `Submits an \`approve\`, \`request-changes\`, or \`comment\` review. ${REVIEW_VERDICT_NOTE} When the approval publishes a revision set to publish on approval, the response has \`autoPublished: true\`; pass \`skipAutoPublish: true\` to approve without publishing.`,
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: z
    .object({
      decision: z.enum(reviewDecision),
      comment: z.string().describe(REVIEW_COMMENT_DESCRIPTION).optional(),
      skipAutoPublish: z.boolean().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse.extend({
    autoPublished: z.boolean().optional(),
  }),
  exampleRequest: { ...EXAMPLE, body: { decision: "approve" as const } },
};

const emptyBody = z.object({}).strict();

export const postSdkConnectionRevisionRecallReviewValidator = {
  method: "post" as const,
  path: `${BASE}/:version/recall-review`,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "postSdkConnectionRevisionRecallReview",
  summary: "Recall a review request",
  description:
    "Returns a revision in review to `draft`, clearing its reviews and any publish-on-approval.",
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: emptyBody,
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: EXAMPLE,
};

export const postSdkConnectionRevisionUndoReviewValidator = {
  method: "post" as const,
  path: `${BASE}/:version/undo-review`,
  confirmation: ["sdkConnection.review"] as const,
  operationId: "postSdkConnectionRevisionUndoReview",
  summary: "Retract your own review verdict",
  description: `Retracts the calling user's own \`approve\` or \`request-changes\` verdict. ${REVIEW_VERDICT_NOTE}`,
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: emptyBody,
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: EXAMPLE,
};

export const postSdkConnectionRevisionReopenValidator = {
  method: "post" as const,
  path: `${BASE}/:version/reopen`,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "postSdkConnectionRevisionReopen",
  summary: "Reopen a discarded revision",
  description: "Returns a discarded revision to `draft`.",
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: emptyBody,
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: EXAMPLE,
};

export const postSdkConnectionRevisionRebaseValidator = {
  method: "post" as const,
  path: `${BASE}/:version/rebase`,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "postSdkConnectionRevisionRebase",
  summary: "Rebase a draft revision onto the live SDK Connection",
  description:
    "Moves the draft's base to the live state, keeping its changes on top. For each conflicting field (`sdkConnection` or `sdkWebhooks`), `conflictResolutions` picks `overwrite` (the draft's value) or `discard` (the live value).",
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: z
    .object({
      conflictResolutions: z
        .record(z.string(), z.enum(["overwrite", "discard"]))
        .optional(),
      ...sdkConnectionHookOverrideFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: EXAMPLE,
};

export const postSdkConnectionRevisionSchedulePublishValidator = {
  method: "post" as const,
  path: `${BASE}/:version/schedule-publish`,
  confirmation: ["sdkConnection.edit", ...PUBLISH_OVERRIDE_ACTIONS] as const,
  operationId: "postSdkConnectionRevisionSchedulePublish",
  summary: "Schedule (or cancel) a deferred publish",
  description:
    "Sets a revision to publish at a future time, or cancels that with `null`. Requires the `scheduled-revisions` commercial feature. A draft that still requires approval must request review first, unless the caller can bypass approval and passes `bypassApproval`.",
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: z
    .object({
      scheduledPublishAt: z
        .union([z.iso.datetime({ offset: true }), z.null()])
        .describe(
          "When to publish, as an RFC3339 timestamp, or `null` to cancel a pending schedule.",
        ),
      lockEdits: z.boolean().optional(),
      lockOthers: z.boolean().optional(),
      bypassApproval: z.boolean().optional(),
      ignoreWarnings: z
        .boolean()
        .optional()
        .describe(
          `Set to true to acknowledge a warning the publish would raise, such as a webhook that references a secret that doesn't exist, and schedule it anyway. The scheduled publish goes ahead with what was acknowledged. ${HUMAN_OVERRIDE_NOTE}`,
        ),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: {
    ...EXAMPLE,
    body: { scheduledPublishAt: "2027-01-31T09:00:00Z" },
  },
};

export const postSdkConnectionRevisionPublishValidator = {
  method: "post" as const,
  path: `${BASE}/:version/publish`,
  confirmation: ["sdkConnection.edit", ...PUBLISH_OVERRIDE_ACTIONS] as const,
  confirmationInHandler: true,
  operationId: "postSdkConnectionRevisionPublish",
  summary: "Publish a draft revision",
  description:
    "Applies the draft's changes to the live SDK Connection and its webhooks. When approval is required, the draft must be approved unless the caller has Bypass draft approvals access. A 422 response lists every blocking gate and how to resolve it.",
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: z.object(sdkConnectionHookOverrideFields).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse.extend({
    bypassedGates: publishBypassedGatesField,
  }),
  exampleRequest: EXAMPLE,
};

export const postSdkConnectionRevisionRevertValidator = {
  method: "post" as const,
  path: `${BASE}/:version/revert`,
  // A revert is staged as a draft or lands as a change to live.
  confirmation: [
    "sdkConnection.draft",
    "sdkConnection.edit",
    ...PUBLISH_OVERRIDE_ACTIONS,
  ] as const,
  confirmationInHandler: true,
  operationId: "postSdkConnectionRevisionRevert",
  summary: "Revert the SDK Connection to a prior revision",
  description:
    'Restores the settings and webhooks a published revision left the SDK Connection with. Creates a draft by default, or applies it now with `strategy: "publish"`. Whether the connection is archived is not restored. A webhook the revert brings back is recreated with a new signing key. When the revert is applied at once, its id is listed in `recreatedWebhookIds`.',
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: z
    .object({
      strategy: z
        .enum(["draft", "publish"])
        .optional()
        .describe(
          "Whether to stage the revert as a draft or publish it immediately. Defaults to `draft`, or to `publish` when the org enables 'reverts bypass approval'. Without that setting, publishing a revert that requires approval needs Bypass draft approvals access.",
        ),
      title: z.string().describe(REVISION_TITLE_DESCRIPTION).optional(),
      comment: z.string().describe(REVISION_COMMENT_DESCRIPTION).optional(),
      ...sdkConnectionHookOverrideFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse.extend({
    bypassedGates: publishBypassedGatesField,
    recreatedWebhookIds: z
      .array(z.string())
      .optional()
      .describe(
        "Webhooks this revert brought back, when it was applied at once. Each is created again with a new signing key, so a receiver that verifies signatures needs the new key from `GET /sdk-connections/{id}/webhooks`. A revert staged as a draft recreates them when the draft is published.",
      ),
  }),
  exampleRequest: EXAMPLE,
};

export const postSdkConnectionRevisionDiscardValidator = {
  method: "post" as const,
  path: `${BASE}/:version/discard`,
  confirmation: ["sdkConnection.draft"] as const,
  operationId: "postSdkConnectionRevisionDiscard",
  summary: "Discard a draft revision",
  description:
    "Abandons an open draft. A published or already discarded revision is refused.",
  tags: TAGS,
  paramsSchema: versionParams,
  bodySchema: z.object({ reason: z.string().optional() }).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  exampleRequest: EXAMPLE,
};
