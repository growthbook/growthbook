import { z } from "zod";
import { statsEngines, MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { eventUser } from "./event-user";
import {
  featurePrerequisite,
  namespaceValue,
  savedGroupTargeting,
  paginationQueryFields,
  skipPaginationQueryField,
  apiPaginationFieldsValidator,
} from "./shared";
import { safeRolloutStatusArray } from "./safe-rollout";
import {
  ownerEmailField,
  ownerField,
  ownerInputField,
  requiredUnlessPatOwnerInputField,
} from "./owner-field";
import {
  featureRulePatch,
  lockdownConfigSchema,
  rampStep,
  rampStepAction,
  rampMonitoringConfig,
  stepHoldConditions,
} from "./ramp-schedule";

import { namedSchema } from "./openapi-helpers";

export const simpleSchemaFieldValidator = z.object({
  key: z.string().max(64),
  type: z.enum(["integer", "float", "string", "boolean"]),
  required: z.boolean(),
  default: z.string().max(256),
  description: z.string().max(MAX_DESCRIPTION_LENGTH),
  enum: z.array(z.string().max(256)).max(256),
  // Optional bounds — absent means no validation. Compiled only when present.
  min: z.number().optional(),
  max: z.number().optional(),
  // Config-only, additive: `nullable` widens to `T | null`; `jsonSchema` is a
  // raw per-field schema that supersedes the simple type.
  nullable: z.boolean().optional(),
  jsonSchema: z.string().optional(),
});

// Config-only: a named cross-field invariant — a relational rule JSON Schema
// can't express (field-to-field comparisons, implications). `rule` is a mongo
// condition (mongrule) boolean expression over the config's fields — field-to-field
// comparisons use the `$ref` extension — stored as a JSON string (kept a string
// rather than a nested object so it doesn't fight react-hook-form's typing in the
// feature schema editor, which shares this validator); `message` is shown to editors.
export const configInvariantValidator = z.object({
  name: z.string().max(128),
  rule: z.string(),
  message: z.string().max(MAX_DESCRIPTION_LENGTH),
});

export const simpleSchemaValidator = z.object({
  type: z.enum(["object", "object[]", "primitive", "primitive[]"]),
  fields: z.array(simpleSchemaFieldValidator),
  // Config-only: when true, the generated object schema permits keys beyond the
  // declared fields (`additionalProperties: true`), letting child configs/rules
  // extend the base. Absent = strict (`false`).
  additionalProperties: z.boolean().optional(),
  // Config-only: cross-field invariants evaluated at the save gate alongside the
  // per-field JSON Schema check (see configInvariantValidator).
  invariants: z.array(configInvariantValidator).optional(),
});

export const featureValueType = [
  "boolean",
  "string",
  "number",
  "json",
] as const;

export type FeatureValueType = (typeof featureValueType)[number];

const scheduleRule = z
  .object({
    timestamp: z.union([z.string(), z.null()]),
    enabled: z.boolean(),
  })
  .strict();

export type ScheduleRule = z.infer<typeof scheduleRule>;

export const baseRule = z
  .object({
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
    condition: z.string().optional(),
    // `fr_<uniqid>` for new rules; post-migration rules from a v1 collision
    // carry a `__<env>` suffix. REST emits the qualified id; SDK/UI stem-strip.
    // See `shared/src/util/ruleId.ts`.
    id: z.string(),
    // Wildcard env scope. When true, `environments` must be omitted.
    allEnvironments: z.boolean(),
    // Env list when `allEnvironments` is false.
    environments: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    scheduleRules: z.array(scheduleRule).optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    // UI hint: which scheduling mode the user chose. "schedule" = 0-step start/end
    // date rule; "ramp" = multi-step ramp-up. Absent or "none" = no schedule.
    scheduleType: z.enum(["none", "schedule", "ramp"]).optional(),
  })
  .strict();

// `sparse` (JSON features only): the value is a partial object whose keys are
// merged onto the feature's default value at SDK-payload time, rather than
// replacing it. Ignored unless the feature's defaultValue is a plain JSON
// object. See `resolveSparseJSONValue` in shared/util.
const sparseRuleField = z.boolean().optional();

export const forceRule = baseRule
  .extend({
    type: z.literal("force"),
    value: z.string(),
    sparse: sparseRuleField,
  })
  .strict();

export type ForceRule = z.infer<typeof forceRule>;

export const rolloutRule = baseRule
  .extend({
    type: z.literal("rollout"),
    value: z.string(),
    sparse: sparseRuleField,
    coverage: z.number(),
    hashAttribute: z.string(),
    seed: z.string().optional(),
    hashVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  })
  .strict();

export type RolloutRule = z.infer<typeof rolloutRule>;

const experimentValue = z
  .object({
    value: z.string(),
    weight: z.number(),
    name: z.string().optional(),
  })
  .strict();

export type ExperimentValue = z.infer<typeof experimentValue>;

const experimentType = ["standard", "multi-armed-bandit"] as const;
const banditStageType = ["explore", "exploit", "paused"] as const;

const experimentRule = baseRule
  .extend({
    type: z.literal("experiment"), // refers to RuleType, not experiment.type
    experimentType: z.enum(experimentType).optional(),
    hypothesis: z.string().optional(),
    trackingKey: z.string(),
    hashAttribute: z.string(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.number().optional(),
    disableStickyBucketing: z.boolean().optional(),
    bucketVersion: z.number().optional(),
    minBucketVersion: z.number().optional(),
    namespace: namespaceValue.optional(),
    coverage: z.number().optional(),
    datasource: z.string().optional(),
    exposureQueryId: z.string().optional(),
    goalMetrics: z.array(z.string()).optional(),
    secondaryMetrics: z.array(z.string()).optional(),
    guardrailMetrics: z.array(z.string()).optional(),
    activationMetric: z.string().optional(),
    segment: z.string().optional(),
    skipPartialData: z.boolean().optional(),
    values: z.array(experimentValue),
    regressionAdjustmentEnabled: z.boolean().optional(),
    sequentialTestingEnabled: z.boolean().optional(),
    sequentialTestingTuningParameter: z.number().optional(),
    statsEngine: z.enum(statsEngines).optional(),
    banditStage: z.enum(banditStageType).optional(),
    banditStageDateStarted: z.date().optional(),
    banditScheduleValue: z.number().optional(),
    banditScheduleUnit: z.enum(["hours", "days"]).optional(),
    banditBurnInValue: z.number().optional(),
    banditBurnInUnit: z.enum(["hours", "days"]).optional(),
    banditConversionWindowValue: z.number().optional().nullable(),
    banditConversionWindowUnit: z.enum(["hours", "days"]).optional().nullable(),
    templateId: z.string().optional(),
    customFields: z.record(z.string(), z.any()).optional(),
  })
  .strict();

export type ExperimentRule = z.infer<typeof experimentRule>;

const experimentRefVariation = z
  .object({
    variationId: z.string(),
    value: z.string(),
  })
  .strict();

export type ExperimentRefVariation = z.infer<typeof experimentRefVariation>;

const contextualBanditRefVariation = z
  .object({
    variationId: z.string(),
    value: z.string(),
  })
  .strict();

export type ContextualBanditRefVariation = z.infer<
  typeof contextualBanditRefVariation
>;

const experimentRefRule = baseRule
  .extend({
    type: z.literal("experiment-ref"),
    experimentId: z.string(),
    variations: z.array(experimentRefVariation),
    sparse: sparseRuleField,
  })
  .strict();

export type ExperimentRefRule = z.infer<typeof experimentRefRule>;

const contextualBanditRefRule = baseRule
  .extend({
    type: z.literal("contextual-bandit-ref"),
    contextualBanditId: z.string(),
    variations: z.array(contextualBanditRefVariation),
  })
  .strict();

export type ContextualBanditRefRule = z.infer<typeof contextualBanditRefRule>;

export const safeRolloutRule = baseRule
  .extend({
    type: z.literal("safe-rollout"),
    controlValue: z.string(),
    variationValue: z.string(),
    safeRolloutId: z.string(),
    // safeRolloutRule is a nested validator for feature rules, not a BaseModel entity,
    // so the defaultValues mechanism doesn't apply. We need .default() here.
    // eslint-disable-next-line no-restricted-syntax
    status: z.enum(safeRolloutStatusArray).default("running"),
    hashAttribute: z.string(),
    seed: z.string(),
    trackingKey: z.string(),
  })
  .strict();

export type SafeRolloutRule = z.infer<typeof safeRolloutRule>;
export const featureRule = z.union([
  forceRule,
  rolloutRule,
  experimentRule,
  experimentRefRule,
  contextualBanditRefRule,
  safeRolloutRule,
]);

export type FeatureRule = z.infer<typeof featureRule>;

// Env-level settings only (kill switch + prerequisites). Rules live on
// `featureInterface.rules`.
export const featureEnvironment = z
  .object({
    enabled: z.boolean(),
    prerequisites: z.array(featurePrerequisite).optional(),
  })
  .strict();

export type FeatureEnvironment = z.infer<typeof featureEnvironment>;

// ---------------------------------------------------------------------------
// v1 (legacy) validators
// ---------------------------------------------------------------------------
// Deliberately permissive `.passthrough()` schemas for on-disk legacy data.
// Constructed field-by-field so evolving v2 `FeatureRule` doesn't implicitly
// change `V1FeatureRule`.
// ---------------------------------------------------------------------------

export const v1FeatureRule = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    enabled: z.boolean().optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  })
  .passthrough();

