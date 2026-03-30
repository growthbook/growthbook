import { z } from "zod";

export const rampScheduleBaseNotificationPayload = z.object({
  rampScheduleId: z.string(),
  rampName: z.string(),
  orgId: z.string(),
  currentStepIndex: z.number().int(),
  status: z.string(),
  // Attribution — who/what triggered the action. Present on all user-initiated events.
  userId: z.string().optional(),
  reason: z.string().optional(),
  source: z.string().optional(),
});

export const rampScheduleStartedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleStartedPayload = z.infer<
  typeof rampScheduleStartedPayload
>;

export const rampScheduleStepAdvancedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleStepAdvancedPayload = z.infer<
  typeof rampScheduleStepAdvancedPayload
>;

export const rampScheduleStepApprovalRequiredPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleStepApprovalRequiredPayload = z.infer<
  typeof rampScheduleStepApprovalRequiredPayload
>;

export const rampScheduleStepApprovedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleStepApprovedPayload = z.infer<
  typeof rampScheduleStepApprovedPayload
>;

export const rampSchedulePausedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampSchedulePausedPayload = z.infer<
  typeof rampSchedulePausedPayload
>;

export const rampScheduleResumedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleResumedPayload = z.infer<
  typeof rampScheduleResumedPayload
>;

export const rampScheduleConflictPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleConflictPayload = z.infer<
  typeof rampScheduleConflictPayload
>;

export const rampScheduleErrorPayload = rampScheduleBaseNotificationPayload
  .extend({
    error: z.string(),
  })
  .strict();
export type RampScheduleErrorPayload = z.infer<typeof rampScheduleErrorPayload>;

export const rampScheduleCompletedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleCompletedPayload = z.infer<
  typeof rampScheduleCompletedPayload
>;

export const rampScheduleExpiredPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleExpiredPayload = z.infer<
  typeof rampScheduleExpiredPayload
>;

export const rampScheduleRolledBackPayload = rampScheduleBaseNotificationPayload
  .extend({
    targetStepIndex: z.number().int(),
    reason: z.string().optional(),
    source: z.string().optional(),
  })
  .strict();
export type RampScheduleRolledBackPayload = z.infer<
  typeof rampScheduleRolledBackPayload
>;

export const rampScheduleAutoRollbackPayload =
  rampScheduleBaseNotificationPayload
    .extend({
      criteriaId: z.string(),
    })
    .strict();
export type RampScheduleAutoRollbackPayload = z.infer<
  typeof rampScheduleAutoRollbackPayload
>;

export const rampScheduleCreatedPayload = z
  .object({
    rampScheduleId: z.string(),
    rampName: z.string(),
    orgId: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    userId: z.string().optional(),
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
    userId: z.string().optional(),
  })
  .strict();
export type RampScheduleDeletedPayload = z.infer<
  typeof rampScheduleDeletedPayload
>;

export const rampScheduleResetPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleResetPayload = z.infer<typeof rampScheduleResetPayload>;

export const rampScheduleJumpedPayload = rampScheduleBaseNotificationPayload
  .extend({
    targetStepIndex: z.number().int(),
  })
  .strict();
export type RampScheduleJumpedPayload = z.infer<
  typeof rampScheduleJumpedPayload
>;
