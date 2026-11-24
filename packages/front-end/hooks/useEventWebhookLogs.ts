import { EventWebHookLogInterface } from "shared/types/event-webhook-log";
import useApi from "./useApi";

// Nothing to fetch for a webhook that isn't saved yet.
export const useEventWebhookLogs = (eventWebHookId: string | null) =>
  useApi<{
    eventWebHookLogs: EventWebHookLogInterface[];
  }>(`/event-webhooks/logs/${eventWebHookId}`, {
    shouldRun: () => !!eventWebHookId,
  });
