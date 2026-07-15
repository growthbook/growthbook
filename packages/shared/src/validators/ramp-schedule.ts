import { z } from "zod";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { apiBaseSchema, baseSchema } from "./base-model";

import { namedSchema } from "./openapi-helpers";

export const DEFAULT_NO_TRAFFIC_GRACE_PERIOD_HOURS = 24;

// Sparse rule patch applied by ramp steps; absent fields inherit prior state.
export const featureRulePatch = z.object({
  ruleId: z.string(),
  coverage: z
    .number()
    .min(0)
    .max(1)
    .nullish()
    .describe(
      "Traffic fraction (0–1). For monitored steps the rollout rule is promoted to an experiment: treatment = [0, coverage), control = [0.5, 0.5+coverage). Both arms are equal-sized and non-adjacent, so a step-up only adds new users to each arm — no existing user changes group. The REST API enforces coverage ≤ 0.5 on monitored steps so control end never exceeds 1.0. The SDK uses explicit hash ranges on bucketingV2 clients to keep bucketing stable across monitored/unmonitored transitions.",
    ),
  condition: z.string().nullish(),
  savedGroups: z.array(savedGroupTargeting).nullish(),
  prerequisites: z.array(featurePrerequisite).nullish(),
  allEnvironments: z.boolean().nullish(),
  environments: z.array(z.string()).nullish(),
  force: z.unknown().optional().describe("Force value (any JSON type)"),
  enabled: z.boolean().nullish(),
});
export type FeatureRulePatch = z.infer<typeof featureRulePatch>;

// The rule's pre-ramp state, used purely as the rollback/jump-to-start anchor.
// It is NOT applied when the ramp starts — step 0's coverage takes over
// immediately on start. A partial patch is merged onto the rule's current
// state, so `{ coverage: 0 }` keeps existing targeting but rolls back to 0%.
export const rampStartState = featureRulePatch.omit({ ruleId: true });
export type RampStartState = z.infer<typeof rampStartState>;

export const lockdownModeArray = ["none", "locked"] as const;
export type LockdownMode = (typeof lockdownModeArray)[number];

// Lockdown gates external writes to the parent feature, not the ramp itself.
// `locked` blocks publishRevision / startExperiment on the feature while the
// ramp is in an active status (see LOCKDOWN_ACTIVE_STATUSES). The ramp's own
// evaluation and auto-advancement are unaffected — use `pauseSchedule` to
// halt the ramp's progression.
export const lockdownConfigSchema = z.object({
  mode: z.enum(lockdownModeArray),
});
export type LockdownConfig = z.infer<typeof lockdownConfigSchema>;

export const experimentHealthActionArray = [
  "rollback",
  "hold",
  "warn",
] as const;
export const experimentHealthAction = z.enum(experimentHealthActionArray);
export type ExperimentHealthAction = z.infer<typeof experimentHealthAction>;

export const rampMonitoringModeArray = ["auto", "manual"] as const;
export const rampMonitoringMode = z.enum(rampMonitoringModeArray);
export type RampMonitoringMode = z.infer<typeof rampMonitoringMode>;

export const rampMonitoringConfig = z.object({
  datasourceId: z.string(),
  exposureQueryId: z.string(),
  guardrailMetricIds: z.array(z.string()).min(1),
  signalMetricIds: z.array(z.string()).optional(),
  updateScheduleMinutes: z.number().min(10).optional().nullable(),
  monitoringMode: rampMonitoringMode.optional(),
  autoUpdate: z.boolean().optional(),
  srmAction: experimentHealthAction.optional(),
  noTrafficAction: experimentHealthAction.optional(),
  noTrafficGracePeriodHours: z
    .number()
    .positive()
    .nullish()
    .describe(
      "How long to wait for traffic before applying `noTrafficAction`. Defaults to 24 hours when null or not set.",
    ),
  multipleExposureAction: experimentHealthAction.optional(),
});
export type RampMonitoringConfig = z.infer<typeof rampMonitoringConfig>;

export const rampStepAction = z.object({
  targetType: z.literal("feature-rule"),
  targetId: z.string(),
  patch: featureRulePatch,
});
export type RampStepAction = z.infer<typeof rampStepAction>;

