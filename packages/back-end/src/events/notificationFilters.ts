import type { NotificationFilters } from "shared/validators";
import type { EventWebHookInterface } from "shared/types/event-webhook";
import type {
  EventInterface,
  NotificationResourceRelationships,
} from "shared/types/events/event";
import type { ReqContext } from "back-end/types/request";
import { isBookkeepingExperimentUpdate } from "./experimentUpdateNoise";
import {
  baseMetricId,
  getNotificationResources,
} from "./notificationResources";

const intersects = (wanted: string[] = [], actual: string[]) =>
  !wanted.length || wanted.some((id) => actual.includes(id));

export const matchesNotificationResourceFilters = (
  filters: Pick<
    NotificationFilters,
    "experimentIds" | "featureIds" | "metricIds"
  >,
  related: Required<NotificationResourceRelationships>,
) =>
  intersects(filters.experimentIds, related.experimentIds) &&
  intersects(filters.featureIds, related.featureIds) &&
  intersects(filters.metricIds?.map(baseMetricId), related.metricIds);

// Event names and project/tag/environment scope are matched before enqueueing.
// Resolve relationships within each delivery job so failures affect one subscription.
export async function matchesNotificationFilters(
  context: ReqContext,
  event: EventInterface,
  subscription: Pick<
    EventWebHookInterface,
    "experimentIds" | "featureIds" | "metricIds" | "excludeBookkeepingUpdates"
  >,
): Promise<boolean> {
  if (
    subscription.excludeBookkeepingUpdates &&
    isBookkeepingExperimentUpdate(event)
  )
    return false;
  if (
    !subscription.experimentIds?.length &&
    !subscription.featureIds?.length &&
    !subscription.metricIds?.length
  )
    return true;
  return matchesNotificationResourceFilters(
    subscription,
    await getNotificationResources(context, event, subscription),
  );
}
