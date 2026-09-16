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

// One event fans out to a delivery job per Slack channel, each of which asks
// for the same PNG. Keep recent renders so the layout and raster run once per
// event and format within a worker; the cache is small and short-lived
// because the payload is immutable and deliveries cluster within seconds.
const RENDER_CACHE_TTL_MS = 10 * 60 * 1000;
const RENDER_CACHE_MAX = 50;
const renderCache = new Map<
  string,
  { card: RenderedNotificationCard; expiresAt: number }
>();

function readRenderCache(key: string): RenderedNotificationCard | undefined {
  const hit = renderCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    renderCache.delete(key);
    return undefined;
  }
  return hit.card;
}

function writeRenderCache(key: string, card: RenderedNotificationCard): void {
  const now = Date.now();
  for (const [k, v] of renderCache) {
    if (v.expiresAt <= now) renderCache.delete(k);
  }
  // Insertion order is oldest first.
  while (renderCache.size >= RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next().value;
    if (oldest === undefined) break;
    renderCache.delete(oldest);
  }
  renderCache.set(key, { card, expiresAt: now + RENDER_CACHE_TTL_MS });
}

export async function renderNotificationCard(
  event: NotificationEvent,
  format: NotificationCardFormat,
  // The stored event's id; renders without one are not cached.
  { eventId }: { eventId?: string } = {},
): Promise<RenderedNotificationCard | null> {
  const cacheKey = eventId ? `${eventId}:${format}` : undefined;
  const cached = cacheKey ? readRenderCache(cacheKey) : undefined;
  if (cached) return cached;

  const card = buildNotificationCard(event);
  if (!card) return null;
  const { data, ...metadata } = card;

  try {
    const rendered = { png: await renderCard(data, format), ...metadata };
    if (cacheKey) writeRenderCache(cacheKey, rendered);
    return rendered;
  } catch (error) {
    logger.warn(error, `Notification card: failed to render ${event.event}`);
    return null;
  }
}
