import { z } from "zod";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { baseSchema } from "./base-model";

// Sparse patch for a feature rule — only ramped fields included.
// The ramp service merges this with current state to build a full revision change set.
export const featureRulePatch = z.object({
  ruleId: z.string(),
  coverage: z.number().min(0).max(1).nullish(),
  condition: z.string().nullish(),
  savedGroups: z.array(savedGroupTargeting).nullish(),
  prerequisites: z.array(featurePrerequisite).nullish(),
  force: z.unknown().optional(),
  // Internal only — managed automatically by disableRuleBeforeStart / disableRuleAfterComplete.
  // Never user-authored or shown in the UI.
  enabled: z.boolean().nullish(),
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
  ruleId: z.string().nullish(),
  environment: z.string().nullish(),
  status: z.enum(["pending-join", "active", "pending-eject", "ejected"]),
  joinRevisionId: z.string().nullish(),
  ejectRevisionId: z.string().nullish(),
  // Version of the draft revision whose publication activates this ramp.
  // Set when the ramp is created atomically alongside a rule change.
  // Once all targets have had their activating revisions published the ramp
  // transitions out of "pending" based on startTrigger.
  activatingRevisionVersion: z.number().int().nullish(),
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
  notifyOnEntry: z.boolean().nullish(),
});
export type RampStep = z.infer<typeof rampStep>;

export const rampAttribution = z.object({
  type: z.enum(["schedule", "manual", "system"]),
  // nullish: tolerates null stored in MongoDB for optional string fields.
  userId: z.string().nullish(),
  reason: z.string().nullish(),
  source: z.string().nullish(),
});
export type RampAttribution = z.infer<typeof rampAttribution>;

// Rollback to step N: accumulate previousValues from currentStepIndex down to N+1 per targetId.
// Lower-index steps overwrite higher-index steps on overlapping fields (higher rewind precedence).
export const stepHistoryEntry = z.object({
  stepIndex: z.number().int(),
  enteredAt: z.date(),
  completedAt: z.date().nullish(),
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
      .nullish(),
    // Combined start trigger + initial actions — mirrors the shape of a step.
    // trigger: when the ramp starts (immediately/manual/scheduled).
    // actions: applied when the ramp transitions to "running" (e.g. set coverage to 0).
    startCondition: z.object({
      trigger: rampStartTrigger,
      actions: z.array(rampStepAction).nullish(),
    }),
    // When true, the rule is disabled (hidden from SDK payload) while the ramp is pending,
    // and again after the ramp completes/expires. The backend auto-injects enabled:true into
    // startCondition.actions and enabled:false into endCondition.actions.
    disableOutsideSchedule: z.boolean().nullish(),
    // Optional teardown condition — mirrors the shape of a step.
    // trigger: optional hard deadline (scheduled datetime). When reached, Agenda discards
    //   pending steps and fires endCondition.actions regardless of current progress.
    //   Absent = no deadline; endCondition.actions still fire on natural/manual completion.
    // actions: applied whenever the ramp ends (deadline, manual complete, or last step done).
    endCondition: z
      .object({
        trigger: rampEndTrigger.optional(),
        actions: z.array(rampStepAction).nullish(),
      })
      .nullish(),
    status: z.enum(rampScheduleStatusArray),
    currentStepIndex: z.number().int().min(-1),
    startedAt: z.date().nullish(),
    // Anchor for cumulative interval steps. Set to startedAt when the ramp transitions
    // to "running"; resets to approval-completion time after each approval gate so
    // subsequent interval steps remain on schedule regardless of how long the gate was open.
    phaseStartedAt: z.date().nullish(),
    // Set when the ramp is manually paused. Cleared on resume. Used to shift
    // phaseStartedAt and nextStepAt forward by the pause duration so interval
    // steps continue exactly where they left off.
    pausedAt: z.date().nullish(),
    nextStepAt: z.date().nullable(),
    // Computed at response time by the API (never stored). Milliseconds since startedAt,
    // calculated server-side to avoid client timezone/clock-skew issues.
    elapsedMs: z.number().int().nullish(),
    // IDs of all revisions created for the current step ("featureId:version" format).
    // Cleared when the step completes or the ramp is paused/rolled back.
    pendingRevisionIds: z.array(z.string()).nullish(),
    // The specific revision ref (from pendingRevisionIds) that requires explicit approval
    // before the ramp can advance. Absent for auto-advance steps.
    // When this revision is published all other pendingRevisionIds are auto-published.
    // When it is discarded all other pendingRevisionIds are discarded and the ramp pauses.
    pendingApprovalRevisionId: z.string().nullish(),
    stepHistory: z.array(stepHistoryEntry),
  })
  .strict()
  .superRefine((data, ctx) => {
    // A zero-step ramp is only meaningful if at least one absolute datetime anchor exists.
    if (
      data.steps.length === 0 &&
      data.startCondition.trigger.type !== "scheduled" &&
      !data.endCondition?.trigger
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A ramp schedule with no steps must have a scheduled start trigger or an end condition trigger.",
        path: ["steps"],
      });
    }
  });

export type RampScheduleInterface = z.infer<typeof rampScheduleValidator>;
