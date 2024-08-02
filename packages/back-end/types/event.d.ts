import {
  NotificationEventPayload,
  NotificationEventName,
  NotificationEventResource,
} from "../src/events/base-types";

export interface EventInterface<T, V> {
  id: string;
  version: V;
  event: NotificationEventName;
  dateCreated: Date;
  data: T;
  organizationId: string;
}

export {
  NotificationEventPayload,
  NotificationEventName,
  NotificationEventResource,
};
