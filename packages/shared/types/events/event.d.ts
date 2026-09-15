import type { NotificationResourceFilters } from "../../src/validators/event-webhook";
import {
  NotificationEventPayload,
  NotificationEventName,
  NotificationEventResource,
} from "./base-types";

import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "./notification-events";

export interface BaseEventInterface<T, V> {
  id: string;
  version: V;
  event: NotificationEventName;
  dateCreated: Date;
  data: T;
  organizationId: string;
  objectId?: string;
  // Preserve relationships missing from a deleted resource's public payload.
  relatedResources?: NotificationResourceFilters;
}

export type EventInterface =
  | BaseEventInterface<NotificationEvent, 1>
  | BaseEventInterface<LegacyNotificationEvent, undefined>;

export {
  NotificationEventPayload,
  NotificationEventName,
  NotificationEventResource,
};
