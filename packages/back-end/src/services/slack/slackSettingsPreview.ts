import { NotificationSettings } from "shared/validators";
import { previewNotificationEventNames } from "shared/notifications";
import { ReqContext } from "back-end/types/request";
import {
  getSlackMessageForNotificationEvent,
  SlackMessage,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import {
  renderNotificationCard,
  RenderedNotificationCard,
} from "back-end/src/services/notificationCards/renderNotificationCard";
import { getEventWebHookById } from "back-end/src/models/EventWebhookModel";
import { getSampleEventPayload } from "back-end/src/services/notifications/sampleEvents";
import { deliverSlackMessage } from "./deliverSlackNotification";

export async function buildSlackSettingsPreview(
  context: ReqContext,
  eventName: string,
  notificationSettings: NotificationSettings,
): Promise<{ message: SlackMessage; card: RenderedNotificationCard | null }> {
  if (!context.permissions.canManageIntegrations())
    context.permissions.throwPermissionError();
  const name = previewNotificationEventNames.find((name) => name === eventName);
  if (!name) throw new Error("Unsupported test event");
  const event = getSampleEventPayload({ context, eventName: name });
  const message = await getSlackMessageForNotificationEvent(
    event,
    "notification-preview-sample",
  );
  if (!message) throw new Error("This event does not have a Slack preview");
  const card =
    notificationSettings.type === "text"
      ? null
      : await renderNotificationCard(event, notificationSettings.cardFormat);
  return { message, card };
}

export async function sendSlackSettingsTest(
  context: ReqContext,
  id: string,
  eventName: string,
  notificationSettings: NotificationSettings,
) {
  if (!context.permissions.canManageIntegrations())
    context.permissions.throwPermissionError();
  const eventWebHook = await getEventWebHookById(id, context.org.id);
  if (eventWebHook?.payloadType !== "slack")
    throw new Error("Slack channel not found");
  const { message, card } = await buildSlackSettingsPreview(
    context,
    eventName,
    notificationSettings,
  );
  const messagePrefix = "Test notification — sample data";
  const delivery = await deliverSlackMessage({
    context,
    eventWebHook,
    getCard: async () => card,
    messagePrefix,
    getTextPayload: async () => ({
      text: `${messagePrefix}\n${message.text}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${messagePrefix}*` },
        },
        ...message.blocks,
      ],
    }),
  });
  if (!delivery || delivery.result.result === "error")
    throw new Error(
      "Slack could not deliver the test notification. Check the channel connection and retry.",
    );
  return { deliveredAs: delivery.deliveredAs };
}
