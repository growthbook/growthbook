import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "back-end/types/events/notification-events";

export const getLegacyMessageForNotificationEvent = (
  event: NotificationEvent,
): LegacyNotificationEvent | undefined => {
  const { user, projects, tags, environments, containsSecrets } = event;

  const attributes = { user, projects, tags, environments, containsSecrets };

  switch (event.event) {
    case "user.login":
      return {
        object: event.object,
        event: event.event,
        data: { current: event.data.object },
        ...attributes,
      };
    case "webhook.test":
      return {
        object: event.object,
        event: event.event,
        data: event.data.object,
        ...attributes,
      };
    case "experiment.warning":
      return {
        object: event.object,
        event: event.event,
        data: event.data.object,
        ...attributes,
      };
    case "feature.created":
      return {
        object: event.object,
        event: event.event,
        data: { current: event.data.object },
        ...attributes,
      };
    case "experiment.created":
      return {
        object: event.object,
        event: event.event,
        data: { current: event.data.object },
        ...attributes,
      };
    case "feature.updated":
      return {
        object: event.object,
        event: event.event,
        data: {
          current: event.data.object,
          previous: { ...event.data.object, ...event.data.previous_attributes },
        },
        ...attributes,
      };
    case "experiment.updated":
      return {
        object: event.object,
        event: event.event,
        data: {
          current: event.data.object,
          previous: { ...event.data.object, ...event.data.previous_attributes },
        },
        ...attributes,
      };
    case "feature.deleted":
      return {
        object: event.object,
        event: event.event,
        data: { previous: event.data.object },
        ...attributes,
      };
    case "experiment.deleted":
      return {
        object: event.object,
        event: event.event,
        data: { previous: event.data.object },
        ...attributes,
      };
    default:
      return;
  }
};