export const rampTarget = z.object({
  id: z.string(),
  entityType: z.enum(["feature"]), // TODO v2: add "experiment"
  entityId: z.string(),
  ruleId: z.string().nullish(),
  // Deprecated pre-v2 rule disambiguator.
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

// Step advancement gates beyond the time interval itself. All gates are ANDed
// — the step holds while any gate is unmet, and advances when all are clear.
//
// Note: `minSampleSize` is only meaningful on monitored steps (`step.monitored
// === true`). Non-monitored steps have no snapshot data source, so
// `minSampleSize` on a non-monitored step is silently ignored by the evaluator.
// The schema does not restrict this combination because the UI prevents it and
// the restriction would need to be duplicated in migration/import paths.
export const stepHoldConditions = z.object({
  minSampleSize: z.number().int().positive().optional(),
  requiresApproval: z.boolean().optional(),
});
export type StepHoldConditions = z.infer<typeof stepHoldConditions>;

// Sparse patch per step; absent fields accumulate from previous steps.
// `interval` is the time-based hold in seconds; `null` means no time gate
// (advance as soon as holdConditions clear). Pure approval steps use
// `{ interval: null, holdConditions: { requiresApproval: true } }`.
export const rampStep = z.object({
  interval: z.number().positive().nullable(),
  actions: z.array(rampStepAction),
  approvalNotes: z.string().nullish(),
  monitored: z.boolean().optional(),
  holdConditions: stepHoldConditions.optional(),
});
export type RampStep = z.infer<typeof rampStep>;

export const rampScheduleStatusArray = [
  "pending",
  "ready",
  "running",
  "paused",
  "completed",
  "rolled-back",
] as const;
export type RampScheduleStatus = (typeof rampScheduleStatusArray)[number];

export const rampEventTypeArray = [
  "started",
  "step-advanced",
  "step-jumped",
  "paused",
  "resumed",
  "approval-requested",
  "approval-granted",
  "awaiting-start-approval",
  "start-approved",
  "rollback",
  "reset",
  "restart",
  "completed",
  "config-edited",
  "error-paused",
  "snapshot-triggered",
  "safe-rollout-linked",
  "auto-update-toggled",
] as const;
export type RampEventType = (typeof rampEventTypeArray)[number];

export const rampEvent = z.object({
  type: z.enum(rampEventTypeArray),
  timestamp: z.date(),
  stepIndex: z.number().int().min(-1).optional(),
  previousStepIndex: z.number().int().min(-1).optional(),
  status: z.enum(rampScheduleStatusArray).optional(),
  previousStatus: z.enum(rampScheduleStatusArray).optional(),
  reason: z.string().optional(),
  userId: z.string().optional(),
});
export type RampEvent = z.infer<typeof rampEvent>;

export const rampScheduleValidator = baseSchema
  .extend({
    name: z.string(),
    entityType: z.enum(["feature"]), // TODO v2: add "experiment"
    entityId: z.string(),
    targets: z.array(rampTarget),
    // Restores the controlled rules to their pre-ramp state when rolling back to start.
    startActions: z.array(rampStepAction).optional(),
    steps: z.array(rampStep),
    // Applied on top of accumulated step patches when the ramp completes.
    endActions: z.array(rampStepAction).optional(),
    // When set, the rule stays disabled until this activation date.
    startDate: z.date().nullish(),
    // Persistent config: when true, the -1 → step 0 crossing is gated behind an
    // explicit human approval instead of firing on publish / at startDate.
    // The rule stays disabled (zero traffic) until approved. Composes with
    // startDate: "hold until approved, then arm for that date".
    requiresStartApproval: z.boolean().optional(),
    // Transient marker: set when the current launch is approved, cleared on
    // every return to step -1 (publish, rollback). While requiresStartApproval
    // is true and this is unset, the schedule is held awaiting approval.
    startApprovedAt: z.date().nullish(),
    cutoffDate: z.date().nullish(),
    status: z.enum(rampScheduleStatusArray),
    currentStepIndex: z.number().int().min(-1),
    startedAt: z.date().nullish(),
    phaseStartedAt: z.date().nullish(),
    pausedAt: z.date().nullish(),
    nextStepAt: z.date().nullable(),
    nextProcessAt: z.date().nullish(),
    elapsedMs: z.number().int().nullish(),

    lockdownConfig: lockdownConfigSchema.optional(),

    monitoringConfig: rampMonitoringConfig.nullish(),

    experimentHealthAction: experimentHealthAction.optional(),

    safeRolloutId: z.string().nullish(),

    currentStepEnteredAt: z.date().nullish(),
    stepApproval: z
      .object({
        stepIndex: z
          .number()
          .int()
          .describe("Index of the step that was approved."),
        approvedAt: z.date().describe("When the approval was granted."),
        approvedBy: z.string().describe("User ID of the approver."),
        context: z
          .enum(["ui", "api"])
          .describe("Surface through which the approval was granted."),
      })
      .nullish()
      .describe(
        "Approval record for the current step's `holdConditions.requiresApproval` gate. " +
          "Only valid while `stepApproval.stepIndex === currentStepIndex`. " +
          "Cleared on step advance, jump, or restart.",
      ),
    monitoringStartDate: z.date().nullish(),
    nextSnapshotAt: z.date().nullish(),
    lastRollbackAt: z.date().nullish(),
    lastRollbackReason: z.string().nullish(),

    // Per-schedule advance lock. Serializes progression across the resume HTTP
    // path and the scheduler job so they can't concurrently replay/publish and
    // clobber each other's coverage. `advanceLockAt` powers a stale fallback so
    // a crashed holder can't wedge the schedule forever.
    advanceLockToken: z.string().nullish(),
    advanceLockAt: z.date().nullish(),

    // Append-only playhead history.
    eventHistory: z.array(rampEvent).optional(),
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
    for (let i = 0; i < data.steps.length; i++) {
      const step = data.steps[i];
      if (!step.monitored) continue;
      for (const action of step.actions) {
        if (action.patch.coverage === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Monitored steps must have coverage greater than 0. There is nothing to monitor at 0% traffic.",
            path: ["steps", i],
          });
        }
        if (
          action.patch.coverage !== undefined &&
          action.patch.coverage !== null &&
          action.patch.coverage > 0.5
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Monitored steps must have coverage ≤ 0.5 (50%). Higher values produce an asymmetric treatment/control split. Use 0.5 for a full 50/50 experiment.",
            path: ["steps", i],
          });
        }
      }
    }
  });

