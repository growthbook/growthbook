import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";

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

export type CreateWebhookSecretProps = CreateProps<WebhookSecretInterface>;
export type UpdateWebhookSecretProps = UpdateProps<WebhookSecretInterface>;
