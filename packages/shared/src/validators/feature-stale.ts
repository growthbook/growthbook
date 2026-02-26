import { z } from "zod";

export const featureStaleNotificationPayload = z
  .object({
    featureId: z.string(),
    staleReason: z.enum([
      "no-rules",
      "rules-one-sided",
      "abandoned-draft",
      "toggled-off",
    ]),
  })
  .strict();

export type FeatureStaleNotificationPayload = z.infer<
  typeof featureStaleNotificationPayload
>;
