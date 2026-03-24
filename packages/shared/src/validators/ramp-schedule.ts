import { z } from "zod";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { baseSchema } from "./base-model";

// Sparse patch for a feature rule — only ramped fields included.
// The ramp service merges this with current state to build a full revision change set.
export const featureRulePatch = z.object({
  ruleId: z.string(),
  coverage: z.number().min(0).max(1).optional(),
  condition: z.string().optional(),
  savedGroups: z.array(savedGroupTargeting).optional(),
  prerequisites: z.array(featurePrerequisite).optional(),
  force: z.unknown().optional(),
  // Internal only — managed automatically by disableRuleBeforeStart / disableRuleAfterComplete.
  // Never user-authored or shown in the UI.
  enabled: z.boolean().optional(),
});
export type FeatureRulePatch = z.infer<typeof featureRulePatch>;

// A single action within a step. targetId references rampTarget.id in targets[].
export const rampStepAction = z.object({
  targetId: z.string(),
  patch: featureRulePatch,
});
export type RampStepAction = z.infer<typeof rampStepAction>;

// Controlled entity reference with lifecycle status. Targets can be added/ejected via the REST API.
export const rampTarget = z.object({
  id: z.string(),
  entityType: z.enum(["feature"]), // TODO v2: add "experiment"
  entityId: z.string(),
  ruleId: z.string().optional(),
  environment: z.string().optional(),
  status: z.enum(["pending-join", "active", "pending-eject", "ejected"]),
  joinRevisionId: z.string().optional(),
  ejectRevisionId: z.string().optional(),
  // Version of the draft revision whose publication activates this ramp.
  // Set when the ramp is created atomically alongside a rule change.
  // Once all targets have had their activating revisions published the ramp
  // transitions out of "pending" based on startTrigger.
  activatingRevisionVersion: z.number().int().optional(),
});
export type RampTarget = z.infer<typeof rampTarget>;

// Start trigger — always present, defaults to "immediately" for legacy documents.
// "immediately": auto-starts when the activating draft is published.
// "manual":      transitions to "ready" on publish; requires explicit user start action.
// "scheduled":   transitions to "ready" on publish; Agenda auto-starts when now >= at.
export const rampStartTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediately") }),
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("scheduled"), at: z.date() }),
]);
export type RampStartTrigger = z.infer<typeof rampStartTrigger>;

// End schedule trigger. "scheduled": fires when now >= at, discards pending steps,
// and applies endSchedule.actions regardless of current progress.
export const rampEndTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scheduled"), at: z.date() }),
  // Future: z.object({ type: z.literal("criteria"), criteriaId: z.string() }),
]);
export type RampEndTrigger = z.infer<typeof rampEndTrigger>;

// Step trigger. "interval": auto-advance after N cumulative seconds from phaseStartedAt
// (nextStepAt = phaseStartedAt + sum(seconds[0..stepIndex]); resets after approval gates).
// "approval": manual gate — requests review and blocks until approved.
// "scheduled": fires at an absolute datetime.
export const rampTrigger = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    seconds: z.number().positive(),
  }),
  z.object({ type: z.literal("approval") }),
  z.object({ type: z.literal("scheduled"), at: z.date() }),
  // Future: criteria-gated advancement (references existing DecisionCriteria entity)
  // z.object({
  //   type: z.literal("criteria"),
  //   criteriaId: z.string(),
  //   minHoldSeconds: z.number().optional(),
  //   maxHoldSeconds: z.number().optional(),
  //   onFailure: z.enum(["pause", "rollback"]).optional(),
  // }),
]);
export type RampTrigger = z.infer<typeof rampTrigger>;

export const rampStep = z.object({
  trigger: rampTrigger,
  actions: z.array(rampStepAction).min(1),
  notifyOnEntry: z.boolean().optional(),
});
export type RampStep = z.infer<typeof rampStep>;

export const rampAttribution = z.object({
  type: z.enum(["schedule", "manual", "system"]),
  userId: z.string().optional(),
  reason: z.string().optional(),
  source: z.string().optional(),
});
export type RampAttribution = z.infer<typeof rampAttribution>;

