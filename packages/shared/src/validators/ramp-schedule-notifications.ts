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

// A monitored step held by a health check (SRM, multiple exposures, no traffic,
// guardrail compute failure, unhealthy signal metric); once per check per step.
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

// A step failed for a reason that may clear on its own; the schedule holds and
// retries. Sent once, on the first failure of a streak.
export const rampScheduleStepRetryingPayload =
  rampScheduleBaseNotificationPayload
    .extend({
      reason: z.string().describe("The failed attempt's error."),
      attempts: z.number().int().describe("Failed attempts so far."),
      maxAttempts: z
        .number()
        .int()
        .describe("Failed attempts after which the schedule pauses."),
      nextAttemptAt: z
        .string()
        .describe("ISO timestamp of the next automatic attempt."),
    })
    .strict();
export type RampScheduleStepRetryingPayload = z.infer<
  typeof rampScheduleStepRetryingPayload
>;

// A retry succeeded after one or more failed attempts.
export const rampScheduleStepRecoveredPayload =
  rampScheduleBaseNotificationPayload
    .extend({
      attempts: z
        .number()
        .int()
        .describe("Failed attempts before the one that succeeded."),
    })
    .strict();
export type RampScheduleStepRecoveredPayload = z.infer<
  typeof rampScheduleStepRecoveredPayload
>;

// The engine could not apply a step (a plan it now refuses, a structural
// error, or a failure that outlasted its retries) and paused the schedule
// where it stood.
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
