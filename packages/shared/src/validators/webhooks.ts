import { z } from "zod";
import { managedByValidator } from "./managed-by";
import { namedSchema } from "./openapi-helpers";

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
  created: z.date().optional(),
  sendPayload: z.boolean().optional(),
  payloadFormat: payloadFormatValidator.optional(),
  payloadKey: z.string().optional(),
  headers: z.string().optional(),
  httpMethod: z.enum(webhookMethods).optional(),
  managedBy: managedByValidator.optional(),
  consecutiveFailures: z.number().optional(),
  disabled: z.boolean().optional(),
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

export const apiSdkWebhookValidator = namedSchema(
  "SdkWebhook",
  z
    .object({
      id: z.string(),
      name: z.string(),
      endpoint: z.string(),
      sdkConnections: z.array(z.string()),
      httpMethod: z.enum(webhookMethods),
      payloadFormat: payloadFormatValidator,
      payloadKey: z.string().optional(),
      headers: z.string().describe("JSON-encoded object of extra headers"),
      signingKey: z
        .string()
        .describe(
          "Empty unless the caller can edit the webhook. Used to verify the signature header.",
        ),
      lastSuccess: z.string().meta({ format: "date-time" }).nullable(),
      error: z.string(),
      consecutiveFailures: z.number(),
      disabled: z
        .boolean()
        .describe(
          "Set after repeated failures; changing the endpoint clears it",
        ),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
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
};

const sdkWebhookResponse = z
  .object({ sdkWebhook: apiSdkWebhookValidator })
  .strict();
const idParams = z.object({ id: z.string() }).strict();

export const listSdkConnectionWebhooksValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z
    .object({ id: z.string().describe("The SDK Connection id") })
    .strict(),
  responseSchema: z
    .object({ sdkWebhooks: z.array(apiSdkWebhookValidator) })
    .strict(),
  summary: "Get the webhooks for an SDK Connection",
  operationId: "listSdkConnectionWebhooks",
  tags: ["sdk-connections"],
  method: "get" as const,
  path: "/sdk-connections/:id/webhooks",
};

export const postSdkConnectionWebhookValidator = {
  bodySchema: z.object(sdkWebhookFields).strict(),
  querySchema: z.never(),
  paramsSchema: z
    .object({ id: z.string().describe("The SDK Connection id") })
    .strict(),
  responseSchema: sdkWebhookResponse,
  summary: "Add a webhook to an SDK Connection",
  description:
    "Called whenever the connection's payload changes. More than one webhook per organization requires a paid plan.",
  operationId: "postSdkConnectionWebhook",
  tags: ["sdk-connections"],
  method: "post" as const,
  path: "/sdk-connections/:id/webhooks",
};

export const putSdkWebhookValidator = {
  bodySchema: z
    .object({
      ...sdkWebhookFields,
      sdkConnections: z
        .array(z.string())
        .min(1)
        .describe("Replaces the SDK Connections this webhook fires for"),
    })
    .partial()
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: sdkWebhookResponse,
  summary: "Update an SDK webhook",
  description: "The webhook fires once after an update.",
  operationId: "putSdkWebhook",
  tags: ["sdk-connections"],
  method: "put" as const,
  path: "/sdk-webhooks/:id",
};

export const deleteSdkWebhookValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete an SDK webhook",
  operationId: "deleteSdkWebhook",
  tags: ["sdk-connections"],
  method: "delete" as const,
  path: "/sdk-webhooks/:id",
};

export const postSdkWebhookTestValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: sdkWebhookResponse,
  summary: "Fire an SDK webhook now",
  description:
    "Returns the webhook with the outcome in `error` / `lastSuccess`.",
  operationId: "postSdkWebhookTest",
  tags: ["sdk-connections"],
  method: "post" as const,
  path: "/sdk-webhooks/:id/test",
};