export type RampScheduleInterface = z.infer<typeof rampScheduleValidator>;

// The start-approval gate is armed but not yet cleared for the current launch:
// the schedule opted into requiresStartApproval and hasn't recorded an approval.
// Status-independent — use this at the actual -1 → 0 crossing (where the status
// is already "running") as the invariant. `isAwaitingStartApproval` layers the
// pre-start status/step conditions on top for UI/notification display.
export function startApprovalPending(schedule: {
  requiresStartApproval?: boolean | null;
  startApprovedAt?: Date | null;
}): boolean {
  return !!schedule.requiresStartApproval && !schedule.startApprovedAt;
}

// Resolve the post-edit start-approval value from a pending action against a
// base (live/existing) schedule. Tri-state: `true`/`false` = explicit set,
// `null` = explicit off, `undefined` = leave the base value. Centralizes the
// null-vs-undefined handling so serialization/merge sites can't drift.
export function resolveStartApproval(
  actionValue: boolean | null | undefined,
  baseValue: boolean | null | undefined,
): boolean {
  return actionValue !== undefined ? !!actionValue : !!baseValue;
}

// Derives the "awaiting start approval" state: a pre-start schedule that
// opted into requiresStartApproval and hasn't been approved for the
// current launch yet. This is the one-time hold on the -1 → step 0 crossing;
// it re-arms on every return to step -1 (publish, rollback) because
// startApprovedAt is cleared there. Used by UI, notifications, and the
// engine's start/advance gating in lieu of a stored status.
export function isAwaitingStartApproval(schedule: {
  status: string;
  currentStepIndex: number;
  requiresStartApproval?: boolean;
  startApprovedAt?: Date | null;
}): boolean {
  return (
    startApprovalPending(schedule) &&
    schedule.currentStepIndex < 0 &&
    // "ready" is the live pre-start hold. "pending" is the same intent before
    // the activating revision publishes (including synthetic draft-preview
    // schedules) — both surface as "awaiting approval". A running schedule
    // at -1 is a transient mid-transition state, not a user-facing hold.
    (schedule.status === "ready" || schedule.status === "pending")
  );
}

// Derives the "awaiting approval" display state. A `running` schedule whose
// current step has `holdConditions.requiresApproval` set and whose
// `stepApproval.stepIndex` does not match `currentStepIndex` (i.e. not yet
// approved for this step) is awaiting approval. Used by UI, notifications,
// and evaluator gating in lieu of a stored "pending-approval" status.
export function isAwaitingApproval(schedule: {
  status: string;
  currentStepIndex: number;
  steps: { holdConditions?: { requiresApproval?: boolean } }[];
  stepApproval?: { stepIndex: number } | null;
}): boolean {
  if (schedule.status !== "running") return false;
  const step = schedule.steps[schedule.currentStepIndex];
  return (
    !!step?.holdConditions?.requiresApproval &&
    schedule.stepApproval?.stepIndex !== schedule.currentStepIndex
  );
}

