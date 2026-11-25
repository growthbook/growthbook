import intersection from "lodash/intersection";
import {
  EventRelatedEntity,
  isDatadogEventWebHookEvent,
} from "shared/validators";
import type { EventWebHookInterface } from "shared/types/event-webhook";
import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "shared/types/events/notification-events";
import { scopeRelatedEntities } from "back-end/src/events/relatedEntities";

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

type WebhookFilters = Pick<
  EventWebHookInterface,
  "projects" | "tags" | "environments"
>;

type RoutedEvent = {
  event: string;
  projects?: string[];
  tags?: string[];
  environments?: string[];
  relatedEntities?: EventRelatedEntity[];
};

const passes = (filter: string[], values: string[] = []) =>
  !filter.length || values.some((v) => filter.includes(v));

// Saved Groups, Constants and Configs are shared, so a change to one also
// reaches a filtered webhook through the Feature Flags and experiments that
// depend on it.
const SHARED_RESOURCES = ["savedGroup", "constant", "config"];

// The environments of an event within a webhook's filters, or null when the
// event doesn't pass them.
export function webhookEventEnvironments(
  webhook: WebhookFilters,
  event: RoutedEvent,
): string[] | null {
  const environments = event.environments ?? [];
  const envFilter = webhook.environments ?? [];
  const inFilter = envFilter.length
    ? environments.filter((e) => envFilter.includes(e))
    : environments;

  if (
    passes(webhook.projects ?? [], event.projects) &&
    passes(webhook.tags ?? [], event.tags)
  ) {
    return filterEventForEnvironments({
      event: { environments },
      environments: envFilter,
    })
      ? inFilter
      : null;
  }

  if (!SHARED_RESOURCES.includes(event.event.split(".")[0])) return null;
  // A dependent that doesn't list its Projects and tags can't pass them.
  const reached = new Set(
    scopeRelatedEntities(event.relatedEntities ?? [], webhook).flatMap((e) =>
      e.type !== "rampSchedule" && e.projects && e.tags ? e.environments : [],
    ),
  );
  const dependentEnvs = inFilter.filter((e) => reached.has(e));
  return dependentEnvs.length ? dependentEnvs : null;
}

// Whether a webhook is sent an event. Datadog takes only events its formatter
// converts, once they reach an environment.
export const webhookTakesEvent = (
  webhook: WebhookFilters & Pick<EventWebHookInterface, "payloadType">,
  event: RoutedEvent,
): boolean => {
  if (
    webhook.payloadType === "datadog" &&
    !isDatadogEventWebHookEvent(event.event)
  ) {
    return false;
  }
  const environments = webhookEventEnvironments(webhook, event);
  return (
    environments !== null &&
    (webhook.payloadType !== "datadog" || environments.length > 0)
  );
};
