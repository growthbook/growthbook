import { z } from "zod";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { apiBaseSchema, baseSchema } from "./base-model";

import { namedSchema } from "./openapi-helpers";

// ---------------------------------------------------------------------------
// Feature rule patch (used by rule-level ramps)
// ---------------------------------------------------------------------------

// Patch applied to a feature rule by a ramp step. Only fields present in the patch are applied;
// absent fields are inherited from the previous step's accumulated state.
//
// Rule identification: `ruleId` is the targeting handle. In v2 it is uniquely
// sufficient within a feature's unified rule list. `environment` on the
// surrounding target provides a legacy disambiguator for pre-v2 documents;
// new ramps omit it. See `resolveRampTarget` in back-end's flattenRules.
export const featureRulePatch = z.object({
  ruleId: z.string(),
  coverage: z.number().min(0).max(1).nullish(),
  condition: z.string().nullish(),
  savedGroups: z.array(savedGroupTargeting).nullish(),
  prerequisites: z.array(featurePrerequisite).nullish(),
  force: z.any().optional().describe("Force value (any JSON type)"),
  // system-managed: injected as enabled:true when the ramp fires
  enabled: z.boolean().nullish(),
});
export type FeatureRulePatch = z.infer<typeof featureRulePatch>;

// ---------------------------------------------------------------------------
// Lockdown config
// ---------------------------------------------------------------------------

export const lockdownModeArray = ["none", "locked"] as const;
export type LockdownMode = (typeof lockdownModeArray)[number];

export const lockdownConfigSchema = z.object({
  mode: z.enum(lockdownModeArray),
});
export type LockdownConfig = z.infer<typeof lockdownConfigSchema>;

// ---------------------------------------------------------------------------
// Guardrail settings — per-metric behavioral configuration
// ---------------------------------------------------------------------------

// Schedule-level action when a guardrail metric is statistically losing
export const guardrailTopLevelActionArray = [
  "rollback",
  "pause",
  "warn",
] as const;
export const guardrailTopLevelAction = z.enum(guardrailTopLevelActionArray);
export type GuardrailTopLevelAction = z.infer<typeof guardrailTopLevelAction>;

// Step-level action when a guardrail metric is unhealthy during that step
export const guardrailStepActionArray = ["hold", "warn", "ignore"] as const;
export const guardrailStepAction = z.enum(guardrailStepActionArray);
export type GuardrailStepAction = z.infer<typeof guardrailStepAction>;

const perMetricTopLevel = z.object({
  onUnhealthy: guardrailTopLevelAction,
});

const perMetricStepLevel = z.object({
  onUnhealthy: guardrailStepAction,
});

export const scheduleGuardrailSettings = z.object({
  metrics: z.record(z.string(), perMetricTopLevel),
  experimentHealthAction: guardrailTopLevelAction,
});
export type ScheduleGuardrailSettings = z.infer<
  typeof scheduleGuardrailSettings
>;

export const stepGuardrailSettings = z.object({
  metrics: z.record(z.string(), perMetricStepLevel),
  experimentHealthAction: guardrailStepAction,
});
export type StepGuardrailSettings = z.infer<typeof stepGuardrailSettings>;

// ---------------------------------------------------------------------------
// Monitoring config — schedule-level analysis settings for monitored steps
// ---------------------------------------------------------------------------

export const rampMonitoringConfig = z.object({
  datasourceId: z.string(),
  exposureQueryId: z.string(),
  guardrailMetricIds: z.array(z.string()).min(1),
  /** @deprecated Use `guardrailSettings` on the schedule instead. */
  autoRollback: z.boolean().optional(),
  updateScheduleMinutes: z.number().positive().optional().nullable(),
});
export type RampMonitoringConfig = z.infer<typeof rampMonitoringConfig>;

// ---------------------------------------------------------------------------
// Step action
// ---------------------------------------------------------------------------

export const rampStepAction = z.object({
  targetType: z.literal("feature-rule"),
  targetId: z.string(),
  patch: featureRulePatch,
});
export type RampStepAction = z.infer<typeof rampStepAction>;

