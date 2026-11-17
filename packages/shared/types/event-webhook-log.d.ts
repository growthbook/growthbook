import { NotificationEventName } from "./events/event";
import { EventWebHookInterface, EventWebHookMethod } from "./event-webhook";

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
  // The webhook's filters at delivery time; absent on logs written before they were recorded.
  filters?: Pick<EventWebHookInterface, "projects" | "environments">;
}

export interface EventWebHookLogInterface
  extends EventWebHookLegacyLogInterface {
  event: NotificationEventName;
  url: string;
  method: EventWebHookMethod;
}
