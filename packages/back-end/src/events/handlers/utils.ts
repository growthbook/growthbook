import intersection from "lodash/intersection";
import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "shared/types/events/notification-events";

export type FilterDataForNotificationEvent = {
  tags: string[];
  projects: string[];
};

export const getFilterDataForNotificationEvent = (
  event: NotificationEvent | LegacyNotificationEvent,
): FilterDataForNotificationEvent | null => {
  return {
    tags: event.tags || [],
    projects: event.projects || [],
  };
};

// Matches the event's routing `environments` field (see
// back-end/src/events/eventEnvironments.ts for how it is derived) against a
// subscription's environment filter.
export const filterEventForEnvironments = ({
  event,
  environments,
}: {
  event: NotificationEvent | LegacyNotificationEvent;
  environments: string[];
}): boolean => {
  // if the environments are not specified, notify for all environments
  if (environments.length === 0) {
    return true;
  }

  return intersection(event.environments || [], environments).length > 0;
};