// activatingRevisionVersion: set when ramp is created alongside a rule change; cleared on publish.
//
// Rule identification:
//   - `ruleId` is the targeting handle. In v2 it is uniquely sufficient within
//     a feature's unified rule list (no v1 "same id in multiple envs" ambiguity).
//   - `environment` is DEPRECATED as a target field. It was a v1-era
//     disambiguator when the same `ruleId` could appear in multiple env-scoped
//     rule lists. Resolver still honors it for pre-v2 targets. New writes
//     will stop populating it once the remaining read sites (event dispatch
//     env derivation, UI filter, delete-by-(ruleId,env) matching) derive env
//     scope from the resolved rule instead.
export const rampTarget = z.object({
  id: z.string(),
  entityType: z.enum(["feature"]), // TODO v2: add "experiment"
  entityId: z.string(),
  ruleId: z.string().nullish(),
  /**
   * @deprecated Legacy disambiguator for pre-v2 ramps. New targets omit this.
   *
   * Only surfaces in the direct `/ramp-schedules/*` REST API (via
   * `apiRampScheduleInterface`). Feature-revision ramp-action routes embed
   * `rampStepAction` / `featureRulePatch`, not `rampTarget`, so this
   * deprecation flag does not bleed into those legacy v1 schemas.
   */
  environment: z
    .string()
    .nullish()
    .meta({ deprecated: true })
    .describe(
      "Legacy disambiguator used alongside `ruleId` for pre-v2 ramps. May be null on newer targets.",
    ),
  status: z.enum(["pending-join", "active"]),
  activatingRevisionVersion: z
    .number()
    .int()
    .nullish()
    .describe(
      "Feature revision version that activates this ramp; cleared once published",
    ),
});
export type RampTarget = z.infer<typeof rampTarget>;

// Internal only — legacy DB compat for existing endCondition documents.
// New code should use cutoffDate exclusively.
const rampEndTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scheduled"), at: z.coerce.date() }),
]);

export const rampTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("interval"), seconds: z.number().positive() }),
  z.object({ type: z.literal("approval") }),
  z.object({ type: z.literal("scheduled"), at: z.coerce.date() }),
]);
export type RampTrigger = z.infer<typeof rampTrigger>;

// Hold conditions gate step advancement beyond the trigger (timing-related).
export const stepHoldConditions = z.object({
  minDurationMs: z.number().int().positive().optional(),
  maxDurationMs: z.number().int().positive().optional(),
  /** @deprecated Use step-level `guardrailSettings` instead. */
  minSampleSize: z.number().int().positive().optional(),
  /** @deprecated Use step-level `guardrailSettings` instead. */
  requireHealthy: z.boolean().optional(),
});
export type StepHoldConditions = z.infer<typeof stepHoldConditions>;

// Sparse patch per step — only fields present are applied; absent fields accumulate from previous steps.
export const rampStep = z.object({
  trigger: rampTrigger,
  actions: z.array(rampStepAction),
  approvalNotes: z.string().nullish(),
  monitored: z.boolean().optional(),
  holdConditions: stepHoldConditions.optional(),
  guardrailSettings: stepGuardrailSettings.optional(),
});
export type RampStep = z.infer<typeof rampStep>;

export const rampScheduleStatusArray = [
  "pending",
  "ready",
  "running",
  "paused",
  "pending-approval",
  "completed",
  "rolled-back",
] as const;
export type RampScheduleStatus = (typeof rampScheduleStatusArray)[number];

