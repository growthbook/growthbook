import { NotificationEventResource } from "shared/types/events/base-types";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { EventInterface } from "shared/types/events/event";
import {
  isLowSignalExperimentEvent,
  hasWildcardSubscription,
} from "shared/validators";
import {
  getEventWebHookById,
  getAllEventWebHooksForEvent,
} from "back-end/src/models/EventWebhookModel";
import { upsertCoalesceBucket } from "back-end/src/models/EventWebHookCoalesceBucketModel";
import { isSlackExperimentNotificationSnoozed } from "back-end/src/models/SlackNotificationSnoozeModel";
import { NotificationEventHandler } from "back-end/src/events/notifiers/EventNotifier";
import {
  getFilterDataForNotificationEvent,
  filterEventForEnvironments,
} from "back-end/src/events/handlers/utils";
import { logger } from "back-end/src/util/logger";
import { maybeSendSlackDirectMessageForEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import { EventWebHookNotifier } from "./EventWebHookNotifier";

// Coalescing only makes sense for chat-style payloads where one bundled
// message is strictly better UX than a burst of individual ones. Raw/JSON
// webhook consumers expect a 1:1 mapping with events.
const COALESCE_SUPPORTED_PAYLOAD_TYPES = new Set<
  EventWebHookInterface["payloadType"]
>(["slack", "discord"]);

export const shouldCoalesceWebhook = (
  webhook: EventWebHookInterface,
  event: EventInterface,
): boolean => {
  if (!COALESCE_SUPPORTED_PAYLOAD_TYPES.has(webhook.payloadType)) return false;
  if (!event.objectId) return false;
  // The synthetic webhook.test event needs to deliver immediately so admins
  // can verify their integration without waiting for a coalescing window.
  if (event.event === "webhook.test") return false;
  const window = webhook.coalesceWindowMs ?? 0;
  return window > 0;
};

const enqueueImmediate = (
  event: EventInterface,
  webhook: EventWebHookInterface,
) => {
  const notifier = new EventWebHookNotifier({
    eventId: event.id,
    eventWebHookId: webhook.id,
  });
  notifier.enqueue();
};

const collectMetricIds = (value: unknown, depth = 0): string[] => {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    return value.startsWith("met_") ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMetricIds(item, depth + 1));
  }
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const direct = [
    record.metricId,
    record.metricIds,
    record.metrics,
    record.goalMetrics,
    record.guardrailMetrics,
    record.secondaryMetrics,
  ].flatMap((item) => collectMetricIds(item, depth + 1));

  return Object.values(record)
    .flatMap((item) => collectMetricIds(item, depth + 1))
    .concat(direct);
};

const getMetricIdsForEvent = (event: EventInterface): string[] =>
  Array.from(new Set(collectMetricIds(event.data)));

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler: NotificationEventHandler = async (event) => {
  const { tags, projects } = getFilterDataForNotificationEvent(event.data) || {
    tags: [],
    projects: [],
  };

  const eventWebHooks = await (async () => {
    if (event.data.event === "webhook.test") {
      const webhookId = event.version
        ? event.data.data.object.webhookId
        : event.data.data.webhookId;

      const webhook = await getEventWebHookById(
        webhookId,
        event.organizationId,
      );

      if (!webhook) return [];

      return [webhook];
    } else {
      return (
        (await getAllEventWebHooksForEvent({
          organizationId: event.organizationId,
          eventName: event.data.event,
          enabled: true,
          tags,
          projects,
          experimentId:
            event.object === "experiment" ? event.objectId : undefined,
          metricIds: getMetricIdsForEvent(event),
        })) || []
      ).filter(({ environments = [] }) =>
        filterEventForEnvironments({ event: event.data, environments }),
      );
    }
  })();

  for (const eventWebHook of eventWebHooks) {
    if (
      eventWebHook.payloadType === "slack" &&
      event.object === "experiment" &&
      event.objectId &&
      (await isSlackExperimentNotificationSnoozed({
        organizationId: event.organizationId,
        eventWebHookId: eventWebHook.id,
        experimentId: event.objectId,
      }))
    ) {
      continue;
    }

    // Legacy wildcard installs (e.g. events: ["experiment.*"]) can't express
    // per-event intent, so we suppress low-signal experiment events from live
    // delivery unless the channel opts into the full change log. Installs with
    // explicit (curated) subscriptions skip this gate entirely — a user who
    // checks "Experiment edited" means it. Suppressed events still exist in the
    // store, so they appear in the daily/weekly digest.
    if (
      eventWebHook.payloadType === "slack" &&
      hasWildcardSubscription(eventWebHook.events) &&
      !eventWebHook.slackOptions?.showFullChangeLog &&
      isLowSignalExperimentEvent(event.data.event)
    ) {
      continue;
    }

    if (eventWebHook.payloadType === "slack") {
      maybeSendSlackDirectMessageForEvent({ event, eventWebHook }).catch((e) =>
        logger.error(e, `Failed sending Slack DM for event ${event.id}`),
      );
    }

    if (!shouldCoalesceWebhook(eventWebHook, event)) {
      enqueueImmediate(event, eventWebHook);
      continue;
    }

    try {
      const result = await upsertCoalesceBucket({
        organizationId: event.organizationId,
        eventWebHookId: eventWebHook.id,
        objectType: event.object as NotificationEventResource,
        // shouldCoalesceWebhook ensures event.objectId is present.
        objectId: event.objectId as string,
        eventId: event.id,
        windowMs: eventWebHook.coalesceWindowMs ?? 0,
      });

      if (!result) {
        // Coalescing storage failed; fall back to immediate delivery so we
        // never silently drop a notification.
        logger.warn(
          { eventId: event.id, eventWebHookId: eventWebHook.id },
          "Coalesce upsert failed, falling back to immediate delivery",
        );
        enqueueImmediate(event, eventWebHook);
        continue;
      }

      if (result.scheduledFlush) {
        await EventWebHookNotifier.scheduleFlush({
          organizationId: result.bucket.organizationId,
          eventWebHookId: result.bucket.eventWebHookId,
          objectType: result.bucket.objectType,
          objectId: result.bucket.objectId,
          flushAt: result.bucket.flushAt,
        });
      }
    } catch (e) {
      logger.error(
        e,
        `webHooksEventHandler: coalescing failed for event ${event.id}, falling back to immediate delivery`,
      );
      enqueueImmediate(event, eventWebHook);
    }
  }
};
