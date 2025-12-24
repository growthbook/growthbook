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

export const webhookMethods = [
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "PURGE",
  "PATCH",
] as const;

export const webhookSchema = z.strictObject({
  id: z.string(),
  organization: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  name: z.string(),
  endpoint: z.string(),
  project: z.string().optional(),
  environment: z.string().optional(),
  featuresOnly: z.boolean().optional(),
  signingKey: z.string(),
  lastSuccess: z.date().nullable(),
  error: z.string(),
  useSdkMode: z.boolean(),
  sdks: z.array(z.string()),
  /** @deprecated */
  created: z.date(),
  sendPayload: z.boolean().optional(),
  payloadFormat: payloadFormatValidator.optional(),
  payloadKey: z.string().optional(),
  headers: z.string().optional(),
  httpMethod: z.enum(webhookMethods).optional(),
  managedBy: managedByValidator.optional(),
});

export type WebhookPayloadFormat = z.infer<typeof payloadFormatValidator>;

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

export const updateSdkWebhookValidator = createSdkWebhookValidator
  .omit({ managedBy: true })
  .extend({ sdks: z.array(z.string()) })
  .partial();

export type UpdateSdkWebhookProps = z.infer<typeof updateSdkWebhookValidator>;
