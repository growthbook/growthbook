import type { NotificationEvent } from "shared/types/events/notification-events";
import type { CardNotificationEventName } from "shared/notifications";
import type { NotificationEventName } from "shared/types/events/base-types";
import type { NotificationCardFormat } from "shared/validators";
import { logger } from "back-end/src/util/logger";
import { LruCache } from "back-end/src/services/cache";
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
} satisfies Record<CardNotificationEventName, NotificationCardProducer>;

export const notificationCardEventNames = Object.keys(PRODUCERS);

export function buildNotificationCard(
  event: NotificationEvent,
): NotificationCard | null {
  const data = PRODUCERS[event.event]?.(event);
  if (!data) return null;
  const object: unknown = event.data.object;
  const ownerEmail =
    typeof object === "object" &&
    object !== null &&
    "ownerEmail" in object &&
    typeof object.ownerEmail === "string"
      ? object.ownerEmail
      : undefined;
  return {
    data,
    altText: `${data.name} - ${data.banner}`,
    objectUrl: data.url,
    objectName: data.name,
    ...(ownerEmail ? { ownerEmail } : {}),
  };
}

export type RenderedNotificationCard = Omit<NotificationCard, "data"> & {
  png: Buffer;
};

// One event fans out to a delivery job per Slack channel, each asking for the
// same PNG; the pending render is shared so a worker rasterizes it once.
const renderCache = new LruCache<
  Promise<RenderedNotificationCard | null>,
  string
>(50);

async function render(
  event: NotificationEvent,
  format: NotificationCardFormat,
): Promise<RenderedNotificationCard | null> {
  const card = buildNotificationCard(event);
  if (!card) return null;
  const { data, ...metadata } = card;
  try {
    return { png: await renderCard(data, format), ...metadata };
  } catch (error) {
    logger.warn(error, `Notification card: failed to render ${event.event}`);
    return null;
  }
}

export async function renderNotificationCard(
  event: NotificationEvent,
  format: NotificationCardFormat,
  // The stored event's id; renders without one are not cached.
  { eventId }: { eventId?: string } = {},
): Promise<RenderedNotificationCard | null> {
  if (!eventId) return render(event, format);
  const key = `${eventId}:${format}`;
  const pending = renderCache.get(key);
  if (pending) return pending;
  const rendering = render(event, format);
  renderCache.put(key, rendering);
  const rendered = await rendering;
  // Failures are not kept, so a retry renders again.
  if (!rendered) renderCache.delete(key);
  return rendered;
}
