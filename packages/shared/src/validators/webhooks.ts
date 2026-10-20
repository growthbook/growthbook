import { z } from "zod";
import { managedByValidator } from "./managed-by";
import { namedSchema } from "./openapi-helpers";
import { apiBaseSchema } from "./base-model";

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

// null clears it back to the default. Upper bound is enforced server-side by MAX_WEBHOOK_TIMEOUT_SECONDS
export const webhookTimeoutSecondsValidator = z
  .number()
  .int()
  .min(1)
  .nullable();

// REST shape of the timeout, on SDK and event webhooks alike
export const apiWebhookTimeoutSeconds = webhookTimeoutSecondsValidator.describe(
  "Request timeout in seconds, up to the server maximum (120 unless configured). Null uses the default.",
);

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
  created: z.date().optional(),
  sendPayload: z.boolean().optional(),
  payloadFormat: payloadFormatValidator.optional(),
  payloadKey: z.string().optional(),
  headers: z.string().optional(),
  httpMethod: z.enum(webhookMethods).optional(),
  managedBy: managedByValidator.optional(),
  consecutiveFailures: z.number().optional(),
  disabled: z.boolean().optional(),
  timeoutSeconds: webhookTimeoutSecondsValidator.optional(),
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
    timeoutSeconds: webhookTimeoutSecondsValidator.optional(),
    managedBy: managedByValidator.optional(),
  })
  .strict();

export type CreateSdkWebhookProps = z.infer<typeof createSdkWebhookValidator>;

export const updateSdkWebhookValidator = createSdkWebhookValidator
  .omit({ managedBy: true })
  .extend({ sdks: z.array(z.string()) })
  .partial();

export type UpdateSdkWebhookProps = z.infer<typeof updateSdkWebhookValidator>;

export const apiSdkWebhookValidator = namedSchema(
  "SdkWebhook",
  apiBaseSchema.safeExtend({
    name: z.string(),
    endpoint: z.string(),
    sdkConnections: z.array(z.string()),
    httpMethod: z.enum(webhookMethods),
    payloadFormat: payloadFormatValidator,
    payloadKey: z.string().optional(),
    headers: z
      .string()
      .describe(
        "JSON-encoded object of extra headers. Only returned by GET, and only to callers who can edit the webhook; empty otherwise.",
      ),
    signingKey: z
      .string()
      .describe(
        "Used to verify the signature header. Only returned by GET, and only to callers who can edit the webhook; empty otherwise.",
      ),
    lastSuccess: z.string().meta({ format: "date-time" }).nullable(),
    error: z.string(),
    consecutiveFailures: z.number(),
    disabled: z
      .boolean()
      .describe("Set after repeated failures; changing the endpoint clears it"),
    timeoutSeconds: apiWebhookTimeoutSeconds,
  }),
);

const sdkWebhookFields = {
  name: z.string(),
  endpoint: z.string().url(),
  httpMethod: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "PURGE"]),
  payloadFormat: payloadFormatValidator
    .exclude(["vercelNativeIntegration"])
    .optional(),
  payloadKey: z.string().optional(),
  headers: z
    .string()
    .optional()
    .describe('JSON-encoded object, e.g. "{\\"X-Token\\": \\"abc\\"}"'),
  timeoutSeconds: apiWebhookTimeoutSeconds.optional(),
};

// SDK webhooks are created through their SDK Connection, so the spec's
// default CRUD bodies are unused
export const apiCreateSdkWebhookBody = z.strictObject({});
export const apiUpdateSdkWebhookBody = z.strictObject({});

export const apiSdkWebhookReturn = z
  .object({ sdkWebhook: apiSdkWebhookValidator })
  .strict();
export const apiSdkWebhookListReturn = z
  .object({ sdkWebhooks: z.array(apiSdkWebhookValidator) })
  .strict();
export const apiSdkWebhookDeleteReturn = z
  .object({ deletedId: z.string() })
  .strict();

const connectionParams = z
  .object({ id: z.string().describe("The SDK Connection id") })
  .strict();
const idParams = z.object({ id: z.string() }).strict();

export const listSdkConnectionWebhooksValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: connectionParams,
};

export const postSdkConnectionWebhookValidator = {
  bodySchema: z.object(sdkWebhookFields).strict(),
  querySchema: z.never(),
  paramsSchema: connectionParams,
};

export const putSdkWebhookValidator = {
  bodySchema: z
    .object({
      ...sdkWebhookFields,
      payloadFormat: payloadFormatValidator
        .optional()
        .describe(
          "`vercelNativeIntegration` is accepted only on webhooks that already use it",
        ),
      sdkConnections: z
        .array(z.string())
        .min(1)
        .describe("Replaces the SDK Connections this webhook fires for"),
    })
    .partial()
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
};

export const sdkWebhookIdValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
};