export type V1FeatureRule = z.infer<typeof v1FeatureRule>;

export const v1FeatureEnvironment = z
  .object({
    enabled: z.boolean().optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    rules: z.array(v1FeatureRule).optional(),
  })
  .passthrough();

export type V1FeatureEnvironment = z.infer<typeof v1FeatureEnvironment>;

export const JSONSchemaDef = z
  .object({
    schemaType: z.enum(["schema", "simple"]),
    schema: z.string(),
    simple: simpleSchemaValidator,
    date: z.date(),
    enabled: z.boolean(),
  })
  .strict();

const revisionLog = z
  .object({
    // Optional — legacy log entries stored inline on the revision document
    // don't have their own ID. New entries from FeatureRevisionLogModel always
    // include the id, which is required for owner edit/delete operations.
    id: z.string().optional(),
    user: eventUser,
    timestamp: z.date(),
    action: z.string(),
    subject: z.string(),
    value: z.string(),
  })
  .strict();

export type RevisionLog = z.infer<typeof revisionLog>;

const revisionRulesSchema = z.array(featureRule);
export type RevisionRules = z.infer<typeof revisionRulesSchema>;

export const revisionStatusSchema = z.enum([
  "draft",
  "published",
  "discarded",
  "approved",
  "changes-requested",
  "pending-review",
  // Held child revision created by a ramp schedule; auto-published when the parent
  // controller revision is approved/published. Not user-actionable directly.
  "pending-parent",
]);

export type RevisionStatus = z.infer<typeof revisionStatusSchema>;

export const activeDraftStatusSchema = revisionStatusSchema.exclude([
  "published",
  "discarded",
  "pending-parent", // Excluded — managed by ramp schedule, not user-actionable
]);

export type ActiveDraftStatus = z.infer<typeof activeDraftStatusSchema>;

export const ACTIVE_DRAFT_STATUSES = activeDraftStatusSchema.options;

// Revisions at "request review" or beyond — excludes drafts still being edited
// (and terminal/ramp statuses). Used for "needs attention" counts and gates.
export const reviewRequestedStatusSchema = revisionStatusSchema.exclude([
  "draft",
  "published",
  "discarded",
  "pending-parent",
]);

export const REVIEW_REQUESTED_STATUSES = reviewRequestedStatusSchema.options;

/**
 * Status filter for revision list endpoints. Accepts a single value
 * (`draft`), comma-separated values (`draft,approved`), or the shorthand
 * `all-drafts` (expands to draft, pending-review, approved,
 * changes-requested). On v2 endpoints, omitting this parameter defaults to
 * `all-drafts`. Parsing is handled at the handler layer via
 * `parseRevisionStatusFilter`.
 */
export const revisionStatusFilterSchema = z
  .union([z.string(), z.array(z.string())])
  .describe(
    "Filter by revision status. Single value, comma-separated list, repeated params (?status=draft&status=approved), or `all-drafts` shorthand for all active-draft statuses (draft, pending-review, approved, changes-requested).",
  )
  .optional();

export type RevisionStatusFilter = z.infer<typeof revisionStatusFilterSchema>;

/**
 * Parse a raw status query-param value into the form expected by
 * `getFeatureRevisionsByStatus`. Handles:
 * - Single values:          "draft"
 * - Comma-separated:        "draft,approved"
 * - "all-drafts" shorthand: expands to all four active-draft statuses
 * - Repeated query params:  ["all-drafts", "draft"] (from Express array parsing)
 *
 * Throws a plain Error (caught as 400 by createApiRequestHandler) if any
 * token is not a recognised RevisionStatus or "all-drafts".
 */
export function parseRevisionStatusFilter(
  val: string | string[] | undefined,
): RevisionStatus | RevisionStatus[] | undefined {
  if (!val || (Array.isArray(val) && val.length === 0)) return undefined;

  const valid = new Set<string>([
    ...revisionStatusSchema.options,
    "all-drafts",
  ]);

  const expand = (token: string): RevisionStatus[] => {
    if (!valid.has(token)) {
      throw new Error(
        `Invalid status value: "${token}". Must be one of: ${[...revisionStatusSchema.options, "all-drafts"].join(", ")}.`,
      );
    }
    return token === "all-drafts"
      ? [...ACTIVE_DRAFT_STATUSES]
      : [token as RevisionStatus];
  };

  const tokens = Array.isArray(val)
    ? val
    : val.includes(",")
      ? val.split(",").map((s) => s.trim())
      : [val];

  const expanded = [...new Set(tokens.flatMap(expand))]; // deduplicate
  return expanded.length === 1 ? expanded[0] : expanded;
}

const minimalFeatureRevisionInterface = z
  .object({
    version: z.number(),
    datePublished: z.union([z.null(), z.date()]),
    dateUpdated: z.date(),
    createdBy: eventUser,
    status: revisionStatusSchema,
    comment: z.string(),
    title: z.string().optional(),
    contributors: z.array(z.string()).optional(),
    // Surfaced so revision lists/dropdowns can show schedule status + lock
    // indicators without fetching full revisions.
    autoPublishOnApproval: z.boolean().optional(),
    scheduledPublishAt: z.union([z.null(), z.date()]).optional(),
    scheduledPublishLockEdits: z.boolean().optional(),
    scheduledPublishLockOthers: z.boolean().optional(),
    scheduledPublishBypassApproval: z.boolean().optional(),
  })
  .strict();

export type MinimalFeatureRevisionInterface = z.infer<
  typeof minimalFeatureRevisionInterface
>;

