import { z } from "zod";

export const featureStaleNotificationPayload = z
  .object({
    featureId: z.string(),
    staleReason: z.enum(["no-rules", "rules-one-sided", "abandoned-draft"]),
  })
  .strict();

export type FeatureStaleNotificationPayload = z.infer<
  typeof featureStaleNotificationPayload
>;
