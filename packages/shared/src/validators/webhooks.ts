import { z } from "zod";
import { managedByValidator } from "./managed-by";

export const payloadFormatValidator = z.enum([
  "standard",
  "standard-no-payload",
  "sdkPayload",
  "edgeConfig",
  "edgeConfigUnescaped",
  "vercelNativeIntegration",
  "none",
]);

export type WebhookPayloadFormat = z.infer<typeof payloadFormatValidator>;

export const updateSdkWebhookValidator = z
  .object({
    name: z.string().optional(),
    endpoint: z.string().optional(),
    payloadFormat: payloadFormatValidator.optional(),
    payloadKey: z.string().optional(),
    sdks: z.array(z.string()).optional(),
    httpMethod: z
      .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "PURGE"])
      .optional(),
    headers: z.string().optional(),
  })
  .strict();

export type UpdateSdkWebhookProps = z.infer<typeof updateSdkWebhookValidator>;

export const createSdkWebhookValidator = z
  .object({
    name: z.string(),
    endpoint: z.string(),
    payloadFormat: payloadFormatValidator.optional(),
    payloadKey: z.string().optional(),
    httpMethod: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "PURGE"]),
    headers: z.string(),
    managedBy: managedByValidator.optional(),
  })
  .strict();

export type CreateSdkWebhookProps = z.infer<typeof createSdkWebhookValidator>;
