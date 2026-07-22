import { z } from "zod";
import {
  featurePrerequisite,
  savedGroupTargeting,
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
  booleanQueryField,
  schemaValidationQueryFields,
  publishOverrideBodyFields,
  bypassApprovalPublishBodyField,
  ignoreWarningsBodyField,
  publishBypassedGatesField,
} from "./shared";
import {
  inlineRampScheduleInput,
  standaloneRampScheduleInput,
  revisionVersionParam,
} from "./feature-revisions";
import { rampStartState } from "./ramp-schedule";
import { apiFeatureRevisionV2Validator } from "./features-v2";
import { JSONSchemaDef, revisionStatusFilterSchema } from "./features";
import { ownerInputField } from "./owner-field";
import { namedSchema } from "./openapi-helpers";

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
  revisionTitle: z
    .string()
    .optional()
    .describe(
      'Title for a newly created draft. Only used when version is "new"; ignored for existing revisions.',
    ),
  revisionComment: z
    .string()
    .optional()
    .describe(
      'Comment for a newly created draft. Only used when version is "new"; ignored for existing revisions.',
    ),
};

// ---- Shared response schemas ----

const revisionResponse = z.object({ revision: apiFeatureRevisionV2Validator });

// Ramp-schedule body accepting an optional `startState` (the rollback anchor).
const rampScheduleInputV2 = standaloneRampScheduleInput.extend({
  startState: rampStartState
    .optional()
    .describe(
      "The rule state to roll back to (the rollback/jump-to-start anchor). " +
        'Merged onto the rule\'s current state, so `{ "coverage": 0 }` keeps ' +
        "existing targeting but rolls back to 0%. This affects rollbacks only — " +
        "it is NOT applied when the ramp starts. On create, omitting it infers " +
        "the anchor from the rule's current coverage (and returns a warning if " +
        "that isn't 0%); on update of a live schedule, omitting it leaves the " +
        "existing anchor unchanged.",
    ),
});

// Response variant that can carry non-fatal advisories (e.g. an inferred
// rollback anchor that isn't 0%).
const revisionResponseWithWarnings = revisionResponse.extend({
  warnings: z
    .array(z.string())
    .optional()
    .describe("Non-fatal advisories about how the request was interpreted."),
});

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

const scheduleShorthand = z
  .object({
    startDate: z
      .string()
      .datetime({ offset: true })
      .optional()
      .nullable()
      .describe(
        'ISO 8601 date-time, e.g. "2025-06-01T00:00:00Z". Rule is enabled at this time.',
      ),
    endDate: z
      .string()
      .datetime({ offset: true })
      .optional()
      .nullable()
      .describe(
        'ISO 8601 date-time, e.g. "2025-07-01T00:00:00Z". Rule is disabled at this time.',
      ),
  })
  .strict();

const commonRuleFields = {
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
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

const targetingRuleCreateInputV2 = namedSchema(
  "Targeting Rule",
  z
    .object({
      ...commonRuleFields,
      ...ruleScopeInput,
      type: z
        .enum(["force", "rollout"])
        .optional()
        .describe(
          'Use "force" for a standard targeting rule, or "rollout" for a percentage rollout (coverage < 1). Defaults to "force". Both are functionally equivalent; a force rule with coverage < 1 behaves as a rollout.',
        ),
      value: z.string().describe("The value to serve when this rule matches."),
      config: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Key of a config to back this value. When set, `value` is a JSON override patch merged on top of the config; omit or null for a plain value.",
        ),
      sparse: z
        .boolean()
        .optional()
        .describe(
          "JSON features only. When true, the rule value is a partial object merged onto the feature's default value instead of replacing it.",
        ),
      coverage: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          "Percentage of users to include (0–1). Defaults to 1. When less than 1, hashAttribute is required.",
        ),
      hashAttribute: z
        .string()
        .optional()
        .describe(
          "Attribute to hash on for consistent assignment. Required when coverage < 1.",
        ),
      seed: z.string().optional(),
      hashVersion: z
        .union([z.literal(1), z.literal(2)])
        .describe(
          "Hash algorithm version for bucketing. Defaults to 2 (preferred) when not specified.",
        )
        .optional(),
    })
    .strict()
    .describe(
      "A targeting rule that serves a specific value to users matching the conditions. Set coverage < 1 for a percentage rollout.",
    ),
);

