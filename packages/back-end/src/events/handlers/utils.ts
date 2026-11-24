import intersection from "lodash/intersection";
import { isDatadogEventWebHookEvent } from "shared/validators";
import type { EventWebHookInterface } from "shared/types/event-webhook";
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
  event: Pick<NotificationEvent | LegacyNotificationEvent, "environments">;
  environments: string[];
}): boolean => {
  // if the environments are not specified, notify for all environments
  if (environments.length === 0) {
    return true;
  }

  // `[]` means "no environment-scoped impact" (see eventEnvironments.ts), so it
  // correctly matches nothing here. Widening it at this layer sent every
  // description edit — it changes no SDK payload, so its producer emits [] —
  // to every environment-filtered subscription. An event that
  // reaches ALL environments has to say so at the PRODUCER, which is the only place
  // that can tell "affects nothing" from "affects everything".
  return intersection(event.environments || [], environments).length > 0;
};

// Whether a webhook is sent an event that passed its Project and tag filters.
// Datadog takes only events its formatter converts, once they reach an
// environment.
export const webhookTakesEvent = (
  webhook: Pick<EventWebHookInterface, "payloadType" | "environments">,
  event: { event: string; environments?: string[] },
): boolean => {
  if (
    webhook.payloadType === "datadog" &&
    (!isDatadogEventWebHookEvent(event.event) || !event.environments?.length)
  ) {
    return false;
  }
  return filterEventForEnvironments({
    event: { environments: event.environments ?? [] },
    environments: webhook.environments ?? [],
  });
};
