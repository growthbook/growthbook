import type { EventWebHookInterface } from "shared/types/event-webhook";
import type { EventInterface } from "shared/types/events/event";
import { parseNotificationSettings } from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import type { EventWebHookResult } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import {
  getSlackMessageForNotificationEvent,
  getSlackMessageForLegacyNotificationEvent,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import { renderNotificationCard } from "back-end/src/services/notificationCards/renderNotificationCard";
import { decryptSlackBotToken } from "back-end/src/util/slackToken";
import { escapeSlackMrkdwn } from "back-end/src/util/slack.util";
import {
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
} | null> {
  const getTextPayload = () =>
    !event.version
      ? getSlackMessageForLegacyNotificationEvent(event.data, event.id)
      : getSlackMessageForNotificationEvent(event.data, event.id);
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
    };
  }

  const notificationSettings = parseNotificationSettings(
    eventWebHook.notificationSettings,
  );
  const card =
    event.version && notificationSettings.type === "image"
      ? await renderNotificationCard(
          event.data,
          notificationSettings.cardFormat,
          { eventId: event.id },
        )
      : null;
  if (card) {
    const caption = `<${card.objectUrl}|${escapeSlackMrkdwn(card.objectName)}> - ${escapeSlackMrkdwn(card.eventLabel)}`;
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
  };
}
