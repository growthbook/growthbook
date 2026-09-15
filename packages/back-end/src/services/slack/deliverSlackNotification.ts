import type { EventWebHookInterface } from "shared/types/event-webhook";
import type { EventInterface } from "shared/types/events/event";
import { DEFAULT_NOTIFICATION_SETTINGS } from "shared/validators";
import { sendEventWebhook } from "back-end/src/events/handlers/webhooks/sendEventWebhook";
import type { Context } from "back-end/src/models/BaseModel";
import type { EventWebHookResult } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import {
  SlackMessage,
  getSlackMessageForNotificationEvent,
  getSlackMessageForLegacyNotificationEvent,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import {
  renderNotificationCard,
  RenderedNotificationCard,
} from "back-end/src/services/notificationCards/renderNotificationCard";
import { decryptSlackBotToken } from "back-end/src/util/slackToken";
import { escapeSlackMrkdwn } from "back-end/src/util/slack.util";
import {
  isSlackWorkspacePlaceholderUrl,
  postSlackMessageResult,
  uploadSlackImageFile,
} from "back-end/src/services/slack/slackWebApi";

export async function deliverSlackNotification({
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
  delivery: "card" | "text";
} | null> {
  const getTextPayload = () =>
    !event.version
      ? getSlackMessageForLegacyNotificationEvent(event.data, event.id)
      : getSlackMessageForNotificationEvent(event.data, event.id);
  const notificationSettings =
    eventWebHook.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS;
  const getCard = async () =>
    event.version && notificationSettings.type === "image"
      ? await renderNotificationCard(
          event.data,
          notificationSettings.cardFormat,
        )
      : null;
  return deliverSlackMessage({
    context,
    eventWebHook,
    getTextPayload,
    getCard,
  });
}

export async function deliverSlackMessage({
  context,
  eventWebHook,
  getTextPayload,
  getCard,
  messagePrefix,
}: {
  context: Context;
  eventWebHook: EventWebHookInterface;
  getTextPayload: () => Promise<SlackMessage | null>;
  getCard: () => Promise<RenderedNotificationCard | null>;
  messagePrefix?: string;
}): Promise<{
  result: EventWebHookResult;
  payload: Record<string, unknown>;
  delivery: "card" | "text";
} | null> {
  if (!isSlackWorkspacePlaceholderUrl(eventWebHook.url)) {
    const payload = await getTextPayload();
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
    return { result, payload, delivery: "text" };
  }
  const teamId = eventWebHook.slack?.teamId;
  const connection = teamId
    ? await context.models.slackWorkspaceConnections.getByTeamId(teamId)
    : null;
  const botToken = connection
    ? decryptSlackBotToken(connection.encryptedBotAccessToken)
    : null;
  const channelId = eventWebHook.slack?.channelId;

  if (!botToken || !channelId) {
    const payload = await getTextPayload();
    if (!payload) return null;
    return {
      result: {
        result: "error",
        statusCode: null,
        error:
          "Slack delivery failed: no bot token or channel for this connection (reconnect the Slack workspace)",
      },
      payload,
      delivery: "text",
    };
  }

  const card = await getCard();
  if (card) {
    const caption = [
      messagePrefix,
      `<${card.objectUrl}|${escapeSlackMrkdwn(card.objectName)}> - ${escapeSlackMrkdwn(card.eventLabel)}`,
    ]
      .filter(Boolean)
      .join("\n");
    const fileId = await uploadSlackImageFile({
      token: botToken,
      png: card.png,
      filename: "notification-card.png",
      title: card.altText,
      channelId,
      initialComment: caption,
    });
    if (fileId) {
      return {
        result: {
          result: "success",
          statusCode: 200,
          responseBody: fileId,
        },
        payload: { text: caption },
        delivery: "card",
      };
    }
  }

  const payload = await getTextPayload();
  if (!payload?.text) return null;

  const result = await postSlackMessageResult({
    token: botToken,
    channel: channelId,
    text: payload.text,
    blocks: payload.blocks,
  });

  return {
    result: result.ok
      ? {
          result: "success",
          statusCode: 200,
          responseBody: result.ts || "ok",
        }
      : {
          result: "error",
          statusCode: null,
          error: `Slack delivery failed: ${result.error}`,
        },
    payload,
    delivery: "text",
  };
}
