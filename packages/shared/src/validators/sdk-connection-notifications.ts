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

const sdkConnectionProxyFields = {
  connectionId: z.string(),
  connectionName: z.string(),
  environment: z.string(),
  projects: z.array(z.string()),
  /** When the proxy started failing, as an ISO date. */
  failingSince: z.string().nullable(),
};

export const sdkConnectionProxyFailureNotificationPayload = z
  .object({
    ...sdkConnectionProxyFields,
    /** Status of the last failed request. Null when it got no response. */
    status: z.number().nullable(),
    error: z.string(),
  })
  .strict();

export type SdkConnectionProxyFailureNotificationPayload = z.infer<
  typeof sdkConnectionProxyFailureNotificationPayload
>;

export const sdkConnectionProxyRecoveredNotificationPayload = z
  .object(sdkConnectionProxyFields)
  .strict();

export type SdkConnectionProxyRecoveredNotificationPayload = z.infer<
  typeof sdkConnectionProxyRecoveredNotificationPayload
>;
