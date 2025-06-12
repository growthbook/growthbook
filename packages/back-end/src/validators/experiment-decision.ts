import { z } from "zod/v4";

export const experimentDecisionNotificationPayload = z
  .object({
    experimentName: z.string(),
    experimentId: z.string(),
    decisionDescription: z.string().optional(),
  })
  .strict();

export type ExperimentDecisionNotificationPayload = z.infer<
  typeof experimentDecisionNotificationPayload
>;
