import { NotificationEventName } from "./event";

export interface EventWebHookInterface {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  error: string | null;
  events: NotificationEventName[];
  organizationId: string;
  url: string;
  signingKey: string;
}
