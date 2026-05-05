import { z } from "zod";
import {
  featurePrerequisite,
  savedGroupTargeting,
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
} from "./shared";
import {
  inlineRampScheduleInput,
  standaloneRampScheduleInput,
  revisionVersionParam,
} from "./feature-revisions";
import { apiFeatureRevisionV2Validator } from "./features-v2";
import { JSONSchemaDef, revisionStatusSchema } from "./features";
import { ownerInputField } from "./owner-field";

// ---- Shared param schemas ----

const idParams = z.object({ id: z.string() });

const revisionParams = idParams.extend({ version: revisionVersionParam });
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

const revisionResponse = z.object({ revision: apiFeatureRevisionV2Validator });

const booleanQueryField = z
  .union([
    z.literal("true"),
    z.literal("false"),
    z.literal("0"),
    z.literal("1"),
    z.boolean(),
  ])
  .optional();

// Mirrors MergeConflict in shared/util/features.ts.
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

const mergeResultChangesSchema = z
  .object({
    defaultValue: z.string().optional(),
    rules: z.array(z.any()).optional(),
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

// ---- V2 Rule input schemas ----

const scheduleRuleInput = z
  .object({ timestamp: z.string().nullable(), enabled: z.boolean() })
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

// Scope fields for v2 — no `environment` needed; each rule carries its own.
const ruleScopeInput = {
  allEnvironments: z
    .boolean()
    .optional()
    .describe(
      "When true the rule applies to all environments. Defaults to false.",
    ),
  environments: z
    .array(z.string())
    .optional()
    .describe(
      "Specific environment IDs this rule applies to. Used when allEnvironments is false.",
    ),
};

const forceRolloutCreateInputV2 = z
  .object({
    ...commonRuleFields,
    ...ruleScopeInput,
    type: z.enum(["force", "rollout"]).optional(),
    value: z.string(),
    coverage: z.number().min(0).max(1).optional(),
    hashAttribute: z.string().optional(),
    seed: z.string().optional(),
  })
  .strict();

const experimentRefCreateInputV2 = z
  .object({
    ...commonRuleFields,
    ...ruleScopeInput,
    type: z.literal("experiment-ref"),
    experimentId: z.string(),
    variations: z.array(
      z
        .object({ variationId: z.string().optional(), value: z.string() })
        .strict(),
    ),
  })
  .strict();

const safeRolloutCreateInputV2 = z
  .object({
    ...commonRuleFields,
    ...ruleScopeInput,
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

const ruleCreateInputV2 = z.union([
  experimentRefCreateInputV2,
  safeRolloutCreateInputV2,
  forceRolloutCreateInputV2,
]);

export type RuleCreateInputV2 = z.infer<typeof ruleCreateInputV2>;

const rulePatchSchemaV2 = z
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
    // V2: scope can be updated via patch
    allEnvironments: z.boolean().optional(),
    environments: z.array(z.string()).optional(),
  })
  .strict();

export type RulePatchInputV2 = z.infer<typeof rulePatchSchemaV2>;

// ---- Endpoint validators ----

export const getFeatureRevisionV2Validator = {
  method: "get" as const,
  path: "/features/:id/revisions/:version",
  operationId: "getFeatureRevisionV2",
  summary: "Get a single feature revision",
  description:
    "Returns the revision at the specified version for this feature. Revision `rules` is a flat array with per-rule environment scope.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const getFeatureRevisionLatestV2Validator = {
  method: "get" as const,
  path: "/features/:id/revisions/latest",
  operationId: "getFeatureRevisionLatestV2",
  summary: "Get the most recent active draft revision",
  description:
    "Returns the most recently updated draft revision for the feature. Returns 404 if there is no active draft.",
  tags: ["feature-revisions-v2"],
  paramsSchema: idParams,
  bodySchema: z.never(),
  querySchema: z
    .object({
      mine: booleanQueryField.describe(
        "If true, return only the most recent active draft authored by or contributed to by the calling user.",
      ),
    })
    .strict(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions",
  operationId: "postFeatureRevisionV2",
  summary: "Create a draft revision",
  description:
    "Creates a new draft revision branched from the current live revision.",
  tags: ["feature-revisions-v2"],
  paramsSchema: idParams,
  bodySchema: z
    .object({ comment: z.string().optional(), title: z.string().optional() })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionDiscardV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/discard",
  operationId: "postFeatureRevisionDiscardV2",
  summary: "Discard a draft revision",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({}).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionPublishV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/publish",
  operationId: "postFeatureRevisionPublishV2",
  summary: "Publish a draft revision",
  description:
    "Immediately publishes a draft revision, making it the live version of the feature.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({ comment: z.string().optional() }).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionRevertV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/revert",
  operationId: "postFeatureRevisionRevertV2",
  summary: "Revert the feature to a prior revision",
  tags: ["feature-revisions-v2"],
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
  version: "v2" as const,
};

export const getFeatureRevisionMergeStatusV2Validator = {
  method: "get" as const,
  path: "/features/:id/revisions/:version/merge-status",
  operationId: "getFeatureRevisionMergeStatusV2",
  summary: "Get merge status for a draft revision",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({
    success: z.boolean(),
    conflicts: z.array(mergeConflictSchema),
    result: mergeResultChangesSchema.optional(),
  }),
  version: "v2" as const,
};

export const postFeatureRevisionRebaseV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rebase",
  operationId: "postFeatureRevisionRebaseV2",
  summary: "Rebase a draft revision onto the current live version",
  description:
    "Updates the draft's base revision to match the currently-live revision, applying the draft's changes on top. Supply `conflictResolutions` to resolve any conflicting fields. Valid keys: `defaultValue`, `rules`, `prerequisites`, `archived`, `holdout`, and `environmentsEnabled.<env>`. Unresolved conflicts respond with `409`.",
  tags: ["feature-revisions-v2"],
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
  version: "v2" as const,
};

export const postFeatureRevisionRequestReviewV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/request-review",
  operationId: "postFeatureRevisionRequestReviewV2",
  summary: "Request review for a draft revision",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({ comment: z.string().optional() }).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionSubmitReviewV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/submit-review",
  operationId: "postFeatureRevisionSubmitReviewV2",
  summary: "Submit a review on a draft revision",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      comment: z.string().optional(),
      action: z.enum(["approve", "request-changes", "comment"]).optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionToggleV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/toggle",
  operationId: "postFeatureRevisionToggleV2",
  summary: "Toggle an environment on/off in a draft revision",
  tags: ["feature-revisions-v2"],
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
  version: "v2" as const,
};

export const putFeatureRevisionDefaultValueV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/default-value",
  operationId: "putFeatureRevisionDefaultValueV2",
  summary: "Set the default value in a draft revision",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({ defaultValue: z.string(), ...newDraftMetadataFields })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const putFeatureRevisionPrerequisitesV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/prerequisites",
  operationId: "putFeatureRevisionPrerequisitesV2",
  summary: "Set feature-level prerequisites in a draft revision",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      prerequisites: z.array(featurePrerequisite),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const putFeatureRevisionMetadataV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/metadata",
  operationId: "putFeatureRevisionMetadataV2",
  summary: "Update revision metadata",
  tags: ["feature-revisions-v2"],
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
  version: "v2" as const,
};

