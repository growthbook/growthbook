import {
  NotificationEventPayload,
  NotificationEventName,
  NotificationEventResource,
} from "../src/events/base-types";
import {
  ExperimentCreatedNotificationEvent,
  ExperimentDeletedNotificationEvent,
  ExperimentUpdatedNotificationEvent,
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
  UserLoginNotificationEvent,
} from "../src/events/notification-events";

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
  ExperimentCreatedNotificationEvent,
  ExperimentUpdatedNotificationEvent,
  ExperimentDeletedNotificationEvent,
  UserLoginNotificationEvent,
};