/**
 * Whether the current step is *ready* to be approved right now.
 *
 * Approval is the final gate: a step that also has an interval must finish that
 * interval before we prompt for (or accept) an approval. `isAwaitingApproval`
 * answers "does this step still need an approval at some point"; this answers
 * "should we surface the approval prompt now". Use this to gate Approve CTAs so
 * the user is never asked to sign off on a step whose timer is still counting
 * down.
 *
 * This is a time-based check only. For monitored steps it confirms the hold
 * interval has elapsed, but it cannot see whether fresh analysis is available —
 * that (and any failing guardrail/health signal) is enforced server-side by
 * the approve-step endpoint, which rejects premature approvals.
 */
export function isReadyForApproval(
  schedule: {
    status: string;
    currentStepIndex: number;
    steps: {
      interval?: number | null;
      monitored?: boolean;
      holdConditions?: { requiresApproval?: boolean };
    }[];
    stepApproval?: { stepIndex: number } | null;
    nextStepAt?: Date | string | number | null;
    currentStepEnteredAt?: Date | string | number | null;
  },
  now: Date = new Date(),
): boolean {
  if (!isAwaitingApproval(schedule)) return false;

  const step = schedule.steps[schedule.currentStepIndex];
  // No interval means there is no time hold — approval is the only gate.
  if (!step || step.interval == null) return true;

  // Monitored steps clear `nextStepAt` and track their interval relative to
  // `currentStepEnteredAt`.
  if (step.monitored) {
    if (schedule.currentStepEnteredAt == null) return false;
    const enteredAt = new Date(schedule.currentStepEnteredAt).getTime();
    return now.getTime() >= enteredAt + step.interval * 1000;
  }

  // Non-monitored steps use `nextStepAt` as the interval timer.
  if (schedule.nextStepAt == null) return true;
  return new Date(schedule.nextStepAt).getTime() <= now.getTime();
}

export const TEMPLATE_PATCH_FIELDS = [
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
  "allEnvironments",
  "environments",
] as const;
export const TEMPLATE_STRUCTURAL_KEYS = [
  "steps",
  "endPatch",
  "monitoringConfig",
] as const;

const templateFeatureRulePatch = featureRulePatch.omit({ force: true });
const templateRampStepAction = rampStepAction.extend({
  patch: templateFeatureRulePatch,
});
const templateRampStep = rampStep.extend({
  actions: z.array(templateRampStepAction),
});

export const templateEndPatchValidator = z.object({
  coverage: z.number().min(0).max(1).optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
  allEnvironments: z.boolean().optional(),
  environments: z.array(z.string()).optional(),
});
export type TemplateEndPatch = z.infer<typeof templateEndPatchValidator>;

export const rampScheduleTemplateValidator = baseSchema.extend({
  name: z.string(),
  steps: z.array(templateRampStep),
  endPatch: templateEndPatchValidator.optional(),
  official: z.boolean().optional(),
  lockdownConfig: lockdownConfigSchema.optional(),
  monitoringConfig: rampMonitoringConfig.nullish(),
  // Manual display/priority order within the org. Lower sorts first; the first
  // official template in this order is used as the editor default.
  order: z.number(),
});
export type RampScheduleTemplateInterface = z.infer<
  typeof rampScheduleTemplateValidator
>;

// Body for reordering templates: move `oldId` to the slot currently held by
// `newId` (mirrors the custom-fields reorder contract).
export const reorderRampScheduleTemplatesValidator = z
  .object({
    oldId: z.string(),
    newId: z.string(),
  })
  .strict();

// Public API step shape. `interval` is the hold duration in seconds; `null`
// means no time gate. Pure approval steps use
// `{ interval: null, holdConditions: { requiresApproval: true } }`.
const apiRampStepCommon = {
  interval: z
    .number()
    .positive()
    .nullable()
    .describe(
      "Hold duration in seconds before this step's gates are evaluated. null = no time gate (advance as soon as holdConditions clear).",
    ),
  approvalNotes: z.string().nullish(),
  monitored: z
    .boolean()
    .optional()
    .describe(
      "When true, this step runs A/B traffic analysis while active. Treatment = [0, coverage), control = [0.5, 0.5+coverage). Arms are equal-sized and non-adjacent: step-ups only add users, never reassign existing ones. The UI caps monitored-step coverage at 0.5 so control end never exceeds 1.0. The SDK uses explicit hash ranges on the experiment rule to prevent bucketing shifts across monitored/unmonitored transitions.",
    ),
  holdConditions: stepHoldConditions.optional(),
};

