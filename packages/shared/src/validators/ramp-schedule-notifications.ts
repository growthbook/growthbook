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
  })
  .strict();
export type RampScheduleRolledBackPayload = z.infer<
  typeof rampScheduleRolledBackPayload
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
