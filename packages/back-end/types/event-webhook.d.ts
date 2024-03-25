import { NotificationEventName } from "./event";

export type EventWebHookPayloadType = "raw" | "slack" | "discord" | "ms-teams";
export type EventWebHookMethod = "PUT" | "POST" | "PATCH";

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
  tags?: string[];
  environments?: string[];
  projects?: string[];
  headers?: Record<string, string>;
  payloadType?: EventWebHookPayloadType;
  method?: EventWebHookMethod;
}