const revisionMetadataSchema = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  owner: ownerField.optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  neverStale: z.boolean().optional(),
  customFields: z.record(z.string(), z.any()).optional(),
  jsonSchema: JSONSchemaDef.optional(),
  valueType: z.enum(featureValueType).optional(),
  // Config mode. Tracked alongside jsonSchema/valueType so a change is
  // snapshotted, diffed, gated, and applied on publish like any schema change.
  baseConfig: z.string().nullable().optional(),
});

export type RevisionMetadata = z.infer<typeof revisionMetadataSchema>;

// Ramp schedule actions stored on a revision. Deferred until publish. Only
// create/detach are revision-bound — state changes (pause, resume, …) run
// real-time on the live ramp schedule.
// API variant: targetType/targetId are inferred from the top-level ruleId
// at publish time.
const revisionApiRampStepAction = z.object({
  targetType: z.literal("feature-rule").optional(),
  targetId: z.string().optional(),
  patch: featureRulePatch.partial({ ruleId: true }),
});

const revisionApiRampStep = z.object({
  interval: z.number().positive().nullable(),
  actions: z.array(revisionApiRampStepAction).optional(),
  approvalNotes: z.string().nullish(),
  monitored: z.boolean().optional(),
  holdConditions: stepHoldConditions.optional(),
});

// Stored type — requires targetType/targetId in actions.
export const revisionRampCreateAction = z.object({
  mode: z.literal("create"),
  name: z.string().optional(),
  // @deprecated — target by ruleId only. Kept for pre-migration DB compat.
  environment: z.string().optional().nullable(),
  templateId: z.string().optional(),
  startActions: z.array(rampStepAction).optional(),
  steps: z.array(rampStep),
  endActions: z.array(rampStepAction).optional(),
  startDate: z.string().optional().nullable(),
  cutoffDate: z.string().optional().nullable(),
  ruleId: z.string(),
  monitoringConfig: rampMonitoringConfig.optional(),
  lockdownConfig: lockdownConfigSchema.optional(),
  // When true, the ramp holds at step -1 (rule disabled, zero traffic) until a
  // human explicitly approves the start, instead of firing on publish / at
  // startDate. Per-launch decision — deliberately NOT sourced from templates.
  // Tri-state on updates (mirrors startDate): true = on, null = explicitly off,
  // undefined/absent = leave unchanged.
  requiresStartApproval: z.boolean().nullish(),
});

// API input variant — normalize to RevisionRampCreateAction before storing.
export const apiRevisionRampCreateAction = revisionRampCreateAction.extend({
  steps: z.array(revisionApiRampStep).optional(),
  startActions: z.array(revisionApiRampStepAction).optional(),
  endActions: z.array(revisionApiRampStepAction).optional(),
  startDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable()
    .describe(
      'ISO 8601 date-time, e.g. "2025-06-01T00:00:00Z". Absent or null means start immediately on publish.',
    ),
  cutoffDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable()
    .describe(
      'ISO 8601 date-time, e.g. "2025-07-01T00:00:00Z". The ramp ends at this time.',
    ),
});

export const revisionRampDetachAction = z.object({
  mode: z.literal("detach"),
  rampScheduleId: z.string(),
  ruleId: z.string(),
  deleteScheduleWhenEmpty: z.boolean().optional(),
});

export const revisionRampUpdateAction = revisionRampCreateAction
  .omit({ mode: true })
  .extend({
    mode: z.literal("update"),
    rampScheduleId: z.string(),
  });

export const apiRevisionRampUpdateAction = apiRevisionRampCreateAction
  .omit({ mode: true })
  .extend({
    mode: z.literal("update"),
    rampScheduleId: z.string(),
  });

const revisionRampAction = z.discriminatedUnion("mode", [
  revisionRampCreateAction,
  revisionRampUpdateAction,
  revisionRampDetachAction,
]);
export const apiRevisionRampAction = z.discriminatedUnion("mode", [
  apiRevisionRampCreateAction,
  apiRevisionRampUpdateAction,
  revisionRampDetachAction,
]);

export type RevisionRampCreateAction = z.infer<typeof revisionRampCreateAction>;
export type ApiRevisionRampCreateAction = z.infer<
  typeof apiRevisionRampCreateAction
>;
export type RevisionRampUpdateAction = z.infer<typeof revisionRampUpdateAction>;
export type ApiRevisionRampUpdateAction = z.infer<
  typeof apiRevisionRampUpdateAction
>;
export type RevisionRampDetachAction = z.infer<typeof revisionRampDetachAction>;
export type RevisionRampAction = z.infer<typeof revisionRampAction>;

// A reviewer's active verdict for the current review cycle. Denormalized onto
// the revision (the source of truth remains the revision log) so consumers —
// custom hooks ("2 approvals required, 1 from this list of user IDs"),
// the REST API, and reviewer-scoped queries — don't have to replay the log.
export const revisionReviewSchema = z
  .object({
    // Stable reviewer identifier used for upserts/queries: the user id for
    // dashboard users; the key id (or apiKey identifier) for API keys.
    // See `reviewerKeyForEventUser`.
    userId: z.string(),
    // Full event user who submitted the verdict — lets policy hooks match on
    // type ("dashboard" vs "api_key"), apiKey, email, etc.
    user: eventUser,
    // Active verdicts ("approved" / "changes-requested") become their
    // "-stale" variants when the draft's content changes afterward (orgs with
    // reset-on-review enabled). Stale verdicts no longer gate publishing but
    // stay attributable; policy hooks matching on the active statuses ignore
    // them naturally. A new verdict from the same reviewer replaces the stale
    // entry; recall / re-request clears the list entirely.
    status: z.enum([
      "approved",
      "changes-requested",
      "approved-stale",
      "changes-requested-stale",
    ]),
    // When this verdict was submitted. Compare against `dateUpdated` to detect
    // verdicts that predate later content edits.
    timestamp: z.date(),
  })
  .strict();

export type RevisionReview = z.infer<typeof revisionReviewSchema>;

// Stable identifier for a reviewer across review lifecycle events, or null if
// the event user can't hold a review verdict (system/anonymous users).
export function reviewerKeyForEventUser(
  user: z.infer<typeof eventUser>,
): string | null {
  if (!user) return null;
  if (user.type === "dashboard") return user.id;
  if (user.type === "api_key") return user.id || user.apiKey || null;
  return null;
}

