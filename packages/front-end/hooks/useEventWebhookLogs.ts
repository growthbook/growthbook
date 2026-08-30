import { EventWebHookLogInterface } from "shared/types/event-webhook-log";
import useApi from "./useApi";

export const useEventWebhookLogs = (eventWebHookId: string) =>
  useApi<{
    eventWebHookLogs: EventWebHookLogInterface[];
  }>(`/event-webhooks/logs/${eventWebHookId}`);