export const putFeatureRevisionArchiveV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/archive",
  operationId: "putFeatureRevisionArchiveV2",
  summary: "Set archived state in a draft revision",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({ archived: z.boolean(), ...newDraftMetadataFields })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const putFeatureRevisionHoldoutV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/holdout",
  operationId: "putFeatureRevisionHoldoutV2",
  summary: "Set holdout in a draft revision",
  tags: ["feature-revisions-v2"],
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
  version: "v2" as const,
};

// ---- V2 Rule operation validators ----
// No `environment` field — scope lives on the rule itself via
// `allEnvironments` / `environments`.

export const postFeatureRevisionRuleAddV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rules",
  operationId: "postFeatureRevisionRuleAddV2",
  summary: "Add a rule to a draft revision",
  description:
    "Appends a new rule to the revision's rule list. Supply `allEnvironments: true` to target all environments, or `environments: [...]` to scope to specific ones. Use `rampSchedule` for ramp configuration or `schedule` for a simple start/end window.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      rule: ruleCreateInputV2,
      rampSchedule: inlineRampScheduleInput.optional(),
      schedule: scheduleShorthand.optional(),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionRulesReorderV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rules/reorder",
  operationId: "postFeatureRevisionRulesReorderV2",
  summary: "Reorder rules in the revision",
  description:
    "Replaces the flat global rule order. `ruleIds` must contain **exactly** the set of all existing rule IDs in the revision — no additions, omissions, or duplicates.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      ruleIds: z.array(z.string()),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const putFeatureRevisionRuleV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId",
  operationId: "putFeatureRevisionRuleV2",
  summary: "Update a rule in a draft revision",
  description:
    "Patches fields on an existing rule (identified by `ruleId`). The rule `type` cannot be changed. Scope can be updated via `allEnvironments` / `environments` patch fields.",
  tags: ["feature-revisions-v2"],
  paramsSchema: ruleParams,
  bodySchema: z
    .object({
      rule: rulePatchSchemaV2,
      rampSchedule: inlineRampScheduleInput.optional(),
      schedule: scheduleShorthand.optional(),
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const deleteFeatureRevisionRuleV2Validator = {
  method: "delete" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId",
  operationId: "deleteFeatureRevisionRuleV2",
  summary: "Delete a rule from a draft revision",
  description:
    "Removes the rule from the revision. Any pending ramp actions for this rule are also cleared.",
  tags: ["feature-revisions-v2"],
  paramsSchema: ruleParams,
  bodySchema: z.object({ ...newDraftMetadataFields }).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const putFeatureRevisionRuleRampScheduleV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId/ramp-schedule",
  operationId: "putFeatureRevisionRuleRampScheduleV2",
  summary: "Set ramp schedule for a rule",
  tags: ["feature-revisions-v2"],
  paramsSchema: ruleParams,
  bodySchema: standaloneRampScheduleInput.extend(newDraftMetadataFields),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const deleteFeatureRevisionRuleRampScheduleV2Validator = {
  method: "delete" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId/ramp-schedule",
  operationId: "deleteFeatureRevisionRuleRampScheduleV2",
  summary: "Remove ramp schedule from a rule",
  tags: ["feature-revisions-v2"],
  paramsSchema: ruleParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const listRevisionsV2Validator = {
  method: "get" as const,
  path: "/revisions",
  operationId: "listRevisionsV2",
  summary: "List feature revisions",
  description:
    "Returns a paginated list of feature revisions across all features in the organization. Revision `rules` is a flat array with per-rule scope.",
  tags: ["feature-revisions-v2"],
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
        "If true, return only revisions authored by or contributed to by the calling user.",
      ),
    })
    .strict(),
  responseSchema: z
    .object({
      revisions: z.array(apiFeatureRevisionV2Validator),
    })
    .extend(apiPaginationFieldsValidator.shape),
  version: "v2" as const,
};