const featureRevisionInterface = minimalFeatureRevisionInterface
  .extend({
    featureId: z.string(),
    organization: z.string(),
    baseVersion: z.number(),
    // The live feature version at the moment this revision was approved.
    // Used to detect "stale" approvals — i.e. changes published after approval.
    // Absent on drafts that were never approved and on legacy approvals.
    approvedBaseVersion: z.number().optional(),
    dateCreated: z.date(),
    publishedBy: z.union([z.null(), eventUser]),
    comment: z.string(),
    defaultValue: z.string(),
    rules: revisionRulesSchema,
    // Revision envelopes — only present when explicitly changed
    environmentsEnabled: z.record(z.string(), z.boolean()).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    archived: z.boolean().optional(),
    metadata: revisionMetadataSchema.optional(),
    holdout: z
      .object({ id: z.string(), value: z.string() })
      .nullable()
      .optional(),
    // Ramp schedule actions (create/detach) to execute atomically when this revision
    // is published. This ensures ramp schedules are never orphaned by draft abandonment
    // or revision reverts. Real-time state changes (pause, resume, rollback, etc.)
    // are NOT stored here — they operate directly on live ramp schedule documents.
    rampActions: z.array(revisionRampAction).optional(),
    log: z.array(revisionLog).optional(), // This is deprecated in favor of using FeatureRevisionLog due to it being too large
    // User IDs who have made edits to this draft. Populated incrementally via
    // updateRevision's $addToSet; may be empty if no content edits have been made.
    // Note: the revision author (createdBy) is NOT automatically seeded here.
    contributors: z.array(z.string()).optional(),
    autoPublishOnApproval: z.boolean().optional(),
    // User ID of whoever most recently armed `autoPublishOnApproval` — the
    // auto-publish executes with this user's authority. Absent when armed by
    // an actor without a user ID (e.g. an API key), in which case the
    // publish falls back to `createdBy`.
    autoPublishEnabledBy: z.string().optional(),
    // Defers an armed revision's auto-publish until on/after this date (and, if
    // required, approved). null/absent = publish as soon as approved.
    scheduledPublishAt: z.union([z.null(), z.date()]).optional(),
    // While pending, freeze content edits to this draft (rebase still allowed).
    scheduledPublishLockEdits: z.boolean().optional(),
    // While pending, block publishing other drafts of this feature.
    scheduledPublishLockOthers: z.boolean().optional(),
    // True when an admin armed this schedule via the bypass-approval override.
    // The schedule is then treated as "dangerous": it can't be edited inline
    // (only canceled and re-armed) and anyone with publish authority may cancel
    // it. Fire-time bypass still derives from the armer's live role, not this
    // flag. Cleared whenever the schedule is canceled or the revision leaves the
    // review cycle (part of SCHEDULED_PUBLISH_UNSET).
    scheduledPublishBypassApproval: z.boolean().optional(),
    // Set by the scheduled-publish poller when a due publish can't go through
    // (e.g. still awaiting approval, merge conflict). Lets the UI surface a
    // stuck schedule instead of it silently retrying forever. Cleared on a
    // successful publish or when the schedule is canceled.
    scheduledPublishAttempts: z.number().optional(),
    scheduledPublishLastError: z.string().optional(),
    // Backoff gate: the poller skips a due-but-failing revision until this time,
    // so doomed retries space out exponentially instead of firing every tick.
    scheduledPublishNextAttemptAt: z.union([z.null(), z.date()]).optional(),
    // Set when the poller gives up on a failing scheduled publish (terminal
    // failure, or transient failures exhausted the attempt cap). The schedule is
    // cleared and the draft left open; this timestamp marks it abandoned so the
    // UI can flag it. Cleared when the schedule is re-armed or canceled.
    scheduledPublishGaveUpAt: z.union([z.null(), z.date()]).optional(),
    // Active reviewer verdicts for the current review cycle (one entry per
    // reviewer). Kept in sync by the review lifecycle mutations:
    // submit review upserts, undo review removes, request/recall review
    // clears. Mirrors revision-log replay semantics — verdicts survive
    // content edits (even when the review status resets) until a new review
    // cycle starts. Absent on revisions that predate this field.
    reviews: z.array(revisionReviewSchema).optional(),
  })
  .strict();

export type FeatureRevisionInterface = z.infer<typeof featureRevisionInterface>;

export const revisionChangesSchema = featureRevisionInterface
  .pick({
    title: true,
    comment: true,
    defaultValue: true,
    rules: true,
    baseVersion: true,
    environmentsEnabled: true,
    prerequisites: true,
    archived: true,
    metadata: true,
    holdout: true,
    rampActions: true,
  })
  .partial();

export type RevisionChanges = z.infer<typeof revisionChangesSchema>;

export const featureInterface = z
  .object({
    id: z.string(),
    archived: z.boolean().optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    organization: z.string(),
    nextScheduledUpdate: z.union([z.date(), z.null()]).optional(),
    owner: ownerField,
    project: z.string().optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    valueType: z.enum(featureValueType),
    defaultValue: z.string(),
    // The config a JSON flag is backed by (a "config" authoring type). First-class
    // and authoritative: its presence is what makes the flag config-backed. The
    // payload compiler injects this config as the base layer under the default and
    // every rule/variation value, so those values are stored as pure override
    // patches (they may still carry their own optional `$extends` for layering,
    // like rules). Stopgap ahead of a first-class `gb.config()` SDK primitive.
    baseConfig: z.string().nullable().optional(),
    version: z.number(),
    tags: z.array(z.string()).optional(),
    environmentSettings: z.record(z.string(), featureEnvironment),
    // Unified top-level rule array. Each rule carries `environments` (or allEnvironments=true).
    // Repurposes the pre-existing but previously-unused `rules` field in the Mongoose schema
    // so no DB migration is needed.
    rules: z.array(featureRule),
    linkedExperiments: z.array(z.string()).optional(),
    jsonSchema: JSONSchemaDef.optional(),
    customFields: z.record(z.string(), z.any()).optional(),

    /** @deprecated */
    legacyDraft: z.union([featureRevisionInterface, z.null()]).optional(),
    /** @deprecated */
    legacyDraftMigrated: z.boolean().optional(),
    neverStale: z.boolean().optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    holdout: z
      .object({
        id: z.string(),
        value: z.string(),
      })
      .optional(),
  })
  .strict();

export type FeatureInterface = z.infer<typeof featureInterface>;

export const computedFeatureInterface = featureInterface
  .extend({
    projectId: z.string(),
    projectName: z.string(),
    projectIsDeReferenced: z.boolean(),
    savedGroups: z.array(z.string()),
    stale: z.boolean(),
    ownerName: z.string(),
  })
  .strict();

export type ComputedFeatureInterface = z.infer<typeof computedFeatureInterface>;

// ---------------------------------------------------------------------------
// API endpoint validators (hand-written to reference shared schema objects)
// ---------------------------------------------------------------------------

// ---- ScheduleRule (schemas/ScheduleRule.yaml) ----
export const apiScheduleRuleValidator = namedSchema(
  "ScheduleRule",
  z
    .object({
      enabled: z
        .boolean()
        .describe(
          "Whether the rule should be enabled or disabled at the specified timestamp.",
        ),
      timestamp: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe("ISO timestamp when the rule should activate."),
    })
    .describe(
      "An array of schedule rules to turn on/off a feature rule at specific times. The array must contain exactly 2 elements (start rule and end rule). The first element is the start rule.",
    )
    .strict(),
);

// ---- FeatureBaseRule (schemas/FeatureBaseRule.yaml) ----
export const apiFeatureBaseRuleValidator = namedSchema(
  "FeatureBaseRule",
  z
    .object({
      description: z.string().max(MAX_DESCRIPTION_LENGTH),
      condition: z.string().optional(),
      id: z.string(),
      enabled: z.boolean(),
      scheduleRules: z
        .array(apiScheduleRuleValidator)
        .describe("Simple time-based on/off schedule for this rule")
        .optional(),
      scheduleType: z
        .enum(["none", "schedule", "ramp"])
        .describe(
          "UI hint for which scheduling mode is active:\n- `none` \u2013 no schedule\n- `schedule` \u2013 simple time-based enable/disable via `scheduleRules`\n- `ramp` \u2013 multi-step ramp-up controlled by an associated RampSchedule document\n",
        )
        .optional(),
      rampScheduleId: z
        .string()
        .describe(
          "ID of the active RampSchedule document controlling this rule. Present when `scheduleType` is `ramp` and a live schedule exists.",
        )
        .optional(),
      savedGroupTargeting: z
        .array(
          z.object({
            matchType: z.enum(["all", "any", "none"]),
            savedGroups: z.array(z.string()),
          }),
        )
        .optional(),
      prerequisites: z
        .array(
          z.object({
            id: z.string().describe("Feature ID of the prerequisite"),
            condition: z.string(),
          }),
        )
        .optional(),
    })
    .describe(
      "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
    )
    .strict(),
);

