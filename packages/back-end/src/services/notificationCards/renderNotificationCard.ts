import type { NotificationEvent } from "shared/types/events/notification-events";
import type { NotificationEventName } from "shared/types/events/base-types";
import type { NotificationCardFormat } from "shared/validators";
import { logger } from "back-end/src/util/logger";
import { renderCard } from "back-end/src/services/notificationCards/cardStyles";
import type {
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";
import { buildExperimentSrmCard } from "back-end/src/services/notificationCards/producers/experimentSrmCard";
import { buildExperimentStartedCard } from "back-end/src/services/notificationCards/producers/experimentStartedCard";
import { buildExperimentStoppedCard } from "back-end/src/services/notificationCards/producers/experimentStoppedCard";

const PRODUCERS: Partial<
  Record<NotificationEventName, NotificationCardProducer>
> = {
  "experiment.warning": buildExperimentSrmCard,
  "experiment.status.started": buildExperimentStartedCard,
  "experiment.status.stopped": buildExperimentStoppedCard,
};

// The card an event would produce, before rendering. Exposed for tests and
// tooling that need the data without a PNG.
export function buildNotificationCard(
  event: NotificationEvent,
): NotificationCard | null {
  return PRODUCERS[event.event]?.(event) ?? null;
}

export type RenderedNotificationCard = Omit<NotificationCard, "data"> & {
  png: Buffer;
};

export async function renderNotificationCard(
  event: NotificationEvent,
  format: NotificationCardFormat,
): Promise<RenderedNotificationCard | null> {
  const card = buildNotificationCard(event);
  if (!card) return null;
  const { data, ...metadata } = card;

  try {
    return {
      png: await renderCard(data, format),
      ...metadata,
    };
  } catch (error) {
    logger.warn(error, `Notification card: failed to render ${event.event}`);
    return null;
  }
}
