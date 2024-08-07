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

export const experimentWarningNotificationPayload = z.union([
  autoUpdateFailed,
  multipleExposures,
  srm,
]);

export type ExperimentWarningNotificationPayload = z.infer<
  typeof experimentWarningNotificationPayload
>;