// Rollback to step N: accumulate previousValues from currentStepIndex down to N+1 per targetId.
// Lower-index steps overwrite higher-index steps on overlapping fields (higher rewind precedence).
export const stepHistoryEntry = z.object({
  stepIndex: z.number().int(),
  enteredAt: z.date(),
  completedAt: z.date().optional(),
  revisionIds: z.array(z.string()),
  // Sparse patch-shaped snapshot — only the specific fields this step changed, per target.
  // Full rollback and N-step rollbacks are computed by accumulating these across steps.
  previousValues: z.array(
    z.object({
      targetId: z.string(),
      patch: featureRulePatch,
    }),
  ),
  triggeredBy: rampAttribution,
});
export type StepHistoryEntry = z.infer<typeof stepHistoryEntry>;

export const rampScheduleStatusArray = [
  "pending",
  "ready",
  "running",
  "paused",
  "pending-approval",
  "conflict",
  "completed",
  "expired",
  "rolled-back",
] as const;
export type RampScheduleStatus = (typeof rampScheduleStatusArray)[number];

export const rampScheduleValidator = baseSchema
  .extend({
    name: z.string(),
    // Parent controller entity — its permissions govern the schedule;
    // its approval settings determine whether approval-gated revisions require review.
    entityType: z.enum(["feature"]), // TODO v2: add "experiment"
    entityId: z.string(),
    targets: z.array(rampTarget).min(1),
    // Steps may be empty when a start/end anchor pair alone defines the ramp
    // (e.g. a timed sale: auto-start Jan 15, auto-teardown Feb 1 with no intervening steps).
    steps: z.array(rampStep),
    // When set, a failing criteria result from evaluateAutoRollback() triggers rollback.
    autoRollback: z
      .object({ enabled: z.boolean(), criteriaId: z.string() })
      .optional(),
    // Controls when the ramp starts after the activating draft revision is published.
    // "immediately": auto-start on revision publish.
    // "manual": transition to "ready"; requires user to click Start.
    // "scheduled": transition to "ready"; Agenda starts it when now >= at.
    // Always required — legacy documents without this field are treated as "immediately".
    startTrigger: rampStartTrigger,
    // Actions applied immediately when the ramp transitions to "running".
    // Typically used to set initial coverage to 0 before stepping up.
    startActions: z.array(rampStepAction).optional(),
    // When true, the rule is disabled (hidden from SDK payload) while the ramp is pending,
    // and again after the ramp completes/expires. The backend auto-injects enabled:true into
    // startActions and enabled:false into the completion patch.
    disableOutsideSchedule: z.boolean().optional(),
    // Optional hard deadline teardown. Fires via Agenda or immediately via the REST
    // "complete" action. Discards any pending-approval revisions and applies its patch.
    endSchedule: z
      .object({
        trigger: rampEndTrigger,
        actions: z.array(rampStepAction),
      })
      .optional(),
    status: z.enum(rampScheduleStatusArray),
    currentStepIndex: z.number().int().min(-1),
    startedAt: z.date().optional(),
    // Anchor for cumulative interval steps. Set to startedAt when the ramp transitions
    // to "running"; resets to approval-completion time after each approval gate so
    // subsequent interval steps remain on schedule regardless of how long the gate was open.
    phaseStartedAt: z.date().optional(),
    // Set when the ramp is manually paused. Cleared on resume. Used to shift
    // phaseStartedAt and nextStepAt forward by the pause duration so interval
    // steps continue exactly where they left off.
    pausedAt: z.date().optional(),
    nextStepAt: z.date().nullable(),
    // Computed at response time by the API (never stored). Milliseconds since startedAt,
    // calculated server-side to avoid client timezone/clock-skew issues.
    elapsedMs: z.number().int().optional(),
    // IDs of all revisions created for the current step ("featureId:version" format).
    // Cleared when the step completes or the ramp is paused/rolled back.
    pendingRevisionIds: z.array(z.string()).optional(),
    // The specific revision ref (from pendingRevisionIds) that requires explicit approval
    // before the ramp can advance. Absent for auto-advance steps.
    // When this revision is published all other pendingRevisionIds are auto-published.
    // When it is discarded all other pendingRevisionIds are discarded and the ramp pauses.
    pendingApprovalRevisionId: z.string().optional(),
    stepHistory: z.array(stepHistoryEntry),
  })
  .strict()
  .superRefine((data, ctx) => {
    // A zero-step ramp is only meaningful if at least one absolute datetime anchor exists.
    if (
      data.steps.length === 0 &&
      data.startTrigger.type !== "scheduled" &&
      !data.endSchedule
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A ramp schedule with no steps must have a scheduled startTrigger or an endSchedule.",
        path: ["steps"],
      });
    }
  });

export type RampScheduleInterface = z.infer<typeof rampScheduleValidator>;
