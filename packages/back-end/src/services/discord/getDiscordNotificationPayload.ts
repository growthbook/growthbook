import type { EventInterface } from "shared/types/events/event";
import {
  getSlackMessageForNotificationEvent,
  getSlackMessageForLegacyNotificationEvent,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";

export async function getDiscordNotificationPayload(event: EventInterface) {
  // Preserve Discord's existing use of Slack-generated text.
  const message = await (!event.version
    ? getSlackMessageForLegacyNotificationEvent(event.data, event.id)
    : getSlackMessageForNotificationEvent(event.data, event.id));

  return message ? { content: message.text } : null;
}