const experimentRefCreateInputV2 = namedSchema(
  "Experiment Rule",
  z
    .object({
      ...commonRuleFields,
      ...ruleScopeInput,
      type: z
        .literal("experiment-ref")
        .describe('Must be "experiment-ref" for an experiment rule.'),
      experimentId: z.string().describe("ID of the linked experiment."),
      variations: z.array(
        z
          .object({
            variationId: z.string().optional(),
            value: z.string(),
            config: z
              .string()
              .nullable()
              .optional()
              .describe(
                "Key of a config to back this variation value. When set, `value` is a JSON override patch merged on top of the config; omit or null for a plain value.",
              ),
          })
          .strict(),
      ),
      sparse: z
        .boolean()
        .optional()
        .describe(
          "JSON features only. When true, each variation value is a partial object merged onto the feature's default value instead of replacing it.",
        ),
    })
    .strict()
    .describe(
      "An experiment rule that links a feature value to an existing experiment.",
    ),
);

const safeRolloutCreateInputV2 = namedSchema(
  "Safe Rollout Rule",
  z
    .object({
      ...commonRuleFields,
      ...ruleScopeInput,
      type: z
        .literal("safe-rollout")
        .describe('Must be "safe-rollout" for a safe rollout rule.'),
      controlValue: z.string(),
      variationValue: z.string(),
      hashAttribute: z.string(),
      trackingKey: z.string().optional(),
      seed: z.string().optional(),
      safeRolloutFields: z
        .object({
          datasourceId: z.string(),
          exposureQueryId: z.string(),
          guardrailMetricIds: z.array(z.string()).min(1),
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
    .strict()
    .describe(
      "A safe rollout rule with automated guardrail monitoring and optional auto-rollback.",
    ),
);

const ruleCreateInputV2 = z.union([
  targetingRuleCreateInputV2,
  experimentRefCreateInputV2,
  safeRolloutCreateInputV2,
]);

export type RuleCreateInputV2 = z.infer<typeof ruleCreateInputV2>;

const rulePatchSchemaV2 = z
  .object({
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    condition: z.string().optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    type: z
      .enum(["force", "rollout", "experiment-ref", "safe-rollout"])
      .optional(),
    value: z.string().optional(),
    config: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Force/rollout rules only. Key of a config to back the value (or null to detach). When set, `value` is a JSON override patch merged on top of the config. Omit to leave the existing config backing unchanged.",
      ),
    sparse: z.boolean().optional(),
    coverage: z.number().min(0).max(1).optional(),
    hashAttribute: z.string().optional(),
    seed: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    experimentId: z.string().optional(),
    variations: z
      .array(
        z
          .object({
            variationId: z.string(),
            value: z.string(),
            config: z
              .string()
              .nullable()
              .optional()
              .describe(
                "Key of a config to back this variation value (or null to detach). When set, `value` is a JSON override patch merged on top of the config.",
              ),
          })
          .strict(),
      )
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
    "Returns the most recently updated active draft revision for the feature. Returns 404 if no matching draft exists. Filter by status, author, or use `mine=true` to scope to the calling user's own drafts.",
  tags: ["feature-revisions-v2"],
  paramsSchema: idParams,
  bodySchema: z.never(),
  querySchema: z
    .object({
      mine: booleanQueryField.describe(
        "If true, return only the most recent active draft authored by or contributed to by the calling user.",
      ),
      status: revisionStatusFilterSchema,
      author: z
        .string()
        .optional()
        .describe("Filter to drafts created by this user (userId)."),
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
    .object({
      comment: z.string().optional(),
      title: z.string().optional(),
      ignoreWarnings: ignoreWarningsBodyField,
    })
    .strict(),
  querySchema: z
    .object({
      overrideDraftLimit: booleanQueryField.describe(
        "If the organization caps concurrent drafts per feature (`maxConcurrentDrafts` setting), requests at or over the cap are rejected with a 409. Pass `true` to create the draft anyway.",
      ),
    })
    .strict(),
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

export const postFeatureRevisionReopenV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/reopen",
  operationId: "postFeatureRevisionReopenV2",
  summary: "Reopen a discarded revision as a draft",
  description:
    "Returns a `discarded` revision to `draft` status so it can be edited, reviewed, and published. Prior review state is not restored — the draft must go back through review if approvals are required.",
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
    "Immediately publishes a draft revision, making it the live version of the feature. Any pending ramp actions (`pendingRamp` on rules) are executed atomically — ramp schedules are created or detached as queued.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      comment: z.string().optional(),
      bypassApproval: bypassApprovalPublishBodyField,
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
  responseSchema: revisionResponse.extend({
    bypassedGates: publishBypassedGatesField,
  }),
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

// Per-field conflict keys, plus per-rule `rules.<ruleId>` (both sides changed
// the same rule, including delete-vs-modify) and `rules.order` (competing
// reorders). The blanket `rules` key resolves all rule-level conflicts at once.
const conflictResolutionsDescription =
  "Map of conflict key → resolution. Keys come from the returned conflicts: `defaultValue`, `prerequisites`, `archived`, `holdout`, `environmentsEnabled.<env>`, `metadata.<field>`, `rules.<ruleId>`, and `rules.order`. `overwrite` keeps the draft's version of that item; `discard` keeps live's. The blanket `rules` key applies one strategy to all rule-level conflicts.";

const rebaseBodySchema = z
  .object({
    conflictResolutions: z
      .record(z.string(), z.enum(["overwrite", "discard"]))
      .optional()
      .describe(conflictResolutionsDescription),
    expectedLiveVersion: z
      .number()
      .int()
      .optional()
      .describe(
        "Optimistic-concurrency guard: the live version the resolutions were authored against (as returned by merge-status or rebase preview). If live has since moved, the request fails with `409` instead of applying resolutions to different conflicts.",
      ),
    expectedDraftDateUpdated: z
      .string()
      .optional()
      .describe(
        "Optimistic-concurrency guard for the draft side: the draft's `draftDateUpdated` timestamp as returned by merge-status or rebase preview. If the draft has been modified since (e.g. by a co-author), the request fails with `409` instead of applying resolutions against changed draft content.",
      ),
    ignoreWarnings: ignoreWarningsBodyField,
  })
  .strict();

const mergePreviewResponseSchema = z.object({
  success: z.boolean(),
  liveVersion: z
    .number()
    .describe(
      "The current live version the merge was computed against. Echo this back as `expectedLiveVersion` when rebasing.",
    ),
  draftDateUpdated: z
    .string()
    .meta({ format: "date-time" })
    .describe(
      "The draft's last-modified timestamp at merge time. Echo this back as `expectedDraftDateUpdated` when rebasing to guard against concurrent draft edits.",
    ),
  conflicts: z.array(mergeConflictSchema),
  result: mergeResultChangesSchema.optional(),
});

export const getFeatureRevisionMergeStatusV2Validator = {
  method: "get" as const,
  path: "/features/:id/revisions/:version/merge-status",
  operationId: "getFeatureRevisionMergeStatusV2",
  summary: "Get merge status for a draft revision",
  description:
    "Runs the three-way merge between the draft and the current live version without applying it. Conflicts are granular: each conflicting field gets its own key, and rules conflict individually (`rules.<ruleId>`, plus `rules.order` for competing reorders). Pass the returned `liveVersion` as `expectedLiveVersion` when rebasing. Also reports `rebaseRequired` so callers can detect ahead of time whether the publish endpoint will block until the draft is rebased.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: mergePreviewResponseSchema.extend({
    rebaseRequired: z
      .boolean()
      .describe(
        "True when publishing this draft is blocked until it is rebased — either the merge has conflicts, or the draft is behind live (or its approval went stale) while the organization enforces rebase-before-publish. When true with no conflicts, callers with bypass-approval permission can still publish with `ignoreWarnings: true`; others must rebase first.",
      ),
  }),
  version: "v2" as const,
};

// ---- Diff endpoint ----
//
// Shape mirrors the front-end's "Copy as → Minimal/Full JSON" so one source of
// truth covers both the in-app clipboard formats and the REST contract.
// Lifecycle/identity fields are echoed in `from`/`to` rather than the diff
// body, which focuses on content changes.
const diffFormatParam = z
  .enum(["minimal", "full"])
  .optional()
  .describe(
    "`minimal` (default) returns only what changed, with id-keyed arrays bucketed into added/removed/modified items. `full` returns the complete before/after content of the revision.",
  );

// `base=live` is handy for pre-publish bots that want the net effect on live.
const diffBaseParam = z
  .union([z.literal("baseVersion"), z.literal("live"), z.coerce.number().int()])
  .optional()
  .describe(
    "Compare against: `baseVersion` (default — the revision's own `baseVersion`, matches the in-app review view), `live` (the currently-live revision), or an integer version (an arbitrary historical revision).",
  );

// Per-field/array-item change descriptors used by the minimal format.
const diffChangeEntry = z
  .object({
    field: z.string(),
    change: z.enum(["added", "removed", "modified"]),
  })
  .passthrough();

const diffSupplementalMinimal = z
  .object({
    name: z.string(),
    type: z.string(),
    change: z.enum(["added", "removed", "modified"]),
  })
  .passthrough();

const diffSupplementalFull = z
  .object({
    name: z.string(),
    type: z.string(),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
  })
  .strict();

const diffEnvelope = z.object({
  name: z.string().describe("The feature key."),
  type: z.literal("feature"),
  from: z
    .number()
    .int()
    .describe("Version number this revision was diffed against (the before)."),
  to: z.number().int().describe("Version number being diffed (the after)."),
});

const minimalDiffResponse = z.object({
  diff: diffEnvelope.extend({
    changes: z.array(diffChangeEntry),
    supplemental: z.array(diffSupplementalMinimal).optional(),
  }),
});

const fullDiffResponse = z.object({
  diff: diffEnvelope.extend({
    before: z.record(z.string(), z.unknown()),
    after: z.record(z.string(), z.unknown()),
    supplemental: z.array(diffSupplementalFull).optional(),
  }),
});

export const getFeatureRevisionDiffV2Validator = {
  method: "get" as const,
  path: "/features/:id/revisions/:version/diff",
  operationId: "getFeatureRevisionDiffV2",
  summary: "Diff a revision against another revision",
  description:
    "Returns a schema-keyed JSON diff between this revision and a baseline. The same shapes the in-app review surface produces under `Copy as → Minimal JSON` / `Full JSON`: `minimal` lists only what changed (with id-keyed arrays bucketed into added/removed/modified items and reorder detection), while `full` returns the complete before/after content of the revision. Lifecycle fields (version, status, comment, date, createdBy, publishedBy) are excluded from the diff body and echoed via `from` / `to` instead. Defaults to diffing against the revision's own `baseVersion`; pass `?base=live` to diff against the current live revision, or `?base=<version>` for an arbitrary historical one.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z
    .object({
      format: diffFormatParam,
      base: diffBaseParam,
    })
    .strict(),
  // The two formats produce structurally different payloads; the union lets
  // OpenAPI clients see both. Object identification is via the always-present
  // `changes` (minimal) / `before` (full) keys.
  responseSchema: z.union([minimalDiffResponse, fullDiffResponse]),
  version: "v2" as const,
};

export const postFeatureRevisionRebasePreviewV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rebase/preview",
  operationId: "postFeatureRevisionRebasePreviewV2",
  summary: "Preview a rebase without applying it",
  description:
    "Dry-run of the rebase: runs the same three-way merge with the supplied `conflictResolutions` and returns every conflict (resolved and unresolved) plus the merged result once all are resolved — without modifying the draft. Use it to iterate on resolutions before committing them via the rebase endpoint.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: rebaseBodySchema,
  querySchema: z.never(),
  responseSchema: mergePreviewResponseSchema,
  version: "v2" as const,
};

export const postFeatureRevisionRebaseV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/rebase",
  operationId: "postFeatureRevisionRebaseV2",
  summary: "Rebase a draft revision onto the current live version",
  description:
    "Updates the draft's base revision to match the currently-live revision, applying the draft's changes on top. Supply `conflictResolutions` to resolve conflicting items individually — including per-rule (`rules.<ruleId>`) and rule-order (`rules.order`) conflicts. Supply `expectedLiveVersion` and/or `expectedDraftDateUpdated` (both returned by merge-status and rebase preview) to fail fast with `409` if either side changes between conflict review and submission. Unresolved conflicts also respond with `409`.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: rebaseBodySchema,
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionRequestReviewV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/request-review",
  operationId: "postFeatureRevisionRequestReviewV2",
  summary: "Request review for a draft revision",
  description:
    "Moves the draft into the `pending-review` state and notifies reviewers.\n\nSet `autoPublishOnApproval` to `true` to publish the revision automatically the moment it is approved (GitHub auto-merge model). This requires the org to have auto-publish-on-approval enabled for the feature and the caller to have publish permission; the auto-publish then executes with the caller's authority.\n\nSet `scheduledPublishAt` to a future ISO date-time to defer the auto-publish until that date (it still also requires approval when review is required). Use `scheduledPublishLockEdits` to freeze edits to this draft while the schedule is pending, and `scheduledPublishLockOthers` to block publishing other drafts of this feature in the meantime.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      comment: z.string().optional(),
      autoPublishOnApproval: z.boolean().optional(),
      scheduledPublishAt: z
        .union([z.string().meta({ format: "date-time" }), z.null()])
        .optional(),
      scheduledPublishLockEdits: z.boolean().optional(),
      scheduledPublishLockOthers: z.boolean().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionSchedulePublishV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/schedule-publish",
  operationId: "postFeatureRevisionSchedulePublishV2",
  summary: "Schedule (or cancel) a deferred publish for a draft revision",
  description:
    "Arms a deferred publish: the revision publishes automatically on/after `scheduledPublishAt` (and, when review is required, only once also approved). Send `scheduledPublishAt: null` to cancel the schedule.\n\nUse `lockEdits` to freeze content edits to this draft while the schedule is pending (rebasing is still allowed), and `lockOthers` to block publishing other drafts of this feature until the schedule fires or is canceled. Requires publish permission; the publish executes with the caller's authority. An admin with bypass-approval permission can schedule even without approval — pass `bypassApproval: true` to mark it as an admin override, which locks the schedule to cancel-and-re-arm only.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      scheduledPublishAt: z.union([
        z.string().meta({ format: "date-time" }),
        z.null(),
      ]),
      lockEdits: z.boolean().optional(),
      lockOthers: z.boolean().optional(),
      bypassApproval: z.boolean().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionSubmitReviewV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/submit-review",
  operationId: "postFeatureRevisionSubmitReviewV2",
  summary: "Submit a review on a draft revision",
  description:
    "Submits an `approve`, `request-changes`, or `comment` review on the draft. Contributors cannot approve their own drafts when `blockSelfApproval` is enabled.\n\nWhen `action` is `approve` and the revision has `autoPublishOnApproval` enabled, the revision is automatically published after approval. The response includes `autoPublished: true` when this happens. Pass `skipAutoPublish: true` to approve without triggering auto-publish.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z
    .object({
      comment: z.string().optional(),
      action: z.enum(["approve", "request-changes", "comment"]).optional(),
      skipAutoPublish: z.boolean().optional(),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse.extend({
    autoPublished: z.boolean().optional(),
  }),
  version: "v2" as const,
};

export const postFeatureRevisionRecallReviewV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/recall-review",
  operationId: "postFeatureRevisionRecallReviewV2",
  summary: "Recall a review request (revert to draft)",
  description:
    "Retracts the review request, returning the revision from `pending-review`, `changes-requested`, or `approved` back to `draft`. Allowed for any user with draft-management permission on the feature (the same permission required to request review), not only the original requester. Existing review log entries are preserved as audit history but any in-flight reviewer verdicts (Approved / Requested Changes) submitted during this review cycle no longer count — submitting a fresh `request-review` starts a new cycle.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({}).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const postFeatureRevisionUndoReviewV2Validator = {
  method: "post" as const,
  path: "/features/:id/revisions/:version/undo-review",
  operationId: "postFeatureRevisionUndoReviewV2",
  summary: "Undo a reviewer's own review verdict",
  description:
    "Reviewer retracts their own verdict. The revision status rewinds to the state implied by the remaining active verdicts from other reviewers: any outstanding `Requested Changes` → `changes-requested`, else any outstanding `Approved` → `approved`, else `pending-review`. Existing review comments are preserved. If the retraction resolves the revision to `approved` and auto-publish-on-approval is armed, the revision is published.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.object({}).strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

const revisionLogParams = revisionParamsStrict.extend({ logId: z.string() });

const okResponse = z.object({ status: z.literal(200) }).strict();

// Sanitized actor for log entries — never exposes API key secrets.
const apiRevisionLogUser = z
  .object({
    type: z.enum(["dashboard", "api_key", "system"]),
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .strict()
  .nullable();

const apiRevisionLogEntry = z
  .object({
    id: z
      .string()
      .optional()
      .describe(
        "Log entry ID. Use a `Comment` entry's id with the PUT/DELETE log endpoints to edit or delete an owned comment. Absent on legacy entries stored inline on the revision.",
      ),
    action: z
      .string()
      .describe(
        'Entry type — content edits (e.g. "add rule", "edit defaultValue", "rebase"), review lifecycle events ("Review Requested", "Approved", "Requested Changes"), comments ("Comment"), or other audit events.',
      ),
    subject: z.string(),
    value: z.string().describe("JSON-encoded payload for the entry"),
    timestamp: z.string().meta({ format: "date-time" }),
    user: apiRevisionLogUser,
  })
  .strict();

export const getFeatureRevisionLogV2Validator = {
  method: "get" as const,
  path: "/features/:id/revisions/:version/log",
  operationId: "getFeatureRevisionLogV2",
  summary: "List the activity log for a revision",
  description:
    "Returns every log entry for the revision — content edits (rules, default value, rebases), review lifecycle events (review requested, approved, changes requested, recalled, undone), comments, and other audit events — sorted oldest-first.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParamsStrict,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({ log: z.array(apiRevisionLogEntry) }),
  version: "v2" as const,
};

export const putFeatureRevisionLogCommentV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/log/:logId",
  operationId: "putFeatureRevisionLogCommentV2",
  summary: "Edit the comment text of an owned log entry",
  description:
    "Author of a `Comment`, `Approved`, or `Requested Changes` log entry can rewrite its comment text. The entry's action and other audit-trail metadata remain immutable; this only mutates `value.comment`. Other audit events (e.g. `Review Requested`, system events) are not editable.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionLogParams,
  bodySchema: z
    .object({
      comment: z
        .string()
        .describe("New comment text. Replaces existing comment text."),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: okResponse,
  version: "v2" as const,
};

export const deleteFeatureRevisionLogEntryV2Validator = {
  method: "delete" as const,
  path: "/features/:id/revisions/:version/log/:logId",
  operationId: "deleteFeatureRevisionLogEntryV2",
  summary: "Delete an owned revision Comment entry",
  description:
    "Author of a `Comment` log entry can delete it. Verdict entries (Approved, Requested Changes, Review Requested) and other audit-trail events are immutable. To retract a verdict use `/undo-review`; to retract a review request use `/recall-review`.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionLogParams,
  bodySchema: z.object({}).strict(),
  querySchema: z.never(),
  responseSchema: okResponse,
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
      ignoreWarnings: ignoreWarningsBodyField,
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
    .object({
      defaultValue: z
        .string()
        .describe(
          'New default value. In Config mode (feature has `baseConfig`), the default must be exactly a config with no overrides: send `"{}"` to use `baseConfig`, or set `defaultValueConfig` to point at a descendant.',
        ),
      defaultValueConfig: z
        .string()
        .nullable()
        .describe(
          "Key of a config within the feature's `baseConfig` family that the default value resolves to (the base itself or a descendant). The default is exactly that config with no overrides; pass `null` to use `baseConfig`. Do not embed `@config:` in `defaultValue` — use this field.",
        )
        .optional(),
      ...newDraftMetadataFields,
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const putFeatureRevisionPrerequisitesV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/prerequisites",
  operationId: "putFeatureRevisionPrerequisitesV2",
  summary: "Set feature-level prerequisites in a draft revision",
  description:
    "Sets the feature-level prerequisites for this revision. Each prerequisite must be a boolean feature flag; the gate is always 'prerequisite flag is on'. The condition is applied automatically — only the flag ID is required.",
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      prerequisites: z
        .array(
          z
            .object({ id: z.string().describe("ID of a boolean feature flag") })
            .strict(),
        )
        .describe(
          "List of prerequisite boolean flags. When any prerequisite flag is off for a user, this flag returns its defaultValue for that user.",
        ),
      ...newDraftMetadataFields,
      ignoreWarnings: ignoreWarningsBodyField,
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
      ignoreWarnings: ignoreWarningsBodyField,
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
    .object({
      archived: z.boolean(),
      ...newDraftMetadataFields,
      ignoreWarnings: ignoreWarningsBodyField,
    })
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
      ignoreWarnings: ignoreWarningsBodyField,
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
    'Appends a new rule to the revision\'s rule list. Supply `allEnvironments: true` on the rule to target all environments, or `environments: [...]` to scope to specific ones.\n\n**Scheduling:** For `force` and `rollout` rules, attach a schedule via `rampSchedule` (multi-step ramp) or `schedule` (simple start/end window) — these create standalone ramp actions and set `pendingRamp: "create"` on the rule. For `experiment-ref` and `safe-rollout` rules, only `schedule` is supported and is stored as legacy schedule fields on the rule itself (`rampSchedule` is not available for these rule types).',
  tags: ["feature-revisions-v2"],
  paramsSchema: revisionParams,
  bodySchema: z
    .object({
      rule: ruleCreateInputV2,
      rampSchedule: inlineRampScheduleInput
        .optional()
        .describe(
          "Multi-step ramp schedule for force/rollout rules. Not supported for experiment-ref or safe-rollout rules. Mutually exclusive with `schedule`.",
        ),
      schedule: scheduleShorthand
        .optional()
        .describe(
          "Simple start/end date window. For force/rollout rules this creates a standalone ramp action; for experiment-ref/safe-rollout rules this sets legacy schedule fields on the rule. Mutually exclusive with `rampSchedule`.",
        ),
      ...newDraftMetadataFields,
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
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
      ignoreWarnings: ignoreWarningsBodyField,
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
    'Patches fields on an existing rule (identified by `ruleId`). The rule `type` cannot be changed. Scope can be updated via `allEnvironments` / `environments` patch fields.\n\n**Scheduling:** For `force` and `rollout` rules, update the schedule via `rampSchedule` (multi-step ramp) or `schedule` (simple start/end window) — these manage standalone ramp actions and set `pendingRamp: "create"` on the rule. For `experiment-ref` and `safe-rollout` rules, only `schedule` is supported and updates legacy schedule fields on the rule itself (`rampSchedule` is not available for these rule types).',
  tags: ["feature-revisions-v2"],
  paramsSchema: ruleParams,
  bodySchema: z
    .object({
      rule: rulePatchSchemaV2,
      rampSchedule: inlineRampScheduleInput
        .optional()
        .describe(
          "Multi-step ramp schedule for force/rollout rules. Not supported for experiment-ref or safe-rollout rules. Mutually exclusive with `schedule`.",
        ),
      schedule: scheduleShorthand
        .optional()
        .describe(
          "Simple start/end date window. For force/rollout rules this manages a standalone ramp action; for experiment-ref/safe-rollout rules this updates legacy schedule fields on the rule. Mutually exclusive with `rampSchedule`.",
        ),
      ...newDraftMetadataFields,
      ...publishOverrideBodyFields,
    })
    .strict(),
  querySchema: z.object({ ...schemaValidationQueryFields }).strict(),
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
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      ignoreWarnings: ignoreWarningsBodyField,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const putFeatureRevisionRuleRampScheduleV2Validator = {
  method: "put" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId/ramp-schedule",
  operationId: "putFeatureRevisionRuleRampScheduleV2",
  summary: "Set ramp schedule for a rule",
  description:
    'Queues a revision-controlled ramp action for this rule. If the rule already has a live ramp schedule, this stores an `update` action applied on publish; otherwise it stores a `create` action. No live schedule config changes are applied immediately by this endpoint.\n\nYou can build the ramp from a template (`templateId`) and set the rollback anchor (`startState`) in the same request — e.g. pull in a template and pass `startState: { "coverage": 0 }` so a rollback returns the rule to 0%.',
  tags: ["feature-revisions-v2"],
  paramsSchema: ruleParams,
  bodySchema: rampScheduleInputV2.extend({
    ...newDraftMetadataFields,
    ignoreWarnings: ignoreWarningsBodyField,
  }),
  querySchema: z.never(),
  responseSchema: revisionResponseWithWarnings,
  version: "v2" as const,
};

export const deleteFeatureRevisionRuleRampScheduleV2Validator = {
  method: "delete" as const,
  path: "/features/:id/revisions/:version/rules/:ruleId/ramp-schedule",
  operationId: "deleteFeatureRevisionRuleRampScheduleV2",
  summary: "Remove ramp schedule from a rule",
  description:
    'Clears any pending ramp action for this rule. If a live ramp schedule exists, queues a detach that removes it on publish — the rule will show `pendingRamp: "detach"`. If only a pending create exists, it is removed and `pendingRamp` is cleared.',
  tags: ["feature-revisions-v2"],
  paramsSchema: ruleParams,
  bodySchema: z
    .object({
      ...newDraftMetadataFields,
      ignoreWarnings: ignoreWarningsBodyField,
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: revisionResponse,
  version: "v2" as const,
};

export const listRevisionsV2Validator = {
  method: "get" as const,
  path: "/feature-revisions",
  operationId: "listRevisionsV2",
  summary: "List revisions across all features",
  description:
    "Returns a paginated list of feature revisions across all features in the organization. Use the `featureId` query parameter to filter to a single feature. Revision `rules` is a flat array with per-rule scope.",
  tags: ["feature-revisions-v2"],
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      ...skipPaginationQueryField,
      featureId: z.string().optional(),
      status: revisionStatusFilterSchema,
      author: z.string().optional(),
      mine: booleanQueryField.describe(
        "If true, return only revisions authored by or contributed to by the calling user.",
      ),
      archived: booleanQueryField.describe(
        "Whether to include revisions for archived features. Defaults to `false` (non-archived features only). Pass `true` to include revisions for archived features alongside non-archived ones.",
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
