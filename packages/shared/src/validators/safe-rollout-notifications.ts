import { z } from "zod";

export const safeRolloutBaseNotificationPayload = z.object({
  featureId: z.string(),
  safeRolloutId: z.string(),
  environment: z.string(),
});

export const safeRolloutDecisionNotificationPayload =
  safeRolloutBaseNotificationPayload.strict();

export type SafeRolloutDecisionNotificationPayload = z.infer<
  typeof safeRolloutDecisionNotificationPayload
>;

export const safeRolloutUnhealthyNotificationPayload =
  safeRolloutBaseNotificationPayload
    .extend({
      unhealthyReason: z.array(z.enum(["srm", "multipleExposures"])),
    })
    .strict();

export type SafeRolloutUnhealthyNotificationPayload = z.infer<
  typeof safeRolloutUnhealthyNotificationPayload
>;
