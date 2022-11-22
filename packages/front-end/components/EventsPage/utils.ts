import {
  EventInterface,
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "back-end/types/event";

export const getEventText = (
  event: EventInterface<
    NotificationEventPayload<
      NotificationEventName,
      NotificationEventResource,
      unknown
    >
  >
): string => {
  switch (event.data.event) {
    case "feature.created":
      return `The feature ${
        ((event.data as unknown) as FeatureCreatedNotificationEvent).data.id
      } was created`;
    case "feature.updated":
      return `The feature ${
        ((event.data as unknown) as FeatureUpdatedNotificationEvent).data.id
      } was updated`;
    case "feature.deleted":
      return `The feature ${
        ((event.data as unknown) as FeatureDeletedNotificationEvent).data
          .featureId
      } was deleted`;
  }
};
