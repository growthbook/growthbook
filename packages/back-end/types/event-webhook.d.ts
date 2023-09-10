import { NotificationEventName } from "./event";

export interface EventWebHookInterface {
  id: string;
  organizationId: string;
  name: string;
  dateCreated: Date;
  dateUpdated: Date;
  enabled: boolean;
  events: NotificationEventName[];
  url: string;
  signingKey: string;
  // Last state
  lastRunAt: Date | null;
  lastState: "none" | "success" | "error";
  lastResponseBody: string | null;
}
