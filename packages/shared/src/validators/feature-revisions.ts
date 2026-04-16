import { z } from "zod";
import {
  featurePrerequisite,
  savedGroupTargeting,
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
} from "./shared";
import {
  apiRevisionRampCreateAction,
  apiFeatureRevisionValidator,
  JSONSchemaDef,
  revisionStatusSchema,
  featureRule,
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

// Optional metadata applied when an endpoint auto-creates a draft via
// `version: "new"`. Ignored when editing an existing revision.
const newDraftMetadataFields = {
  revisionTitle: z.string().optional(),
  revisionComment: z.string().optional(),
};

// ---- Shared response schemas ----

const revisionResponse = z.object({ revision: apiFeatureRevisionValidator });

// Mirrors MergeConflict in shared/util/features.ts (plain TS, not zod).
const mergeConflictSchema = z
  .object({
    name: z.string(),
    key: z.string(),
    resolved: z.boolean(),
    base: z.string(),
    live: z.string(),
    revision: z.string(),
  })
  .strict();

// Mirrors MergeResultChanges in shared/util/features.ts.
const mergeResultChangesSchema = z
  .object({
    defaultValue: z.string().optional(),
    rules: z.record(z.string(), z.array(featureRule)).optional(),
    environmentsEnabled: z.record(z.string(), z.boolean()).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    archived: z.boolean().optional(),
    metadata: z
      .object({
        releaseType: z.string().optional(),
        riskLevel: z.string().optional(),
      })
      .passthrough()
      .optional(),
    holdout: z
      .object({ id: z.string(), value: z.string() })
      .nullable()
      .optional(),
  })
  .strict();

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
  description:
    "Returns the revision at the specified version for this feature. Use `GET /features/{id}/revisions/latest` for the most recent active draft.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

const booleanQueryField = z
  .union([
    z.literal("true"),
    z.literal("false"),
    z.literal("0"),
    z.literal("1"),
    z.boolean(),
  ])
  .optional();

export const getFeatureRevisionLatestValidator = {
  method: "get" as const,
  path: "/features/:id/revisions/latest",
  operationId: "getFeatureRevisionLatest",
  summary: "Get the most recent active draft revision",
  description:
    "Returns the most recently updated draft revision for the feature. Returns 404 if there is no active draft. Pass `mine=true` to return the most recent draft authored by or contributed to by the calling user (requires a user-scoped API key).",
  tags: ["feature-revisions"],
  paramsSchema: idParams,
  bodySchema: z.never(),
  querySchema: z
    .object({
      mine: booleanQueryField.describe(
        "If true, return only the most recent active draft authored by or contributed to by the calling user. Requires a user-scoped API key.",
      ),
    })
    .strict(),
  responseSchema: revisionResponse,
};

export const postFeatureRevisionValidator = {
  method: "post" as const,
  path: "/features/:id/revisions",
  operationId: "postFeatureRevision",
  summary: "Create a draft revision",
  description:
    "Creates a new draft revision branched from the current live revision. A feature can have multiple concurrent drafts; use this to start an isolated line of edits.",
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
  description:
    "Permanently discards a draft revision. Only drafts (never published revisions) can be discarded. Any pending ramp actions staged on the draft are dropped.",
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
    "Runs a dry-run merge of the draft against the current live revision and returns any conflicts. Use this before publishing to preview changes and detect conflicting edits.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({
    success: z.boolean(),
    conflicts: z.array(mergeConflictSchema),
    result: mergeResultChangesSchema.optional(),
  }),
};

export const postFeatureRevisionRebaseValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rebase",
  operationId: "postFeatureRevisionRebase",
  summary: "Rebase a draft revision onto the current live version",
  description:
    "Updates the draft's base revision to match the currently-live revision, applying the draft's changes on top. Supply `conflictResolutions` to resolve any conflicting fields (keyed by `envName.ruleId` or `defaultValue`).",
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
  description:
    "Moves the draft into the `pending-review` state and notifies reviewers.",
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
  description:
    "Submits an `approve`, `request-changes`, or `comment` review on the draft. Contributors cannot approve their own drafts, but may submit comments or request changes.",
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

const scheduleRuleInput = z
  .object({
    timestamp: z.string().nullable(),
    enabled: z.boolean(),
  })
  .strict();

const scheduleShorthand = z
  .object({
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
  })
  .strict();

const commonRuleFields = {
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
  scheduleRules: z.array(scheduleRuleInput).optional(),
  scheduleType: z.enum(["none", "schedule", "ramp"]).optional(),
};

