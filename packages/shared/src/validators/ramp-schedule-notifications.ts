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
  rampScheduleBaseNotificationPayload.strict();
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

export const rampScheduleCompletedPayload =
  rampScheduleBaseNotificationPayload.strict();
export type RampScheduleCompletedPayload = z.infer<
  typeof rampScheduleCompletedPayload
>;

export const rampScheduleRolledBackPayload = rampScheduleBaseNotificationPayload
  .extend({
    targetStepIndex: z.number().int(),
  })
  .strict();
export type RampScheduleRolledBackPayload = z.infer<
  typeof rampScheduleRolledBackPayload
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
