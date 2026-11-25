import type { EventWebHookInterface } from "shared/types/event-webhook";
import type { EventInterface } from "shared/types/events/event";
import type { Context } from "back-end/src/models/BaseModel";
import type { EventWebHookResult } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import { getLegacyMessageForNotificationEvent } from "back-end/src/events/handlers/legacy";
import { sendEventWebhook } from "back-end/src/events/handlers/webhooks/sendEventWebhook";
import { getDiscordNotificationPayload } from "back-end/src/services/discord/getDiscordNotificationPayload";
import { getDatadogNotificationPayload } from "back-end/src/services/datadog/getDatadogNotificationPayload";
import { deliverSlackNotification } from "back-end/src/services/slack/deliverSlackNotification";
import { scopeRelatedEntities } from "back-end/src/events/relatedEntities";

export async function getEventWebhookPayload({
  event,
  payloadType,
}: {
  event: EventInterface;
  payloadType: Exclude<
    EventWebHookInterface["payloadType"],
    "slack" | "datadog"
  >;
}): Promise<Record<string, unknown> | null> {
  switch (payloadType) {
    case "json":
      if (!event.version) throw new Error("Internal error");
      return event.data;
    case "raw":
      return event.version
        ? (getLegacyMessageForNotificationEvent(event.data) ?? null)
        : event.data;
    case "discord":
      return getDiscordNotificationPayload(event);
    default: {
      const invalidPayloadType: never = payloadType;
      throw new Error(`Invalid payload type: ${invalidPayloadType}`);
    }
  }
}

// Related entities outside the webhook's Projects and environments are left out.
function scopeEventToWebhook(
  event: EventInterface,
  eventWebHook: EventWebHookInterface,
): EventInterface {
  if (!event.version || !event.data.relatedEntities?.length) return event;
  return {
    ...event,
    data: {
      ...event.data,
      relatedEntities: scopeRelatedEntities(
        event.data.relatedEntities,
        eventWebHook,
      ),
    },
  };
}

export async function deliverEventNotification({
  context,
  event: unscopedEvent,
  eventWebHook,
}: {
  context: Context;
  event: EventInterface;
  eventWebHook: EventWebHookInterface;
}): Promise<{
  result: EventWebHookResult;
  payload: Record<string, unknown>;
} | null> {
  const event = scopeEventToWebhook(unscopedEvent, eventWebHook);
  // Older webhook definitions may not have a payload type.
  const payloadType = eventWebHook.payloadType || "raw";
  if (payloadType === "slack") {
    return deliverSlackNotification({ context, event, eventWebHook });
  }

  const payload =
    payloadType === "datadog"
      ? getDatadogNotificationPayload({ event, eventWebHook })
      : await getEventWebhookPayload({ event, payloadType });
  if (!payload) return null;

  const applySecrets =
    await context.models.webhookSecrets.getBackEndSecretsReplacer(
      new URL(eventWebHook.url).origin,
    );
  const result = await sendEventWebhook({
    payload,
    eventWebHook,
    method: eventWebHook.method || "POST",
    applySecrets,
  });

  return { result, payload };
}
