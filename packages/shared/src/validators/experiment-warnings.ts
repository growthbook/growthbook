import { z } from "zod";

export const autoUpdateFailed = z
  .object({
    type: z.literal("auto-update"),
    success: z.boolean(),
    experimentName: z.string(),
    experimentId: z.string(),
  })
  .strict();

export const multipleExposures = z
  .object({
    type: z.literal("multiple-exposures"),
    experimentName: z.string(),
    experimentId: z.string(),
    usersCount: z.number(),
    percent: z.number(),
  })
  .strict();

export const srm = z
  .object({
    type: z.literal("srm"),
    experimentName: z.string(),
    experimentId: z.string(),
    threshold: z.number(),
  })
  .strict();

export const noData = z
  .object({
    type: z.literal("no-data"),
    experimentName: z.string(),
    experimentId: z.string(),
  })
  .strict();

export const scheduledStatusUpdateFailed = z
  .object({
    type: z.literal("scheduled-status-update-failed"),
    experimentName: z.string(),
    experimentId: z.string(),
    // "start" | "stop" — which scheduled transition failed.
    scheduledStatusUpdateType: z.enum(["start", "stop"]),
    attempts: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    // false once we've hit the retry cap and cleared `nextScheduledStatusUpdate`.
    willRetry: z.boolean(),
    reason: z.string(),
  })
  .strict();

export const underpowered = z
  .object({
    type: z.literal("underpowered"),
    experimentName: z.string(),
    experimentId: z.string(),
  })
  .strict();

export const experimentWarningNotificationPayload = z.union([
  autoUpdateFailed,
  multipleExposures,
  srm,
  noData,
  scheduledStatusUpdateFailed,
  underpowered,
]);

export type ExperimentWarningNotificationPayload = z.infer<
  typeof experimentWarningNotificationPayload
>;
