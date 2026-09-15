import type {
  NotificationResourceFilters,
  NotificationSubscription,
} from "shared/validators";
import type { EventInterface } from "shared/types/events/event";
import type { ReqContext } from "back-end/types/request";
import { isBookkeepingExperimentUpdate } from "./experimentUpdateNoise";
import {
  baseMetricId,
  getNotificationResources,
} from "./notificationResources";

const intersects = (wanted: string[] = [], actual: string[]) =>
  !wanted.length || wanted.some((id) => actual.includes(id));

export const matchesNotificationResourceFilters = (
  filters: NotificationResourceFilters,
  related: Required<NotificationResourceFilters>,
) =>
  intersects(filters.experiments, related.experiments) &&
  intersects(filters.features, related.features) &&
  intersects(filters.metrics?.map(baseMetricId), related.metrics);

// Event names and project/tag/environment scope are matched before enqueueing.
// Resolve relationships within each delivery job so failures affect one subscription.
export async function matchesNotificationFilters(
  context: ReqContext,
  event: EventInterface,
  subscription: NotificationResourceFilters &
    Pick<NotificationSubscription, "excludeEmptyUpdates">,
): Promise<boolean> {
  if (
    subscription.excludeEmptyUpdates &&
    isBookkeepingExperimentUpdate(event.data)
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
