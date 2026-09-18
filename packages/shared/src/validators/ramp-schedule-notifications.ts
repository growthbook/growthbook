import { z } from "zod";

export const rampScheduleBaseNotificationPayload = z.object({
  rampScheduleId: z.string(),
  rampName: z.string(),
  orgId: z.string(),
  currentStepIndex: z.number().int(),
  status: z.string(),
});

export const rampScheduleStartedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleStartedPayload = z.infer<
  typeof rampScheduleStartedPayload
>;

export const rampScheduleStepAdvancedPayload =
  rampScheduleBaseNotificationPayload
    .extend({
      // Where the schedule was before this advance. A gap > 1 means a catch-up
      // jump collapsed multiple overdue steps into this single event.
      previousStepIndex: z.number().int().optional(),
    })
    .strict();
export type RampScheduleStepAdvancedPayload = z.infer<
  typeof rampScheduleStepAdvancedPayload
>;

export const rampScheduleStepApprovalRequiredPayload =
  rampScheduleBaseNotificationPayload
    .extend({ approvalNotes: z.string().nullish() })
    .strict();
export type RampScheduleStepApprovalRequiredPayload = z.infer<
  typeof rampScheduleStepApprovalRequiredPayload
>;

export const rampScheduleCompletedPayload = rampScheduleBaseNotificationPayload
  .extend({
    // Where the schedule was before completion; a gap > 1 means overdue steps
    // were folded into the completing advance.
    previousStepIndex: z.number().int().optional(),
  })
  .strict();
export type RampScheduleCompletedPayload = z.infer<
  typeof rampScheduleCompletedPayload
>;

export const rampScheduleRolledBackPayload = rampScheduleBaseNotificationPayload
  .extend({
    targetStepIndex: z.number().int(),
    // Why it rolled back, when the engine did it (a guardrail, a restart).
    reason: z.string().optional(),
  })
  .strict();
export type RampScheduleRolledBackPayload = z.infer<
  typeof rampScheduleRolledBackPayload
>;

// A monitored step is held by a health check (SRM, multiple exposures, no
// traffic, a guardrail that failed to compute, an unhealthy signal metric).
// Sent once per distinct reason per step, not on every evaluation.
export const rampScheduleStepHeldPayload = rampScheduleBaseNotificationPayload
  .extend({ reason: z.string() })
  .strict();
export type RampScheduleStepHeldPayload = z.infer<
  typeof rampScheduleStepHeldPayload
>;

export const rampSchedulePausedPayload = rampScheduleBaseNotificationPayload
  .extend({ reason: z.string().optional() })
  .strict();
export type RampSchedulePausedPayload = z.infer<
  typeof rampSchedulePausedPayload
>;

export const rampScheduleResumedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleResumedPayload = z.infer<
  typeof rampScheduleResumedPayload
>;

// The engine could not apply a step (a plan it now refuses, a structural
// error) and paused the schedule where it stood.
export const rampScheduleErrorPausedPayload =
  rampScheduleBaseNotificationPayload.extend({ reason: z.string() }).strict();
export type RampScheduleErrorPausedPayload = z.infer<
  typeof rampScheduleErrorPausedPayload
>;

export const rampScheduleAwaitingStartApprovalPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleAwaitingStartApprovalPayload = z.infer<
  typeof rampScheduleAwaitingStartApprovalPayload
>;

export const rampScheduleStartApprovedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleStartApprovedPayload = z.infer<
  typeof rampScheduleStartApprovedPayload
>;

export const rampScheduleCreatedPayload = z
  .object({
    rampScheduleId: z.string(),
    rampName: z.string(),
    orgId: z.string(),
    entityType: z.string(),
    entityId: z.string(),
  })
  .strict();
export type RampScheduleCreatedPayload = z.infer<
  typeof rampScheduleCreatedPayload
>;

export const rampScheduleDeletedPayload = z
  .object({
    rampScheduleId: z.string(),
    rampName: z.string(),
    orgId: z.string(),
  })
  .strict();
export type RampScheduleDeletedPayload = z.infer<
  typeof rampScheduleDeletedPayload
>;

export const rampScheduleJumpedPayload = rampScheduleBaseNotificationPayload
  .extend({
    targetStepIndex: z.number().int(),
  })
  .strict();
export type RampScheduleJumpedPayload = z.infer<
  typeof rampScheduleJumpedPayload
>;