export const rampScheduleValidator = baseSchema
  .extend({
    name: z.string(),
    // Controls permissions and approval settings for the schedule.
    entityType: z.enum(["feature"]), // TODO v2: add "experiment"
    entityId: z.string(),
    targets: z.array(rampTarget),
    steps: z.array(rampStep),
    // Actions applied when the ramp completes (on top of all accumulated step patches).
    // Represents the final desired state of the rule after ramp completion.
    endActions: z.array(rampStepAction).optional(),
    // When set, the rule is kept disabled until this date, then Step 1 is applied.
    // null/absent means the ramp starts immediately when the activating revision is published.
    startDate: z.date().nullish(),
    /**
     * @deprecated Use `cutoffDate` instead for new schedules. Retained for
     * backward compatibility. The backend normalizes legacy endCondition
     * scheduled triggers to cutoffDate at runtime.
     */
    endCondition: z
      .object({
        trigger: rampEndTrigger.optional(),
      })
      .nullish(),
    // Rule-level kill date. When reached, the ramp is completed and the rule
    // is disabled (enabled=false). Use for time-boxed rules that must stop
    // serving on a fixed date regardless of ramp progress. Set to null to clear.
    cutoffDate: z.date().nullish(),
    status: z.enum(rampScheduleStatusArray),
    currentStepIndex: z.number().int().min(-1),
    startedAt: z.date().nullish(),
    phaseStartedAt: z.date().nullish(), // interval timing anchor; resets after approval gates
    pausedAt: z.date().nullish(),
    nextStepAt: z.date().nullable(),
    nextProcessAt: z.date().nullish(), // next time the job should process this schedule; null = no polling needed
    elapsedMs: z.number().int().nullish(), // computed at response time; never stored

    // Lockdown restrictions while the schedule is active.
    lockdownConfig: lockdownConfigSchema.optional(),

    // Schedule-level monitoring settings (datasource, guardrails, query cadence).
    // Applies to all steps marked `monitored: true`.
    monitoringConfig: rampMonitoringConfig.nullish(),

    // Per-metric guardrail behavior and experiment health action at the schedule level.
    // null = explicitly cleared (fall back to defaults); undefined = not set.
    guardrailSettings: scheduleGuardrailSettings.nullish(),

    // Linked SafeRollout ID. Set when a monitored ramp schedule creates or
    // attaches to a SafeRollout experiment for analysis/snapshots.
    safeRolloutId: z.string().nullish(),

    // Runtime tracking fields
    currentStepEnteredAt: z.date().nullish(),
    // Next time the ramp job should trigger a snapshot for the current
    // monitored step. Drives nextProcessAt when nextStepAt is null.
    nextSnapshotAt: z.date().nullish(),
    lastRollbackAt: z.date().nullish(),
    lastRollbackReason: z.string().nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.steps.length === 0 && !data.startDate && !data.cutoffDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A ramp schedule with no steps must have a startDate or cutoffDate.",
        path: ["steps"],
      });
    }
  });

export type RampScheduleInterface = z.infer<typeof rampScheduleValidator>;

// Patch fields that are portable across features and can be stored in a template.
// Excludes `force` (feature-type-specific) and `enabled`/`ruleId` (system-injected).
export const TEMPLATE_PATCH_FIELDS = [
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
] as const;
// Top-level behavioral keys of a template (excludes metadata: id, name, org, dates).
// Start/end timing is not stored in templates; endPatch (final coverage/effects) is.
export const TEMPLATE_STRUCTURAL_KEYS = [
  "steps",
  "endPatch",
  "monitoringConfig",
  "guardrailSettings",
] as const;

// Template patches never store force — it is feature-type-specific and not portable.
const templateFeatureRulePatch = featureRulePatch.omit({ force: true });
const templateRampStepAction = rampStepAction.extend({
  patch: templateFeatureRulePatch,
});
const templateRampStep = rampStep.extend({
  actions: z.array(templateRampStepAction),
});

// End patch stored in a template: the final coverage/effects applied when the ramp completes.
// No ruleId (template has no targets), no force (feature-type-specific), no enabled (system-managed).
export const templateEndPatchValidator = z.object({
  coverage: z.number().min(0).max(1).optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
});
export type TemplateEndPatch = z.infer<typeof templateEndPatchValidator>;

// Template: defines intermediate steps and final end patch (no start/end timing).
export const rampScheduleTemplateValidator = baseSchema.extend({
  name: z.string(),
  steps: z.array(templateRampStep),
  endPatch: templateEndPatchValidator.optional(),
  official: z.boolean().optional(),
  lockdownConfig: lockdownConfigSchema.optional(),
  monitoringConfig: rampMonitoringConfig.nullish(),
  guardrailSettings: scheduleGuardrailSettings.nullish(),
});
export type RampScheduleTemplateInterface = z.infer<
  typeof rampScheduleTemplateValidator
>;

// API-facing step schema — identical to the DB variant except scheduled trigger uses
// an ISO string instead of a Date object (the API serializes dates as strings).
const apiRampTrigger = z.union([
  z.object({ type: z.literal("interval"), seconds: z.number().positive() }),
  z.object({ type: z.literal("approval") }),
  z.object({ type: z.literal("scheduled"), at: z.iso.datetime() }),
]);

