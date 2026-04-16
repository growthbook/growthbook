import { z } from "zod";
import {
  featurePrerequisite,
  savedGroupTargeting,
  paginationQueryFields,
} from "./shared";
import {
  apiRevisionRampCreateAction,
  apiFeatureRevisionValidator,
  JSONSchemaDef,
} from "./features";
import { ownerInputField } from "./owner-field";

// ---- Shared param schemas ----

const idParams = z.object({ id: z.string() });

/** Version param that also accepts the literal string "new" to auto-create a draft. */
export const revisionVersionParam = z.union([
  z.coerce.number().int(),
  z.literal("new"),
]);

const revisionParams = idParams.extend({
  version: revisionVersionParam,
});

const revisionParamsStrict = idParams.extend({
  version: z.coerce.number().int(),
});

const ruleParams = revisionParams.extend({ ruleId: z.string() });

// ---- Shared response schemas ----

const revisionResponse = z.object({ revision: apiFeatureRevisionValidator });

// ---- Ramp schedule body schemas ----

export const inlineRampScheduleInput = apiRevisionRampCreateAction.omit({
  mode: true,
  ruleId: true,
  environment: true,
});

export const standaloneRampScheduleInput = inlineRampScheduleInput.extend({
  environment: z.string(),
});

// ---- Endpoint validators ----

