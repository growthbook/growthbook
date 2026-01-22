import { z } from "zod";
import { webhookMethods, webhookSchema } from "shared/validators";

export type WebhookInterface = z.infer<typeof webhookSchema>;

export type WebhookSummary = Pick<
  WebhookInterface,
  "id" | "name" | "endpoint" | "lastSuccess" | "error" | "dateCreated"
>;

export type WebhookMethod = (typeof webhookMethods)[number];

export type {
  UpdateSdkWebhookProps,
  CreateSdkWebhookProps,
  WebhookPayloadFormat,
} from "shared/validators";
