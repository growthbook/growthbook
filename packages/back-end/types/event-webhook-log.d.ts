import { NotificationEventName } from "./event";

export interface EventWebHookLegacyLogInterface {
  id: string;
  event?: NotificationEventName;
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
}
