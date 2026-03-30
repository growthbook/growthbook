import { z } from "zod";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { baseSchema } from "./base-model";

// Sparse patch for a feature rule — only ramped fields included.
// The ramp service merges this with current live state to build a full revision change set.
export const featureRulePatch = z.object({
  ruleId: z.string(),
  coverage: z.number().min(0).max(1).nullish(),
  condition: z.string().nullish(),
  savedGroups: z.array(savedGroupTargeting).nullish(),
  prerequisites: z.array(featurePrerequisite).nullish(),
  // force: any JSON-serializable value
  force: z.any().optional(),
  // Internal only — managed by disableRuleBeforeStart / disableRuleAfterComplete. Never user-authored.
  enabled: z.boolean().nullish(),
});
export type FeatureRulePatch = z.infer<typeof featureRulePatch>;

// targetType discriminates action kind. Currently only "feature-rule" exists;
// future types (experiments, webhooks) will expand to a discriminatedUnion.
export const rampStepAction = z.object({
  targetType: z.literal("feature-rule"),
  targetId: z.string(),
  patch: featureRulePatch,
});
export type RampStepAction = z.infer<typeof rampStepAction>;

// Fields a ramp can manage on a feature rule. Absent controlled fields in any step
// are cleared on the rule when that step applies.
// "enabled" is internal plumbing for disableRuleBefore / disableRuleAfter — not user-authored.
export const rampControlledField = z.enum([
  "coverage",
  "condition",
  "savedGroups",
  "prerequisites",
  "force",
  "enabled", // internal only — injected by disableRuleBefore / disableRuleAfter
]);
export type RampControlledField = z.infer<typeof rampControlledField>;

// Controlled entity reference. activatingRevisionVersion: set when the ramp is
// created alongside a rule change; cleared once the activating revision is published.
export const rampTarget = z.object({
  id: z.string(),
  entityType: z.enum(["feature"]), // TODO v2: add "experiment"
  entityId: z.string(),
  ruleId: z.string().nullish(),
  environment: z.string().nullish(),
  status: z.enum(["pending-join", "active"]),
  activatingRevisionVersion: z.number().int().nullish(),
  controlledFields: z.array(rampControlledField).optional(),
});
export type RampTarget = z.infer<typeof rampTarget>;

// "immediately": auto-start on activating revision publish.
// "manual": transitions to "ready"; requires explicit user start.
// "scheduled": transitions to "ready"; Agenda auto-starts when now >= at.
export const rampStartTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediately") }),
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("scheduled"), at: z.date() }),
]);
export type RampStartTrigger = z.infer<typeof rampStartTrigger>;

// "scheduled": fires when now >= at, discards pending steps, applies endCondition.actions.
export const rampEndTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scheduled"), at: z.date() }),
  // Future: z.object({ type: z.literal("criteria"), criteriaId: z.string() }),
]);
export type RampEndTrigger = z.infer<typeof rampEndTrigger>;

// "interval": auto-advance after cumulative seconds from phaseStartedAt.
// "approval": manual gate — blocks until user approves.
// "scheduled": fires at an absolute datetime.
export const rampTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("interval"), seconds: z.number().positive() }),
  z.object({ type: z.literal("approval") }),
  z.object({ type: z.literal("scheduled"), at: z.date() }),
  // Future: criteria-gated advancement
  // z.object({ type: z.literal("criteria"), criteriaId: z.string(), ... }),
]);
export type RampTrigger = z.infer<typeof rampTrigger>;

// IMPORTANT — actions is a complete state specification, not a sparse delta.
// Every controlled field must be present in every step. When jumping or rolling back
// to step N, that step's actions are applied directly as the full desired state.
// Absent fields in a patch leave the rule's existing value unchanged (field not
// controlled by this ramp). Null clears the field (except force, where null is valid).
export const rampStep = z.object({
  trigger: rampTrigger,
  actions: z.array(rampStepAction),
  approvalNotes: z.string().nullish(),
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
    // Combined start trigger + baseline actions applied on ramp start.
    // actions must be a complete state spec — all activeFields included.
    // On rollback to start (-1), these actions are applied directly as the full desired state.
    startCondition: z.object({
      trigger: rampStartTrigger,
      actions: z.array(rampStepAction).nullish(),
    }),
    // When true, rule is hidden before start; backend injects enabled:true into startCondition.actions.
    disableRuleBefore: z.boolean().optional(),
    // When true, rule is hidden after end; backend injects enabled:false into endCondition.actions.
    disableRuleAfter: z.boolean().optional(),
    // When true (ramp-ups): completes as soon as all steps are done even if endCondition.trigger is future.
    // When false (scheduled rules): holds in "running" until the date trigger fires.
    endEarlyWhenStepsComplete: z.boolean().optional(),
    // Optional teardown condition. trigger: hard deadline. actions: applied on any end path.
    endCondition: z
      .object({
        trigger: rampEndTrigger.optional(),
        actions: z.array(rampStepAction).nullish(),
      })
      .nullish(),
    status: z.enum(rampScheduleStatusArray),
    currentStepIndex: z.number().int().min(-1),
    startedAt: z.date().nullish(),
    // Anchor for cumulative interval timing. Resets after approval gates.
    phaseStartedAt: z.date().nullish(),
    // Set on manual pause; cleared on resume. Used to shift timing anchors forward.
    pausedAt: z.date().nullish(),
    nextStepAt: z.date().nullable(),
    // Computed at response time (never stored): ms since startedAt.
    elapsedMs: z.number().int().nullish(),
  })
  .strict()
  .superRefine((data, ctx) => {
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

// Minimal type for displaying pending/draft ramp schedules before full data is available.
export type RampScheduleForDisplay = Partial<RampScheduleInterface> & {
  id: string;
  status: RampScheduleInterface["status"];
  name: string;
  targets: RampScheduleInterface["targets"];
  steps: RampScheduleInterface["steps"];
  startCondition: RampScheduleInterface["startCondition"];
  dateCreated: Date;
  dateUpdated: Date;
};
