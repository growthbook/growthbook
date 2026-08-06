import { z } from "zod";

export const experimentDecisionNotificationPayload = z
  .object({
    experimentName: z.string(),
    experimentId: z.string(),
    decisionDescription: z.string().optional(),
    // Distinguishes a decision surfaced by a fresh analysis snapshot from one
    // surfaced because a scheduled end date passed.
    source: z.enum(["scheduled-end", "analysis"]),
  })
  .strict();

export type ExperimentDecisionNotificationPayload = z.infer<
  typeof experimentDecisionNotificationPayload
>;
