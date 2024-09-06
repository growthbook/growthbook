import {
  NotificationEventPayload,
  NotificationEventName,
  NotificationEventResource,
} from "../src/events/base-types";

import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "../src/events/notification-events";

export interface BaseEventInterface<T, V> {
  id: string;
  version: V;
  event: NotificationEventName;
  dateCreated: Date;
  data: T;
  organizationId: string;
}

export type EventInterface =
  | BaseEventInterface<NotificationEvent, 1>
  | BaseEventInterface<LegacyNotificationEvent, undefined>;

export {
  NotificationEventPayload,
  NotificationEventName,
  NotificationEventResource,
};
