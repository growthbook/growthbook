import {
  apiCreateWebhookSecretBody,
  apiUpdateWebhookSecretBody,
  apiWebhookSecretValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "shared/api-model";

export const webhookSecretApiSpec = {
  modelSingular: "webhookSecret",
  modelPlural: "webhookSecrets",
  pathBase: "/webhook-secrets",
  apiInterface: apiWebhookSecretValidator,
  schemas: {
    createBody: apiCreateWebhookSecretBody,
    updateBody: apiUpdateWebhookSecretBody,
  },
  // Values are set in the app: a held write would store them in its confirmation
  crudActions: ["get", "list", "delete"],
  confirmation: { delete: ["settings.webhooks"] },
  navDisplayName: "Webhook Secrets",
  navDescription:
    "Secrets substituted into webhook URLs and headers at send time. Values are set in the app and never returned.",
  navAfterTag: "event-webhooks",
} satisfies OpenApiModelSpec;
export default webhookSecretApiSpec;
