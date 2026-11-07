import type { EventWebHookInterface } from "shared/types/event-webhook";
import type { EventInterface } from "shared/types/events/event";
import type { Context } from "back-end/src/models/BaseModel";
import type { EventWebHookResult } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import { getLegacyMessageForNotificationEvent } from "back-end/src/events/handlers/legacy";
import { sendEventWebhook } from "back-end/src/events/handlers/webhooks/sendEventWebhook";
import { getDiscordNotificationPayload } from "back-end/src/services/discord/getDiscordNotificationPayload";
import { deliverSlackNotification } from "back-end/src/services/slack/deliverSlackNotification";

export async function getEventWebhookPayload({
  event,
  payloadType,
}: {
  event: EventInterface;
  payloadType: Exclude<EventWebHookInterface["payloadType"], "slack">;
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

export async function deliverEventNotification({
  context,
  event,
  eventWebHook,
}: {
  context: Context;
  event: EventInterface;
  eventWebHook: EventWebHookInterface;
}): Promise<{
  result: EventWebHookResult;
  payload: Record<string, unknown>;
} | null> {
  // Older webhook definitions may not have a payload type.
  const payloadType = eventWebHook.payloadType || "raw";
  if (payloadType === "slack") {
    return deliverSlackNotification({ context, event, eventWebHook });
  }

  const payload = await getEventWebhookPayload({ event, payloadType });
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
