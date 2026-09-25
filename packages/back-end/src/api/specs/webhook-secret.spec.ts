import {
  apiCreateWebhookSecretBody,
  apiUpdateWebhookSecretBody,
  apiWebhookSecretValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const webhookSecretApiSpec = {
  modelSingular: "webhookSecret",
  modelPlural: "webhookSecrets",
  pathBase: "/webhook-secrets",
  apiInterface: apiWebhookSecretValidator,
  schemas: {
    createBody: apiCreateWebhookSecretBody,
    updateBody: apiUpdateWebhookSecretBody,
  },
  includeDefaultCrud: true,
  navDisplayName: "Webhook Secrets",
  navDescription:
    "Secret values substituted into webhook URLs and headers at send time. Values are write-only.",
  navAfterTag: "event-webhooks",
} satisfies OpenApiModelSpec;
export default webhookSecretApiSpec;