// ---- FeatureForceRule (schemas/FeatureForceRule.yaml) ----
export const apiFeatureForceRuleValidator = namedSchema(
  "FeatureForceRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("force"),
      value: z.string(),
      sparse: z
        .boolean()
        .describe(
          "JSON features only. When true, `value` is a partial object merged onto the feature's default value instead of replacing it.",
        )
        .optional(),
    }),
  ),
);

// ---- FeatureRolloutRule (schemas/FeatureRolloutRule.yaml) ----
export const apiFeatureRolloutRuleValidator = namedSchema(
  "FeatureRolloutRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("rollout"),
      value: z.string(),
      sparse: z
        .boolean()
        .describe(
          "JSON features only. When true, `value` is a partial object merged onto the feature's default value instead of replacing it.",
        )
        .optional(),
      coverage: z.coerce.number().gte(0).lte(1),
      hashAttribute: z.string(),
      seed: z
        .string()
        .describe(
          "Optional seed for the hash function; defaults to the rule id",
        )
        .optional(),
      hashVersion: z
        .union([z.literal(1), z.literal(2)])
        .describe(
          "Hash algorithm version for bucketing. Defaults to 2 (preferred) when not specified.",
        )
        .optional(),
    }),
  ),
);

// ---- FeatureExperimentRule (schemas/FeatureExperimentRule.yaml) ----
export const apiFeatureExperimentRuleValidator = namedSchema(
  "FeatureExperimentRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("experiment"),
      trackingKey: z.string().optional(),
      hashAttribute: z.string().optional(),
      fallbackAttribute: z.string().optional(),
      disableStickyBucketing: z.boolean().optional(),
      bucketVersion: z.coerce.number().optional(),
      minBucketVersion: z.coerce.number().optional(),
      namespace: z
        .object({
          enabled: z.boolean(),
          name: z.string(),
          range: z.array(z.coerce.number()).min(2).max(2),
        })
        .optional(),
      coverage: z.coerce.number().gte(0).lte(1).optional(),
      value: z
        .array(
          z.object({
            value: z.string(),
            weight: z.coerce.number(),
            name: z.string().optional(),
          }),
        )
        .describe("Variation values with weights")
        .optional(),
    }),
  ),
);

// ---- FeatureExperimentRefRule (schemas/FeatureExperimentRefRule.yaml) ----
export const apiFeatureExperimentRefRuleValidator = namedSchema(
  "FeatureExperimentRefRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("experiment-ref"),
      variations: z.array(
        z.object({
          value: z.string(),
          variationId: z.string(),
        }),
      ),
      experimentId: z.string(),
      sparse: z
        .boolean()
        .describe(
          "JSON features only. When true, each variation `value` is a partial object merged onto the feature's default value instead of replacing it.",
        )
        .optional(),
    }),
  ),
);

export const apiFeatureContextualBanditRefRuleValidator = namedSchema(
  "FeatureContextualBanditRefRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("contextual-bandit-ref"),
      variations: z.array(
        z.object({
          value: z.string(),
          variationId: z.string(),
        }),
      ),
      contextualBanditId: z.string(),
    }),
  ),
);

// ---- FeatureSafeRolloutRule (schemas/FeatureSafeRolloutRule.yaml) ----
export const apiFeatureSafeRolloutRuleValidator = namedSchema(
  "FeatureSafeRolloutRule",
  z.intersection(
    apiFeatureBaseRuleValidator
      .omit({})
      .describe(
        "Common fields shared by all feature rule types. Specific rule types extend\nthis base with their own required properties (value, coverage, etc.).\n",
      ),
    z.object({
      type: z.literal("safe-rollout"),
      controlValue: z.string(),
      variationValue: z.string(),
      seed: z.string().optional(),
      hashAttribute: z.string().optional(),
      trackingKey: z.string().optional(),
      safeRolloutId: z.string().optional(),
      status: z
        .enum(["running", "released", "rolled-back", "stopped"])
        .optional(),
    }),
  ),
);

// ---- FeatureRuleV1 (schemas/FeatureRuleV1.yaml) - anyOf / discriminated by type ----
export const apiFeatureRuleValidator = namedSchema(
  "FeatureRuleV1",
  z.union([
    apiFeatureForceRuleValidator,
    apiFeatureRolloutRuleValidator,
    apiFeatureExperimentRuleValidator,
    apiFeatureExperimentRefRuleValidator,
    apiFeatureContextualBanditRefRuleValidator,
    apiFeatureSafeRolloutRuleValidator,
  ]),
);

export type ApiFeatureForceRule = z.infer<typeof apiFeatureForceRuleValidator>;
export type ApiFeatureRule = z.infer<typeof apiFeatureRuleValidator>;

// ---- FeatureDefinition (schemas/FeatureDefinition.yaml) ----
export const apiFeatureDefinitionValidator = namedSchema(
  "FeatureDefinition",
  z
    .object({
      defaultValue: z.union([
        z.string(),
        z.coerce.number(),
        z.array(z.any()),
        z.record(z.string(), z.any()),
        z.null(),
      ]),
      rules: z
        .array(
          z.object({
            force: z
              .union([
                z.string(),
                z.coerce.number(),
                z.array(z.any()),
                z.record(z.string(), z.any()),
                z.null(),
              ])
              .optional(),
            weights: z.array(z.coerce.number()).optional(),
            variations: z
              .array(
                z.union([
                  z.string(),
                  z.coerce.number(),
                  z.array(z.any()),
                  z.record(z.string(), z.any()),
                  z.null(),
                ]),
              )
              .optional(),
            hashAttribute: z.string().optional(),
            namespace: z
              .array(z.union([z.coerce.number(), z.string()]))
              .min(3)
              .max(3)
              .optional(),
            key: z.string().optional(),
            coverage: z.coerce.number().optional(),
            condition: z.record(z.string(), z.any()).optional(),
          }),
        )
        .optional(),
    })
    .strict(),
);

// ---- FeatureEnvironmentV1 (schemas/FeatureEnvironmentV1.yaml) ----
export const apiFeatureEnvironmentValidator = namedSchema(
  "FeatureEnvironmentV1",
  z
    .object({
      enabled: z.boolean(),
      defaultValue: z.string(),
      rules: z.array(apiFeatureRuleValidator),
      definition: z
        .string()
        .describe(
          "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
        )
        .optional(),
      draft: z
        .object({
          enabled: z.boolean(),
          defaultValue: z.string(),
          rules: z.array(apiFeatureRuleValidator),
          definition: z
            .string()
            .describe(
              "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
            )
            .optional(),
        })
        .optional(),
    })
    .strict(),
);

export type ApiFeatureEnvironment = z.infer<
  typeof apiFeatureEnvironmentValidator
>;

// Holdout sub-object used in Feature
export const apiFeatureHoldout = z
  .object({
    id: z.string().describe("Holdout ID"),
    value: z
      .string()
      .describe(
        "The feature value assigned to users in the holdout treatment group",
      ),
  })
  .nullable()
  .optional();

// Revision prerequisite sub-object (used in FeatureRevision)
export const apiRevisionPrerequisite = z.object({
  id: z.string().describe("Feature ID"),
  condition: z.string(),
});

