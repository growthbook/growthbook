import type { NotificationEvent } from "shared/types/events/notification-events";
import type { NotificationEventName } from "shared/types/events/base-types";
import type { NotificationCardFormat } from "shared/validators";
import { logger } from "back-end/src/util/logger";
import { renderCard } from "back-end/src/services/notificationCards/cardStyles";
import type { NotificationCardProducer } from "back-end/src/services/notificationCards/types";
import { buildExperimentSrmCard } from "back-end/src/services/notificationCards/producers/experimentSrmCard";

const PRODUCERS: Partial<
  Record<NotificationEventName, NotificationCardProducer>
> = {
  "experiment.warning": buildExperimentSrmCard,
};

export interface RenderedNotificationCard {
  png: Buffer;
  altText: string;
  caption: string;
}

export async function renderNotificationCard(
  event: NotificationEvent,
  format: NotificationCardFormat,
): Promise<RenderedNotificationCard | null> {
  const card = PRODUCERS[event.event]?.(event);
  if (!card) return null;

  try {
    return {
      png: await renderCard(card.data, format),
      altText: card.altText,
      caption: card.caption,
    };
  } catch (error) {
    logger.warn(error, `Notification card: failed to render ${event.event}`);
    return null;
  }
}