// Template step action for the API — same as the DB variant (no date fields in actions).
export const apiTemplateRampStep = z.object({
  trigger: apiRampTrigger,
  actions: z.array(templateRampStepAction),
  approvalNotes: z.string().nullish(),
  monitored: z.boolean().optional(),
  holdConditions: stepHoldConditions.optional(),
  guardrailSettings: stepGuardrailSettings.optional(),
});
export type ApiTemplateRampStep = z.infer<typeof apiTemplateRampStep>;

// API-facing variant — uses ISO strings for dates (for OpenApiModelSpec compatibility).
export const apiRampScheduleTemplateValidator = namedSchema(
  "RampScheduleTemplate",
  apiBaseSchema.extend({
    name: z.string(),
    steps: z.array(apiTemplateRampStep),
    endPatch: templateEndPatchValidator.optional(),
    official: z.boolean().optional(),
    monitoringConfig: rampMonitoringConfig.nullish(),
    guardrailSettings: scheduleGuardrailSettings.nullish(),
    lockdownConfig: lockdownConfigSchema.nullish(),
  }),
);

// API-facing ramp step — uses ISO strings for scheduled trigger dates.
const apiRampStep = z.object({
  trigger: apiRampTrigger,
  actions: z.array(rampStepAction),
  approvalNotes: z.string().nullish(),
  monitored: z.boolean().optional(),
  holdConditions: stepHoldConditions.optional(),
  guardrailSettings: stepGuardrailSettings.optional(),
});

// API-facing variant of rampScheduleValidator — uses ISO strings for all dates.
export const apiRampScheduleInterface = namedSchema(
  "RampSchedule",
  apiBaseSchema.extend({
    id: z.string().describe("Unique identifier (rs_ prefix)"),
    name: z.string(),
    entityType: z.enum(["feature"]),
    entityId: z.string(),
    targets: z.array(rampTarget).describe("Controlled entity references"),
    steps: z.array(apiRampStep).describe("Ordered ramp steps"),
    endActions: z
      .array(rampStepAction)
      .optional()
      .describe(
        "Actions applied on top of all step patches when the ramp completes. Represents the final desired rule state.",
      ),
    startDate: z.iso
      .datetime()
      .nullish()
      .describe(
        "When the ramp fires. Absent/null means immediately on publish; set to a future datetime to delay start and keep the rule disabled until that time.",
      ),
    cutoffDate: z.iso
      .datetime()
      .nullish()
      .describe(
        "Rule-level kill date. When reached, the ramp is completed and the rule is disabled (enabled=false). Use for time-boxed rules that must stop serving on a fixed date regardless of ramp progress. Set to null to clear.",
      ),
    status: z.enum(rampScheduleStatusArray),
    currentStepIndex: z
      .number()
      .int()
      .min(-1)
      .describe("Index of current step; -1 = not yet started"),
    startedAt: z.iso.datetime().nullish(),
    phaseStartedAt: z.iso
      .datetime()
      .nullish()
      .describe(
        "Anchor for cumulative interval timing; resets after each approval gate",
      ),
    pausedAt: z.iso.datetime().nullish(),
    nextStepAt: z.iso
      .datetime()
      .nullable()
      .describe(
        "When the next step fires; null for approval steps and terminal states",
      ),
    nextProcessAt: z.iso.datetime().nullish(),
    elapsedMs: z
      .number()
      .int()
      .nullish()
      .describe(
        "Milliseconds since startedAt (computed at response time, not stored)",
      ),
    lockdownConfig: lockdownConfigSchema.optional(),
    monitoringConfig: rampMonitoringConfig.nullish(),
    guardrailSettings: scheduleGuardrailSettings.nullish(),
    currentStepEnteredAt: z.iso.datetime().nullish(),
    lastRollbackAt: z.iso.datetime().nullish(),
    lastRollbackReason: z.string().nullish(),
  }),
);
export type ApiRampScheduleInterface = z.infer<typeof apiRampScheduleInterface>;

// Minimal type for pending/draft ramp schedules before full data is available.
export type RampScheduleForDisplay = Partial<RampScheduleInterface> & {
  id: string;
  status: RampScheduleInterface["status"];
  name: string;
  targets: RampScheduleInterface["targets"];
  steps: RampScheduleInterface["steps"];
  startDate?: RampScheduleInterface["startDate"];
  dateCreated: Date;
  dateUpdated: Date;
};