// v2 prerequisite shapes: condition is always {"value":true} and not exposed
// as a settable field — only the prerequisite flag's ID is accepted/returned.
export const apiRevisionPrerequisiteV2 = z.object({
  id: z.string().describe("Feature ID of the prerequisite boolean flag"),
});
export type ApiRevisionPrerequisiteV2 = z.infer<
  typeof apiRevisionPrerequisiteV2
>;

// Revision metadata sub-object
export const apiRevisionMetadata = z
  .object({
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    owner: ownerField.optional(),
    project: z.string().optional(),
    tags: z.array(z.string()).optional(),
    neverStale: z.boolean().optional(),
    valueType: z.string().optional(),
    jsonSchema: z
      .object({
        schemaType: z.enum(["schema", "simple"]).optional(),
        schema: z.string().optional(),
        simple: z.record(z.string(), z.any()).optional(),
        date: z.string().meta({ format: "date-time" }).optional(),
        enabled: z.boolean().optional(),
      })
      .optional(),
    customFields: z.record(z.string(), z.any()).optional(),
    baseConfig: z.string().nullable().optional(),
  })
  .describe(
    "Metadata fields captured in this revision (only present when metadata gating is enabled)",
  );

// ---- EventUser ----
// API-safe projection of the internal EventUser union (see event-user.ts).
// Deliberately excludes the api_key actor's `apiKey` field.
export const apiEventUserValidator = namedSchema(
  "EventUser",
  z
    .object({
      type: z.enum(["dashboard", "api_key", "system"]),
      id: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .strict()
    .describe("The user (or automated actor) responsible for an action"),
);

export type ApiEventUser = z.infer<typeof apiEventUserValidator>;

// ---- FeatureRevisionV1 (schemas/FeatureRevisionV1.yaml) ----
export const apiFeatureRevisionValidator = namedSchema(
  "FeatureRevisionV1",
  z
    .object({
      featureId: z.string().describe("The feature this revision belongs to"),
      baseVersion: z.coerce.number().int(),
      version: z.coerce.number().int(),
      comment: z.string(),
      date: z.string().meta({ format: "date-time" }),
      status: z.string(),
      createdBy: z.string().optional(),
      publishedBy: z.string().optional(),
      defaultValue: z
        .string()
        .describe("The default value at the time this revision was created")
        .optional(),
      rules: z.record(z.string(), z.array(apiFeatureRuleValidator)),
      definitions: z
        .record(
          z.string(),
          z
            .string()
            .describe(
              "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
            ),
        )
        .optional(),
      environmentsEnabled: z
        .record(z.string(), z.boolean())
        .describe(
          "Per-environment enabled state captured in this revision (only present when kill-switch gating is enabled)",
        )
        .optional(),
      envPrerequisites: z
        .record(z.string(), z.array(apiRevisionPrerequisite))
        .describe(
          "Per-environment prerequisites captured in this revision (only present when prerequisite gating is enabled)",
        )
        .optional(),
      prerequisites: z
        .array(apiRevisionPrerequisite)
        .describe(
          "Feature-level prerequisites captured in this revision (only present when prerequisite gating is enabled)",
        )
        .optional(),
      metadata: apiRevisionMetadata.optional(),
      rampActions: z
        .array(apiRevisionRampAction)
        .describe(
          "Pending ramp schedule actions that will be applied when this draft is published",
        )
        .optional(),
    })
    .strict(),
);

// ---- FeatureV1 (schemas/FeatureV1.yaml) ----
export const apiFeatureValidator = namedSchema(
  "FeatureV1",
  z
    .object({
      id: z.string(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      archived: z.boolean(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH),
      owner: ownerField,
      ownerEmail: ownerEmailField,
      project: z.string(),
      valueType: z.enum(["boolean", "string", "number", "json"]),
      defaultValue: z.string(),
      baseConfig: z
        .string()
        .nullable()
        .describe(
          'Key of the config backing this flag ("Config mode"), or null. The config supplies the base JSON and schema. The internal `@config:` directive is scrubbed from values; `@const:` references are preserved. (v2 additionally exposes per-rule config fields.)',
        )
        .optional(),
      defaultValueConfig: z
        .string()
        .nullable()
        .describe(
          "Config within `baseConfig`'s family that the default value resolves to (a descendant), or null when the default uses `baseConfig` directly.",
        )
        .optional(),
      tags: z.array(z.string()),
      environments: z.record(z.string(), apiFeatureEnvironmentValidator),
      prerequisites: z
        .array(z.string())
        .describe("Feature IDs. Each feature must evaluate to `true`")
        .optional(),
      revision: z.object({
        version: z.coerce.number().int(),
        comment: z.string(),
        date: z.string().meta({ format: "date-time" }),
        createdBy: z.string(),
        publishedBy: z.string(),
      }),
      customFields: z.record(z.string(), z.any()).optional(),
      holdout: apiFeatureHoldout,
    })
    .strict(),
);

// ---- FeatureWithRevisionsV1 (schemas/FeatureWithRevisionsV1.yaml) ----
export const apiFeatureWithRevisionsValidator = namedSchema(
  "FeatureWithRevisionsV1",
  z.intersection(
    apiFeatureValidator,
    z.object({
      revisions: z.array(apiFeatureRevisionValidator).optional(),
    }),
  ),
);

export type ApiFeature = z.infer<typeof apiFeatureValidator>;
export type ApiFeatureWithRevisions = z.infer<
  typeof apiFeatureWithRevisionsValidator
>;

// ---- Payload-schema rule types for POST/PUT (postFeature/ directory) ----
// These are DIFFERENT from the response schema rules -- they have different
// required/optional fields and don't use allOf/intersection with base rule.

const postFeatureSavedGroupTargeting = z.object({
  matchType: z.enum(["all", "any", "none"]),
  savedGroups: z.array(z.string()),
});

const postFeaturePrerequisite = z.object({
  id: z.string().describe("Feature ID"),
  condition: z.string(),
});

const postSparseRuleField = z
  .boolean()
  .describe(
    "JSON features only. When true, the rule value is a partial object merged onto the feature's default value instead of replacing it.",
  )
  .optional();

const postFeatureForceRule = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  condition: z.string().describe("Applied to everyone by default.").optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(apiRevisionPrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRuleValidator).optional(),
  id: z.string().optional(),
  enabled: z.boolean().describe("Enabled by default").optional(),
  type: z.literal("force"),
  value: z.string(),
  sparse: postSparseRuleField,
});

const postFeatureRolloutRule = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  condition: z.string().describe("Applied to everyone by default.").optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(postFeaturePrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRuleValidator).optional(),
  id: z.string().optional(),
  enabled: z.boolean().describe("Enabled by default").optional(),
  type: z.literal("rollout"),
  value: z.string(),
  sparse: postSparseRuleField,
  coverage: z
    .number()
    .describe(
      "Percent of traffic included in this experiment. Users not included in the experiment will skip this rule.",
    ),
  hashAttribute: z.string(),
  seed: z.string().optional(),
  hashVersion: z
    .union([z.literal(1), z.literal(2)])
    .describe(
      "Hash algorithm version for bucketing. Defaults to 2 (preferred) when not specified.",
    )
    .optional(),
});

const postFeatureExperimentRefRule = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  id: z.string().optional(),
  enabled: z.boolean().describe("Enabled by default").optional(),
  type: z.literal("experiment-ref"),
  condition: z.string().optional(),
  savedGroupTargeting: z.array(postFeatureSavedGroupTargeting).optional(),
  prerequisites: z.array(postFeaturePrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRuleValidator).optional(),
  variations: z.array(
    z.object({
      value: z.string(),
      variationId: z.string(),
    }),
  ),
  experimentId: z.string(),
  sparse: postSparseRuleField,
});