const forceRolloutCreateInput = z
  .object({
    ...commonRuleFields,
    type: z.enum(["force", "rollout"]).optional(),
    value: z.string(),
    coverage: z.number().min(0).max(1).optional(),
    hashAttribute: z.string().optional(),
    seed: z.string().optional(),
  })
  .strict();

const experimentRefCreateInput = z
  .object({
    ...commonRuleFields,
    type: z.literal("experiment-ref"),
    experimentId: z.string(),
    variations: z.array(
      z
        .object({ variationId: z.string().optional(), value: z.string() })
        .strict(),
    ),
  })
  .strict();

const safeRolloutCreateInput = z
  .object({
    ...commonRuleFields,
    type: z.literal("safe-rollout"),
    controlValue: z.string(),
    variationValue: z.string(),
    hashAttribute: z.string(),
    trackingKey: z.string().optional(),
    seed: z.string().optional(),
    safeRolloutFields: z
      .object({
        datasourceId: z.string(),
        exposureQueryId: z.string(),
        guardrailMetricIds: z.array(z.string()),
        maxDuration: z
          .object({
            amount: z.number().positive(),
            unit: z.enum(["weeks", "days", "hours", "minutes"]),
          })
          .strict(),
        autoRollback: z.boolean().optional(),
        rampUpSchedule: z
          .object({
            enabled: z.boolean(),
            // Optional custom ramp steps (percentages as 0..1). When omitted, a
            // default 5-step ramp (10%, 25%, 50%, 75%, 100%) is used.
            steps: z
              .array(z.object({ percent: z.number().min(0).max(1) }).strict())
              .min(1)
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

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
  description:
    "Appends a new rule to the end of the rule list for the given environment. A `rule.type` of `force`, `rollout`, `experiment-ref`, or `safe-rollout` determines the accepted shape. Use `rampSchedule` for ramp configuration or `schedule` for a simple start/end window; if both are provided, `rampSchedule` wins.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      environment: z.string(),
      rule: ruleCreateInput,
      rampSchedule: inlineRampScheduleInput.optional(),
      schedule: scheduleShorthand.optional(),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const postFeatureRevisionRulesReorderValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rules/reorder",
  operationId: "postFeatureRevisionRulesReorder",
  summary: "Reorder rules in an environment",
  description:
    "Replaces the rule order for the environment. `ruleIds` must contain **exactly** the set of existing rule IDs in that environment — no additions, omissions, or duplicates.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      environment: z.string(),
      ruleIds: z.array(z.string()),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

// Allow `null` on legacy schedule fields so callers can explicitly clear
// them in a patch.
const rulePatchSchema = z
  .object({
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    condition: z.string().optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    scheduleRules: z.array(scheduleRuleInput).nullable().optional(),
    scheduleType: z.enum(["none", "schedule", "ramp"]).nullable().optional(),
    type: z
      .enum(["force", "rollout", "experiment-ref", "safe-rollout"])
      .optional(),
    value: z.string().optional(),
    coverage: z.number().min(0).max(1).optional(),
    hashAttribute: z.string().optional(),
    seed: z.string().optional(),
    experimentId: z.string().optional(),
    variations: z
      .array(z.object({ variationId: z.string(), value: z.string() }).strict())
      .optional(),
    controlValue: z.string().optional(),
    variationValue: z.string().optional(),
  })
  .strict();

export const putFeatureRevisionRuleValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId",
  operationId: "putFeatureRevisionRule",
  summary: "Update a rule in a draft revision",
  description:
    "Patches fields on an existing rule. The rule `type` cannot be changed — to convert types, delete and re-add. Fields that don't apply to the current rule type are rejected.",
  tags: ["feature-revisions"],
  paramsSchema: ruleParams,
  bodySchema: z
    .object({
      environment: z.string(),
      rule: rulePatchSchema,
      rampSchedule: inlineRampScheduleInput.optional(),
      schedule: scheduleShorthand.optional(),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const deleteFeatureRevisionRuleValidator = {
  method: "delete" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId",
  operationId: "deleteFeatureRevisionRule",
  summary: "Delete a rule from a draft revision",
  description:
    "Removes the rule from the specified environment. Any pending ramp actions on the draft for this rule are also cleared.",
  tags: ["feature-revisions"],
  paramsSchema: ruleParams,
  bodySchema: z
    .object({
      environment: z.string(),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionRuleRampScheduleValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId/ramp-schedule",
  operationId: "putFeatureRevisionRuleRampSchedule",
  summary: "Set ramp schedule for a rule",
  description:
    "Attaches (or replaces) a ramp schedule for the rule. Rejects if the rule already has a live ramp schedule — update that directly via PUT /ramp-schedules/{id}. The schedule is created at publish time.",
  tags: ["feature-revisions"],
  paramsSchema: ruleParams,
  bodySchema: standaloneRampScheduleInput.extend(newDraftMetadataFields),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const deleteFeatureRevisionRuleRampScheduleValidator = {
  method: "delete" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId/ramp-schedule",
  operationId: "deleteFeatureRevisionRuleRampSchedule",
  summary: "Remove ramp schedule from a rule",
  description:
    "Removes a pending ramp schedule attached by the draft. If the rule currently has a live ramp schedule, a detach action is queued and applied at publish time.",
  tags: ["feature-revisions"],
  paramsSchema: ruleParams,
  bodySchema: z
    .object({
      environment: z.string(),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

// ---- Field edit validators ----

export const postFeatureRevisionToggleValidator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/toggle",
  operationId: "postFeatureRevisionToggle",
  summary: "Toggle an environment on/off in a draft revision",
  description:
    "Sets whether the feature is enabled in the given environment as part of the draft. Takes effect on publish.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      environment: z.string(),
      enabled: z.boolean(),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionDefaultValueValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/default-value",
  operationId: "putFeatureRevisionDefaultValue",
  summary: "Set the default value in a draft revision",
  description:
    "Replaces the feature's default value for this revision. The value must be a string representation matching the feature's value type (e.g. `\"true\"` for booleans, `42` for numbers, a JSON string for JSON features).",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({ defaultValue: z.string(), ...newDraftMetadataFields })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionPrerequisitesValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/prerequisites",
  operationId: "putFeatureRevisionPrerequisites",
  summary: "Set feature-level prerequisites in a draft revision",
  description:
    "Replaces the feature's prerequisite list for this revision. Each prerequisite condition is evaluated against `{ value: <prereq-flag-value> }` at SDK eval time — use `value` as the condition key.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      prerequisites: z.array(featurePrerequisite),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionMetadataValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/metadata",
  operationId: "putFeatureRevisionMetadata",
  summary: "Update revision metadata (comment, title, feature metadata)",
  description:
    "Updates draft-level metadata (`comment`, `title`) and/or feature-level metadata (owner, project, tags, customFields, jsonSchema, etc.). Merge semantics: omitted fields are left unchanged; any provided field replaces the current value (pass an empty string/array/object to clear). Feature metadata changes are staged on the revision and applied to the feature on publish. Changing `project` requires publish permission on both the old and new project.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      comment: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      owner: ownerInputField.optional(),
      project: z.string().optional(),
      tags: z.array(z.string()).optional(),
      neverStale: z.boolean().optional(),
      customFields: z.record(z.string(), z.unknown()).optional(),
      jsonSchema: JSONSchemaDef.optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionArchiveValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/archive",
  operationId: "putFeatureRevisionArchive",
  summary: "Set archived state in a draft revision",
  description:
    "Sets whether the feature is archived. Archived features are excluded from SDK payloads on publish.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({ archived: z.boolean(), ...newDraftMetadataFields })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const putFeatureRevisionHoldoutValidator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/holdout",
  operationId: "putFeatureRevisionHoldout",
  summary: "Set holdout in a draft revision",
  description:
    "Sets (or clears, via `holdout: null`) the holdout experiment bound to the feature. Holdout linkage side-effects (updating the holdout's linked feature list) are applied on publish.",
  tags: ["feature-revisions"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      holdout: z
        .object({ id: z.string(), value: z.string() })
        .strict()
        .nullable(),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
};

export const listRevisionsValidator = {
  method: "get" as const,
  path: "/revisions",
  operationId: "listRevisions",
  summary: "List feature revisions",
  description:
    "Returns a paginated list of feature revisions across all features in the organization. Optionally filtered by feature, status, author, and/or the calling user's involvement. Results are sorted newest-first.",
  tags: ["feature-revisions"],
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      ...skipPaginationQueryField,
      featureId: z.string().optional(),
      status: revisionStatusSchema.optional(),
      author: z.string().optional(),
      mine: booleanQueryField.describe(
        "If true, return only revisions authored by or contributed to by the calling user. Requires a user-scoped API key. Mutually exclusive with `author`.",
      ),
    })
    .strict(),
  responseSchema: z
    .object({
      revisions: z.array(apiFeatureRevisionValidator),
    })
    .extend(apiPaginationFieldsValidator.shape),
};

// ---- Exported types for use in back-end handlers ----

export type RuleCreateInput = z.infer<typeof ruleCreateInput>;
export type RulePatchInput = z.infer<typeof rulePatchSchema>;
