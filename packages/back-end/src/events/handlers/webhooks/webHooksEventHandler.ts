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
  orgHasWebhookFilteringBy,
} from "back-end/src/models/EventWebhookModel";
import {
  getFeature,
  getFeatureIdsLinkedToExperiment,
  getFeatureLinkedExperimentIds,
} from "back-end/src/models/FeatureModel";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
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

// Coalescing only applies to chat-style payloads; raw/JSON consumers expect a
// 1:1 mapping with events.
const COALESCE_SUPPORTED_PAYLOAD_TYPES = new Set<
  EventWebHookInterface["payloadType"]
>(["slack", "discord"]);

export const shouldCoalesceWebhook = (
  webhook: EventWebHookInterface,
  event: EventInterface,
): boolean => {
  if (!COALESCE_SUPPORTED_PAYLOAD_TYPES.has(webhook.payloadType)) return false;
  if (!event.objectId) return false;
  // webhook.test must deliver immediately so admins can verify the integration
  // without waiting out the coalescing window.
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

// Metric ids come in three flavors: classic (met_), fact (fact__), and metric
// groups (mg_). Collect all three so filtering by any of them works — the
// dropdown offers fact metrics, and scanning only met_ silently matched nothing.
const isMetricId = (s: string) =>
  s.startsWith("met_") || s.startsWith("fact__") || s.startsWith("mg_");

const collectMetricIds = (value: unknown, depth = 0): string[] => {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    return isMetricId(value) ? [value] : [];
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

// Metric ids configured on an experiment or an inline experiment rule (goal,
// secondary, guardrail, activation). Ids may be classic (met_), fact (fact__),
// or metric-group (mg_) — all pass through unchanged.
const metricIdsFromMetricConfig = (c: {
  goalMetrics?: string[];
  secondaryMetrics?: string[];
  guardrailMetrics?: string[];
  guardrails?: string[];
  activationMetric?: string;
}): string[] => [
  ...(c.goalMetrics || []),
  ...(c.secondaryMetrics || []),
  ...(c.guardrailMetrics || []),
  ...(c.guardrails || []),
  ...(c.activationMetric ? [c.activationMetric] : []),
];

// Every metric a feature is "related to", so the cross-subject metric filter can
// match feature events. Covers the four association paths: (1) safe-rollout
// guardrail metrics, (2) metrics on inline experiment rules, and (4) metrics of
// experiments linked to the feature — which also subsumes (3) experiment-ref
// rules, since those experiments are in `linkedExperiments`. Resolved only when
// a channel filters by metric (this builds a context + loads the feature and
// its experiments).
const getFeatureMetricIds = async (
  organizationId: string,
  featureId: string,
): Promise<string[]> => {
  try {
    const context = await getContextForAgendaJobByOrgId(organizationId);
    const ids: string[] = [];

    // (1) Safe-rollout guardrail metrics — metrics monitoring the rollout.
    const rollouts =
      await context.models.safeRollout.getAllByFeatureId(featureId);
    rollouts.forEach((r) => ids.push(...(r.guardrailMetricIds || [])));

    const feature = await getFeature(context, featureId);
    if (feature) {
      // (2) Inline experiment rules carry their own metric config.
      feature.rules.forEach((rule) => {
        if (rule.type === "experiment")
          ids.push(...metricIdsFromMetricConfig(rule));
      });
      // (4) Experiments linked to the feature (also covers experiment-ref rules).
      const linked = await getExperimentsByIds(
        context,
        feature.linkedExperiments || [],
      );
      linked.forEach((exp) => ids.push(...metricIdsFromMetricConfig(exp)));
    }

    return Array.from(new Set(ids));
  } catch (e) {
    logger.error(e, `Failed resolving metrics for feature ${featureId}`);
    return [];
  }
};

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler: NotificationEventHandler = async (event) => {
  const { tags, projects } = getFilterDataForNotificationEvent(event.data) || {
    tags: [],
    projects: [],
  };

  const experimentId =
    event.object === "experiment" ? event.objectId : undefined;
  const featureId = event.object === "feature" ? event.objectId : undefined;

  // Metrics this event's subject is associated with, for the cross-subject
  // metric filter. Experiments carry theirs in the payload; a feature's come
  // from its safe rollouts + experiment rules + linked experiments (resolved
  // only when some channel filters by metric, to avoid a per-event context
  // build otherwise).
  let metricIds = getMetricIdsForEvent(event);
  if (
    featureId &&
    (await orgHasWebhookFilteringBy(event.organizationId, "metrics"))
  ) {
    metricIds = Array.from(
      new Set([
        ...metricIds,
        ...(await getFeatureMetricIds(event.organizationId, featureId)),
      ]),
    );
  }

  // Features this event's subject is associated with, for the cross-subject
  // features filter. A feature event is its own id; an experiment event resolves
  // the features it's linked to (only when some channel filters by feature).
  let featureIds = featureId ? [featureId] : [];
  if (
    experimentId &&
    (await orgHasWebhookFilteringBy(event.organizationId, "features"))
  ) {
    featureIds = await getFeatureIdsLinkedToExperiment(
      event.organizationId,
      experimentId,
    );
  }

  // Experiments this event's subject is associated with, for the cross-subject
  // experiments filter. An experiment event is its own id; a feature event
  // resolves the experiments it's linked to (only when some channel filters by
  // experiment).
  let experimentIds = experimentId ? [experimentId] : [];
  if (
    featureId &&
    (await orgHasWebhookFilteringBy(event.organizationId, "experiments"))
  ) {
    experimentIds = await getFeatureLinkedExperimentIds(
      event.organizationId,
      featureId,
    );
  }

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
          experimentIds,
          featureIds,
          metricIds,
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

    // Legacy wildcard installs (e.g. ["experiment.*"]) can't express per-event
    // intent, so suppress low-signal experiment events from live delivery unless
    // the channel opts into the full change log. Explicit (curated)
    // subscriptions skip this gate. Suppressed events still land in the digest.
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