const postFeatureExperimentRule = z.object({
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  condition: z.string(),
  id: z.string().optional(),
  enabled: z.boolean().describe("Enabled by default").optional(),
  type: z.literal("experiment"),
  trackingKey: z.string().optional(),
  hashAttribute: z.string().optional(),
  fallbackAttribute: z.string().optional(),
  disableStickyBucketing: z.boolean().optional(),
  bucketVersion: z.number().optional(),
  minBucketVersion: z.number().optional(),
  namespace: z
    .object({
      enabled: z.boolean(),
      name: z.string(),
      range: z.array(z.number()).min(2).max(2),
    })
    .optional(),
  coverage: z.number().optional(),
  prerequisites: z.array(apiRevisionPrerequisite).optional(),
  scheduleRules: z.array(apiScheduleRuleValidator).optional(),
  values: z
    .array(
      z.object({
        value: z.string(),
        weight: z.number(),
        name: z.string().optional(),
      }),
    )
    .optional(),
  value: z
    .array(
      z.object({
        value: z.string(),
        weight: z.number(),
        name: z.string().optional(),
      }),
    )
    .describe(
      "Support passing values under the value key as that was the original spec for FeatureExperimentRules",
    )
    .optional()
    .meta({ deprecated: true }),
});

const postFeatureRule = z.union([
  postFeatureForceRule,
  postFeatureRolloutRule,
  postFeatureExperimentRefRule,
  postFeatureExperimentRule,
]);

const postFeatureEnvironment = z.object({
  enabled: z.boolean(),
  rules: z.array(postFeatureRule),
  definition: z
    .string()
    .describe(
      "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
    )
    .optional(),
  draft: z
    .object({
      enabled: z.boolean().optional(),
      rules: z.array(postFeatureRule),
      definition: z
        .string()
        .describe(
          "A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)",
        )
        .optional(),
    })
    .describe("Use to write draft changes without publishing them.")
    .optional(),
});

// ---- Shared sub-schemas for route validators ----

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

const featureResponseSchema = z
  .object({ feature: apiFeatureValidator })
  .strict();

// ---- PostFeaturePayload ----
const postFeatureBody = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "A unique key name for the feature. Feature keys can only include letters, numbers, hyphens, and underscores.",
      ),
    archived: z.boolean().optional(),
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .describe("Description of the feature")
      .optional(),
    owner: requiredUnlessPatOwnerInputField,
    project: z.string().describe("An associated project ID").optional(),
    valueType: z
      .enum(["boolean", "string", "number", "json"])
      .describe("The data type of the feature payload. Boolean by default."),
    defaultValue: z
      .string()
      .describe(
        "Default value when feature is enabled. Type must match `valueType`. In Config mode (`baseConfig` set) this is the JSON override patch merged on top of the config.",
      ),
    baseConfig: z
      .string()
      .nullable()
      .describe(
        'Key of the config backing this flag ("Config mode"). Requires `valueType: "json"` and a live config; `defaultValue` and rule values become override patches on top. null or omitted for a plain flag.',
      )
      .optional(),
    tags: z.array(z.string()).describe("List of associated tags").optional(),
    environments: z
      .record(z.string(), postFeatureEnvironment)
      .describe(
        "A dictionary of environments that are enabled for this feature. Keys supply the names of environments. Environments belong to organization and are not specified will be disabled by default.",
      )
      .optional(),
    prerequisites: z
      .array(z.string())
      .describe("Feature IDs. Each feature must evaluate to `true`")
      .optional(),
    jsonSchema: z
      .string()
      .describe(
        "Use JSON schema to validate the payload of a JSON-type feature value (enterprise only).",
      )
      .optional(),
    customFields: z.record(z.string(), z.string()).optional(),
  })
  .strict();

// ---- UpdateFeaturePayload ----
const updateFeatureBody = z
  .object({
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .describe("Description of the feature")
      .optional(),
    archived: z.boolean().optional(),
    project: z.string().describe("An associated project ID").optional(),
    owner: ownerInputField.optional(),
    defaultValue: z.string().optional(),
    baseConfig: z
      .string()
      .nullable()
      .describe(
        'Key of the config backing this flag ("Config mode"), or null to detach. Requires `valueType: "json"` and a live config. Omit to leave unchanged.',
      )
      .optional(),
    tags: z
      .array(z.string())
      .describe(
        "List of associated tags. Will override tags completely with submitted list",
      )
      .optional(),
    environments: z.record(z.string(), postFeatureEnvironment).optional(),
    prerequisites: z
      .array(z.string())
      .describe("Feature IDs. Each feature must evaluate to `true`")
      .optional(),
    jsonSchema: z
      .string()
      .describe(
        "Use JSON schema to validate the payload of a JSON-type feature value (enterprise only).",
      )
      .optional(),
    customFields: z.record(z.string(), z.string()).optional(),
    holdout: z
      .object({
        id: z.string().describe("Holdout ID"),
        value: z
          .string()
          .describe(
            "The feature value assigned to users in the holdout treatment group",
          ),
      })
      .nullable()
      .describe(
        "Holdout to assign this feature to. Pass `null` to remove the feature from its current holdout. Omit the field entirely to leave the holdout unchanged.\n",
      )
      .optional(),
  })
  .strict();

// ---- Route validators ----

/**
 * RFC 8594 `Deprecation` header value for v1 feature endpoints.
 *
 * Emits `Deprecation: true` (boolean form, not a date) — signals "stop using
 * this endpoint ASAP" without committing to a removal date. V1 endpoints are
 * expected to remain available indefinitely for backward compatibility, but
 * new integrations should always use v2. If we ever commit to a removal date,
 * switch this to `@<unix-timestamp>` and add a `Sunset:` header alongside.
 */
export const FEATURE_V1_DEPRECATED = "true";

export const listFeaturesValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      projectId: z.string().describe("Filter by project id").optional(),
      clientKey: z
        .string()
        .describe("Filter by a SDK connection's client key")
        .optional(),
      ...skipPaginationQueryField,
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      features: z.array(apiFeatureValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all features",
  description:
    "**Deprecated.** Use [GET /v2/features](#operation/listFeaturesV2) instead.\n\nReturns features with pagination. The skipPagination query parameter is\nhonored only when API_ALLOW_SKIP_PAGINATION is set (self-hosted deployments).\n",
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "listFeatures",
  tags: ["features"],
  method: "get" as const,
  path: "/features",
};

export const postFeatureValidator = {
  bodySchema: postFeatureBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: featureResponseSchema,
  summary: "Create a single feature",
  description:
    "**Deprecated.** Use [POST /v2/features](#operation/postFeatureV2) instead.",
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "postFeature",
  tags: ["features"],
  method: "post" as const,
  path: "/features",
};

