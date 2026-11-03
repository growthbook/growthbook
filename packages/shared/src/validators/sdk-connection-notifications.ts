import { z } from "zod";

export const sdkConnectionPayloadSizeNotificationPayload = z
  .object({
    connectionId: z.string(),
    connectionName: z.string(),
    environment: z.string(),
    projects: z.array(z.string()),
    level: z.enum(["warning", "danger", "over-limit"]),
    bytes: z.number(),
    limitBytes: z.number(),
    message: z.string(),
    recommendations: z.array(
      z.object({ type: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();

export type SdkConnectionPayloadSizeNotificationPayload = z.infer<
  typeof sdkConnectionPayloadSizeNotificationPayload
>;