export const apiTemplateRampStep = z.object({
  ...apiRampStepCommon,
  actions: z.array(templateRampStepAction),
});
export type ApiTemplateRampStep = z.infer<typeof apiTemplateRampStep>;

export const apiRampScheduleTemplateValidator = namedSchema(
  "RampScheduleTemplate",
  apiBaseSchema.extend({
    name: z.string(),
    steps: z.array(apiTemplateRampStep),
    endPatch: templateEndPatchValidator.optional(),
    official: z.boolean().optional(),
    monitoringConfig: rampMonitoringConfig.nullish(),
    lockdownConfig: lockdownConfigSchema.nullish(),
    order: z
      .number()
      .describe(
        "Manual display order within the org (read-only; managed via the app).",
      ),
  }),
);

const apiRampStep = z.object({
  ...apiRampStepCommon,
  actions: z.array(rampStepAction),
});

export const apiRampScheduleInterface = namedSchema(
  "RampSchedule",
  apiBaseSchema.extend({
    id: z.string().describe("Unique identifier (rs_ prefix)"),
    name: z.string(),
    entityType: z.enum(["feature"]),
    entityId: z.string(),
    targets: z.array(rampTarget).describe("Controlled entity references"),
    startActions: z
      .array(rampStepAction)
      .optional()
      .describe(
        "Actions that restore controlled rules to their pre-ramp state. Applied when rolling back or jumping to start.",
      ),
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
    requiresStartApproval: z
      .boolean()
      .optional()
      .describe(
        "When true, the ramp holds at step -1 with its rule disabled (zero traffic) until a human approves the start via /actions/approve-step. Composes with startDate ('hold until approved, then arm for that date').",
      ),
    startApprovedAt: z.iso
      .datetime()
      .nullish()
      .describe(
        "When the current launch's start was approved. Cleared on every return to step -1 (publish, rollback), re-arming the approval gate.",
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
        "Anchor for cumulative interval timing; resets after each approval gate is satisfied",
      ),
    pausedAt: z.iso.datetime().nullish(),
    nextStepAt: z.iso
      .datetime()
      .nullable()
      .describe(
        "When the current step's time gate elapses; null for steps with no interval (pure approval gates) and terminal states",
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
    experimentHealthAction: experimentHealthAction.optional(),
    currentStepEnteredAt: z.iso.datetime().nullish(),
    stepApproval: z
      .object({
        stepIndex: z
          .number()
          .int()
          .describe("Index of the step that was approved."),
        approvedAt: z.iso.datetime().describe("When the approval was granted."),
        approvedBy: z.string().describe("User ID of the approver."),
        context: z
          .enum(["ui", "api"])
          .describe("Surface through which the approval was granted."),
      })
      .nullish()
      .describe(
        "Approval record for the current step. Valid only while `stepApproval.stepIndex === currentStepIndex`.",
      ),
    monitoringStartDate: z.iso
      .datetime()
      .nullish()
      .describe(
        "When the monitored section most recently started (first monitored step entered). Used for no-traffic grace period gating.",
      ),
    lastRollbackAt: z.iso.datetime().nullish(),
    lastRollbackReason: z.string().nullish(),
    monitoringStatus: z
      .object({
        safeRolloutId: z.string().nullish(),
        monitoringMode: rampMonitoringMode.describe(
          "User-selected monitoring mode. `auto` schedules snapshots automatically; `manual` requires clicking Update.",
        ),
        autoUpdate: z
          .boolean()
          .describe(
            "Legacy alias for auto-update behavior. Prefer `monitoringMode` (`auto` means true, `manual` means false).",
          ),
        effectiveAutoUpdate: z
          .boolean()
          .describe(
            "Computed runtime flag. True only when monitoring mode is auto and schedule state allows automatic snapshot scheduling.",
          ),
        blockedReason: z
          .string()
          .nullish()
          .describe(
            "When `effectiveAutoUpdate` is false, this describes the computed reason auto-updates are currently blocked.",
          ),
        nextSnapshotAt: z.iso
          .datetime()
          .nullish()
          .describe("When the next automatic snapshot query will run"),
        currentStepMonitored: z
          .boolean()
          .describe(
            "Whether the step at currentStepIndex has monitoring enabled",
          ),
      })
      .nullish()
      .describe(
        "Read-only monitoring status. Present when monitoringConfig is set.",
      ),
  }),
);
export type ApiRampScheduleInterface = z.infer<typeof apiRampScheduleInterface>;

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
