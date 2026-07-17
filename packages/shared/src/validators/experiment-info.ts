import { z } from "zod";

export const experimentInfoSignificance = z
  .object({
    experimentName: z.string(),
    experimentId: z.string(),
    variationId: z.string(),
    variationName: z.string(),
    metricName: z.string(),
    metricId: z.string(),
    statsEngine: z.string(),
    criticalValue: z.number(),
    winning: z.boolean(),
  })
  .strict();

export type ExperimentInfoSignificancePayload = z.infer<
  typeof experimentInfoSignificance
>;

// Emitted when a scheduled start/stop is applied by the status-update job.
// For a scheduled stop this also reports the shipping outcome so downstream
// channels (webhooks/Slack) can announce the auto-ship.
export const experimentInfoScheduledStatusUpdate = z
  .object({
    experimentId: z.string(),
    experimentName: z.string(),
    // "kept-running": a soft end date was reached but the experiment was left
    // running (notify), optionally with an EDF-recommended winner to review.
    action: z.enum(["started", "stopped", "kept-running"]),
    // Stop-only: whether a variation was auto-shipped/force-shipped and which.
    shipped: z.boolean().optional(),
    shippedVariationId: z.string().optional(),
    shippedVariationName: z.string().optional(),
    // True when no clear winner was found and the configured fallback
    // variation was force-shipped.
    forced: z.boolean().optional(),
    // kept-running only: the EDF-recommended winning variation (if any), so the
    // notification can suggest an outcome + link to stop and choose one.
    recommendedVariationId: z.string().optional(),
    recommendedVariationName: z.string().optional(),
  })
  .strict();

export type ExperimentInfoScheduledStatusUpdatePayload = z.infer<
  typeof experimentInfoScheduledStatusUpdate
>;
