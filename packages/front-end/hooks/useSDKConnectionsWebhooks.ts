import { WebhookInterface } from "back-end/types/webhook";
import useApi from "./useApi";

export default function useSDKConnectionsWebhooks() {
  return useApi<{
    connections: Record<string, WebhookInterface[]>;
  }>(`/sdk-connections/webhooks`);
}
