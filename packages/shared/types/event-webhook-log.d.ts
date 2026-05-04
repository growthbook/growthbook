import { NotificationEventName } from "./events/event";
import { EventWebHookMethod } from "./event-webhook";

export interface EventWebHookLegacyLogInterface {
  id: string;
  event?: NotificationEventName;
  url?: string;
  method?: EventWebHookMethod;
  eventWebHookId: string;
  organizationId: string;
  dateCreated: Date;
  responseCode: number | null;
  responseBody: string | null;
  result: "error" | "success";
  payload: Record<string, unknown>;
}

export interface EventWebHookLogInterface
  extends EventWebHookLegacyLogInterface {
  event: NotificationEventName;
  url: string;
  method: EventWebHookMethod;
}