export const getFeatureValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      withRevisions: z
        .enum(["all", "drafts", "published", "none"])
        .describe(
          "Also return feature revisions (all, draft, or published statuses)",
        )
        .optional(),
    })
    .strict(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      feature: apiFeatureWithRevisionsValidator,
    })
    .strict(),
  summary: "Get a single feature",
  description:
    "**Deprecated.** Use [GET /v2/features/:id](#operation/getFeatureV2) instead.",
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "getFeature",
  tags: ["features"],
  method: "get" as const,
  path: "/features/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const updateFeatureValidator = {
  bodySchema: updateFeatureBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: featureResponseSchema,
  summary: "Partially update a feature",
  description:
    '**Deprecated.** Use [POST /v2/features/:id](#operation/updateFeatureV2) instead.\n\nUpdates any combination of a feature\'s metadata (description, owner, tags, project), default value, environment settings (rules, kill switches, enabled state), prerequisites, holdout assignment, or JSON schema validation. All provided fields are merged into the existing feature and the result is immediately published as a new revision.\n\nReturns 403 if the API key lacks permission or if approval rules are enabled for an affected environment and the org setting "REST API always bypasses approval requirements" is off.\n',
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "updateFeature",
  tags: ["features"],
  method: "post" as const,
  path: "/features/:id",
};

export const deleteFeatureValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted feature")
        .meta({ example: "feature-123" }),
    })
    .strict(),
  summary: "Deletes a single feature",
  description:
    '**Deprecated.** Use [DELETE /v2/features/:id](#operation/deleteFeatureV2) instead.\n\nPermanently deletes a feature and all of its revisions.\n\nArchived features can be deleted freely. Deleting a live (non-archived) feature returns 403 unless the org setting "REST API always bypasses approval requirements" is enabled, or the API key lacks delete permission.\n',
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "deleteFeature",
  tags: ["features"],
  method: "delete" as const,
  path: "/features/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const toggleFeatureValidator = {
  bodySchema: z
    .object({
      reason: z.string().optional(),
      environments: z.record(
        z.string(),
        z.union([
          z.literal(true),
          z.literal(false),
          z.literal("true"),
          z.literal("false"),
          z.literal("1"),
          z.literal("0"),
          z.literal(1),
          z.literal(0),
          z.literal(""),
        ]),
      ),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: featureResponseSchema,
  summary: "Toggle a feature in one or more environments",
  description:
    '**Deprecated.** Use [POST /v2/features/:id/toggle](#operation/toggleFeatureV2) instead.\n\nEnables or disables a feature in one or more environments simultaneously. Accepts a map of environment name → boolean and immediately publishes the change.\n\nReturns 403 if the API key lacks permission or if approval rules are enabled for an affected environment and the org setting "REST API always bypasses approval requirements" is off.\n',
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "toggleFeature",
  tags: ["features"],
  method: "post" as const,
  path: "/features/:id/toggle",
  exampleRequest: {
    body: {
      reason: "Kill switch activated",
      environments: { production: false },
    },
  },
};

export const revertFeatureValidator = {
  bodySchema: z
    .object({
      revision: z.number(),
      comment: z.string().optional(),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: featureResponseSchema,
  summary: "Revert a feature to a specific revision",
  description:
    '**Deprecated.** Use [POST /v2/features/:id/revert](#operation/revertFeatureV2) instead.\n\nCreates a new revision whose rules and values match a previously-published revision, then immediately publishes it. This leaves a clear audit trail of the revert action in the revision history.\n\nReturns 403 if the API key lacks permission, or if approval rules are enabled for an affected environment and neither the "REST API always bypasses approval requirements" nor the "Allow reverts without approval" org setting is enabled.\n\nReturns 422 with a list of `warnings` if the restored values no longer validate against the feature\'s current value type or JSON schema. Re-submit with `?ignoreWarnings=true` to revert anyway.\n',
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "revertFeature",
  tags: ["features"],
  method: "post" as const,
  path: "/features/:id/revert",
  exampleRequest: { body: { revision: 3, comment: "Bug found" } },
};

export const getFeatureRevisionsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      ...skipPaginationQueryField,
      status: revisionStatusFilterSchema,
      author: z.string().optional(),
    })
    .strict(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      revisions: z.array(apiFeatureRevisionValidator),
    })
    .extend(apiPaginationFieldsValidator.shape),
  summary: "List revisions for a feature",
  description:
    "**Deprecated.** Use [GET /v2/features/:id/revisions](#operation/getFeatureRevisionsV2) instead.\n\nReturns a paginated list of revisions for this feature, sorted newest-first. Optionally filtered by status and/or author.",
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "getFeatureRevisions",
  tags: ["feature-revisions"],
  method: "get" as const,
  path: "/features/:id/revisions",
  exampleRequest: { params: { id: "abc123" } },
};

export const getFeatureStaleValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ids: z
        .string()
        .describe(
          "Comma-separated list of feature IDs (URL-encoded if needed). Example: `my_feature,another_feature`\n",
        ),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      features: z
        .record(
          z.string(),
          z.object({
            featureId: z.string().describe("The feature key"),
            isStale: z
              .boolean()
              .describe(
                "Whether the feature is considered stale overall (all enabled environments are stale). Always false when neverStale is true.",
              ),
            staleReason: z
              .enum([
                "never-stale",
                "recently-updated",
                "active-draft",
                "has-dependents",
                "no-rules",
                "rules-one-sided",
                "abandoned-draft",
                "toggled-off",
                "active-experiment",
                "has-rules",
              ])
              .nullable()
              .describe(
                "Reason for the feature's stale or non-stale status. `never-stale` when stale detection is disabled. Non-stale reasons: `recently-updated`, `active-draft`, `has-dependents`. Stale reasons: `no-rules`, `rules-one-sided`, `abandoned-draft`, `toggled-off`. Null when non-stale with no single cause (see staleByEnv).\n",
              ),
            neverStale: z
              .boolean()
              .describe(
                "When true the feature is permanently excluded from stale detection.",
              ),
            staleByEnv: z
              .record(
                z.string(),
                z.object({
                  isStale: z
                    .boolean()
                    .describe("Whether this environment is stale"),
                  reason: z
                    .enum([
                      "no-rules",
                      "rules-one-sided",
                      "abandoned-draft",
                      "toggled-off",
                      "active-experiment",
                      "has-rules",
                      "recently-updated",
                      "active-draft",
                      "has-dependents",
                    ])
                    .nullable()
                    .describe(
                      "Reason for the stale status in this environment",
                    ),
                  evaluatesTo: z
                    .string()
                    .describe(
                      "The deterministic value this feature evaluates to in this environment. Uses the same raw string encoding as `feature.defaultValue`. Only present when the value is deterministic or the environment is toggled off.\n",
                    )
                    .optional(),
                }),
              )
              .describe(
                "Per-environment staleness breakdown, keyed by environment ID. Present when environments exist and neverStale is false.",
              )
              .optional(),
          }),
        )
        .describe(
          "Map of feature ID to stale status. Only requested features that were found and readable are included.",
        ),
    })
    .strict(),
  summary: "Get stale status for one or more features",
  description:
    "**Deprecated.** Use [GET /v2/stale-features](#operation/getFeatureStaleV2) instead.",
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "getFeatureStale",
  tags: ["features"],
  method: "get" as const,
  path: "/stale-features",
};

export const getFeatureKeysValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      projectId: z.string().describe("Filter by project id").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.array(z.string()),
  summary: "Get list of feature keys",
  description:
    "**Deprecated.** Use [GET /v2/feature-keys](#operation/getFeatureKeysV2) instead.",
  deprecated: true,
  deprecationDate: FEATURE_V1_DEPRECATED,
  operationId: "getFeatureKeys",
  tags: ["features"],
  method: "get" as const,
  path: "/feature-keys",
};

// ---- Derived types ----

export type ListFeaturesResponse = z.infer<
  typeof listFeaturesValidator.responseSchema
>;

export type GetFeatureStaleResponse = z.infer<
  typeof getFeatureStaleValidator.responseSchema
>;

export type FeatureStaleEntry = GetFeatureStaleResponse["features"][string];
