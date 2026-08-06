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

  // An event that names NO environment isn't scoped to one — a Constant or Config
  // base-value change binds to none and is felt in all of them. Intersecting an
  // empty list matches nothing, so an environment-filtered subscription silently
  // stopped hearing about exactly the changes with the widest reach. A filter is
  // there to drop OTHER environments' noise, not unscoped events.
  const eventEnvironments = event.environments || [];
  if (eventEnvironments.length === 0) {
    return true;
  }

  return intersection(eventEnvironments, environments).length > 0;
};