export const getFeatureRevisionValidator = {
  method: "get" as const,
  path: "/features/:id/revisions/:version",
  operationId: "getFeatureRevision",
  summary: "Get a single feature revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const getFeatureRevisionLatestValidator = {
  method: "get" as const,
  path: "/features/:id/revisions/latest",
  operationId: "getFeatureRevisionLatest",
  summary: "Get the most recent active draft revision",
  description:
    "Returns the most recently updated draft revision for the feature. Returns 404 if there is no active draft.",
  tags: ["feature-revisions"],
  paramsSchema: idParams,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postFeatureRevisionValidator = {
  method: "post" as const,
  path: "/features/:id/revisions",
  operationId: "postFeatureRevision",
  summary: "Create a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: idParams,
  bodySchema: z
    .object({
      comment: z.string().optional(),
      title: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postFeatureRevisionDiscardValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/discard",
  operationId: "postFeatureRevisionDiscard",
  summary: "Discard a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({}).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postFeatureRevisionPublishValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/publish",
  operationId: "postFeatureRevisionPublish",
  summary: "Publish a draft revision",
  description:
    "Immediately publishes a draft revision, making it the live version of the feature. Blocked if the org requires approvals and `bypassApprovalChecks` is off.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      comment: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postFeatureRevisionRevertValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/revert",
  operationId: "postFeatureRevisionRevert",
  summary: "Revert the feature to a prior revision",
  description:
    "Creates a new draft (or immediately publishes) whose content matches the specified historical revision.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      strategy: z.enum(["draft", "publish"]).optional(),
      comment: z.string().optional(),
      title: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const getFeatureRevisionMergeStatusValidator = {
  method: "get" as const,
  path: "/features/:id/revisions/:version/merge-status",
  operationId: "getFeatureRevisionMergeStatus",
  summary: "Get merge status for a draft revision",
  description:
    "Runs a dry-run merge of the draft against the current live revision and returns any conflicts.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({
    success: z.boolean(),
    conflicts: z.array(z.unknown()),
    result: z.unknown().optional(),
  }),
};

export const postFeatureRevisionRebaseValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rebase",
  operationId: "postFeatureRevisionRebase",
  summary: "Rebase a draft revision onto the current live version",
  tags: ["feature-revisions"],
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

export const postFeatureRevisionRequestReviewValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/request-review",
  operationId: "postFeatureRevisionRequestReview",
  summary: "Request review for a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      comment: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postFeatureRevisionSubmitReviewValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/submit-review",
  operationId: "postFeatureRevisionSubmitReview",
  summary: "Submit a review on a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      comment: z.string().optional(),
      action: z.enum(["approve", "request-changes", "comment"]).optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

// ---- Rule validators ----

const scheduleRuleInput = z.object({
  timestamp: z.string().nullable(),
  enabled: z.boolean(),
});

const scheduleShorthand = z.object({
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

const commonRuleFields = {
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
  scheduleRules: z.array(scheduleRuleInput).optional(),
  scheduleType: z.enum(["none", "schedule", "ramp"]).optional(),
};

const forceRolloutCreateInput = z.object({
  ...commonRuleFields,
  type: z.enum(["force", "rollout"]).optional(),
  value: z.string(),
  coverage: z.number().min(0).max(1).optional(),
  hashAttribute: z.string().optional(),
  seed: z.string().optional(),
});

const experimentRefCreateInput = z.object({
  ...commonRuleFields,
  type: z.literal("experiment-ref"),
  experimentId: z.string(),
  variations: z.array(
    z.object({ variationId: z.string().optional(), value: z.string() }),
  ),
});

const safeRolloutCreateInput = z.object({
  ...commonRuleFields,
  type: z.literal("safe-rollout"),
  controlValue: z.string(),
  variationValue: z.string(),
  hashAttribute: z.string(),
  trackingKey: z.string().optional(),
  seed: z.string().optional(),
  safeRolloutFields: z.object({
    datasourceId: z.string(),
    exposureQueryId: z.string(),
    guardrailMetricIds: z.array(z.string()),
    maxDuration: z.object({
      amount: z.number().positive(),
      unit: z.enum(["weeks", "days", "hours", "minutes"]),
    }),
    autoRollback: z.boolean().optional(),
    rampUpSchedule: z.object({ enabled: z.boolean() }).optional(),
  }),
});

const ruleCreateInput = z.union([
  experimentRefCreateInput,
  safeRolloutCreateInput,
  forceRolloutCreateInput,
]);

export const postFeatureRevisionRuleAddValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rules",
  operationId: "postFeatureRevisionRuleAdd",
  summary: "Add a rule to a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z.object({
    environment: z.string(),
    rule: ruleCreateInput,
    rampSchedule: inlineRampScheduleInput.optional(),
    schedule: scheduleShorthand.optional(),
  }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postFeatureRevisionRulesReorderValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rules/reorder",
  operationId: "postFeatureRevisionRulesReorder",
  summary: "Reorder rules in an environment",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z.object({
    environment: z.string(),
    ruleIds: z.array(z.string()),
  }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

const rulePatchSchema = z.object({
  ...commonRuleFields,
  type: z
    .enum(["force", "rollout", "experiment-ref", "safe-rollout"])
    .optional(),
  value: z.string().optional(),
  coverage: z.number().min(0).max(1).optional(),
  hashAttribute: z.string().optional(),
  seed: z.string().optional(),
  experimentId: z.string().optional(),
  variations: z
    .array(z.object({ variationId: z.string(), value: z.string() }))
    .optional(),
  controlValue: z.string().optional(),
  variationValue: z.string().optional(),
});

export const putFeatureRevisionRuleValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId",
  operationId: "putFeatureRevisionRule",
  summary: "Update a rule in a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: ruleParams,
  bodySchema: z.object({
    environment: z.string(),
    rule: rulePatchSchema,
    rampSchedule: inlineRampScheduleInput.optional(),
    schedule: scheduleShorthand.optional(),
  }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const deleteFeatureRevisionRuleValidator = {
  method: "delete" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId",
  operationId: "deleteFeatureRevisionRule",
  summary: "Delete a rule from a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: ruleParams,
  bodySchema: z.object({ environment: z.string() }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionRuleRampScheduleValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId/ramp-schedule",
  operationId: "putFeatureRevisionRuleRampSchedule",
  summary: "Set ramp schedule for a rule",
  tags: ["feature-revisions"],
  paramsSchema: ruleParams,
  bodySchema: standaloneRampScheduleInput,
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const deleteFeatureRevisionRuleRampScheduleValidator = {
  method: "delete" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId/ramp-schedule",
  operationId: "deleteFeatureRevisionRuleRampSchedule",
  summary: "Remove ramp schedule from a rule",
  tags: ["feature-revisions"],
  paramsSchema: ruleParams,
  bodySchema: z.object({ environment: z.string() }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

// ---- Field edit validators ----

export const postFeatureRevisionToggleValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/toggle",
  operationId: "postFeatureRevisionToggle",
  summary: "Toggle an environment on/off in a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z.object({
    environment: z.string(),
    enabled: z.boolean(),
  }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionDefaultValueValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/default-value",
  operationId: "putFeatureRevisionDefaultValue",
  summary: "Set the default value in a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z.object({ defaultValue: z.string() }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionPrerequisitesValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/prerequisites",
  operationId: "putFeatureRevisionPrerequisites",
  summary: "Set feature-level prerequisites in a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z.object({
    prerequisites: z.array(featurePrerequisite),
  }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionMetadataValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/metadata",
  operationId: "putFeatureRevisionMetadata",
  summary: "Update revision metadata (comment, title, feature metadata)",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z.object({
    comment: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    owner: ownerInputField.optional(),
    project: z.string().optional(),
    tags: z.array(z.string()).optional(),
    neverStale: z.boolean().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    jsonSchema: JSONSchemaDef.optional(),
  }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionArchiveValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/archive",
  operationId: "putFeatureRevisionArchive",
  summary: "Set archived state in a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z.object({ archived: z.boolean() }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionHoldoutValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/holdout",
  operationId: "putFeatureRevisionHoldout",
  summary: "Set holdout in a draft revision",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z.object({
    holdout: z.object({ id: z.string(), value: z.string() }).nullable(),
  }),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const listRevisionsValidator = {
  method: "get" as const,
  path: "/revisions",
  operationId: "listRevisions",
  summary: "List feature revisions",
  description:
    "Returns a paginated list of feature revisions across all features in the organization. Optionally filtered by feature, status, and/or author. Results are sorted newest-first.",
  tags: ["feature-revisions"],
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: z.object({
    ...paginationQueryFields,
    featureId: z.string().optional(),
    status: z
      .enum([
        "draft",
        "published",
        "discarded",
        "approved",
        "changes-requested",
        "pending-review",
        "pending-parent",
      ])
      .optional(),
    author: z.string().optional(),
  }),
  responseSchema: z.unknown(),
};

// ---- Exported types for use in back-end handlers ----

export type RuleCreateInput = z.infer<typeof ruleCreateInput>;
export type RulePatchInput = z.infer<typeof rulePatchSchema>;
