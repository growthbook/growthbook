import type { NotificationFilters } from "shared/validators";
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
  filters: Pick<NotificationFilters, "experiments" | "features" | "metrics">,
  related: Required<NotificationResourceRelationships>,
) =>
  intersects(filters.experiments, related.experiments) &&
  intersects(filters.features, related.features) &&
  intersects(filters.metrics?.map(baseMetricId), related.metrics);

// Event names and project/tag/environment scope are matched before enqueueing.
// Resolve relationships within each delivery job so failures affect one subscription.
export async function matchesNotificationFilters(
  context: ReqContext,
  event: EventInterface,
  subscription: Pick<
    NotificationFilters,
    "experiments" | "features" | "metrics" | "excludeBookkeepingUpdates"
  >,
): Promise<boolean> {
  if (
    subscription.excludeBookkeepingUpdates &&
    isBookkeepingExperimentUpdate(event)
  )
    return false;
  if (
    !subscription.experiments?.length &&
    !subscription.features?.length &&
    !subscription.metrics?.length
  )
    return true;
  return matchesNotificationResourceFilters(
    subscription,
    await getNotificationResources(context, event, subscription),
  );
}
