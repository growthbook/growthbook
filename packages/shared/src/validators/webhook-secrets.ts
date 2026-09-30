import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { apiBaseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";

export const webhookSecretSchema = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    key: z.string(),
    value: z.string(),
    allowedOrigins: z.array(z.string()).optional(),
    description: z.string().optional(),
  })
  .strict();
export type WebhookSecretInterface = z.infer<typeof webhookSecretSchema>;

export type WebhookSecretFrontEndInterface = Omit<
  WebhookSecretInterface,
  "value"
>;

// `value` is write-only: never returned by the API.
export const apiWebhookSecretValidator = namedSchema(
  "WebhookSecret",
  apiBaseSchema.safeExtend({
    key: z.string(),
    description: z.string().optional(),
    allowedOrigins: z
      .array(z.string())
      .optional()
      .describe("Origins the secret may be sent to. Empty allows any."),
  }),
);

export const apiCreateWebhookSecretBody = z.strictObject({
  key: z
    .string()
    .describe("Reference it in a webhook URL or header as `{{ KEY }}`"),
  value: z.string(),
  description: z.string().optional(),
  allowedOrigins: z.array(z.string()).optional(),
});
export const apiUpdateWebhookSecretBody = apiCreateWebhookSecretBody.partial();

export type CreateWebhookSecretProps = CreateProps<WebhookSecretInterface>;
export type UpdateWebhookSecretProps = UpdateProps<WebhookSecretInterface>;
