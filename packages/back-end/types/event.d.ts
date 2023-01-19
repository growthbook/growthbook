import {
  NotificationEventPayload,
  NotificationEventName,
  NotificationEventResource,
} from "../src/events/base-types";
import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../src/events/base-events";

export interface EventInterface<T> {
  id: string;
  event: NotificationEventName;
  dateCreated: Date;
  data: T;
  organizationId: string;
}

export {
  NotificationEventPayload,
  NotificationEventName,
  NotificationEventResource,
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
};
