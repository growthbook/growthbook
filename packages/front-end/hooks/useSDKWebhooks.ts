import { WebhookSummary } from "back-end/types/webhook";
import useApi from "./useApi";

export default function useSDKWebhooks() {
  return useApi<{
    connections: Record<string, WebhookSummary[]>;
  }>(`/sdk-connections/webhooks`);
}
