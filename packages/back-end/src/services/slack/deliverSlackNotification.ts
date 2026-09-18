import type { EventWebHookInterface } from "shared/types/event-webhook";
import type { EventInterface } from "shared/types/events/event";
import { parseNotificationSettings } from "shared/validators";
import type { KnownBlock } from "@slack/types";
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
import {
  alertFooterBlock,
  alertFooterText,
} from "back-end/src/events/handlers/slack/alertMessage";
import { decryptSlackBotToken } from "back-end/src/util/slackToken";
import {
  isSlackWorkspacePlaceholderUrl,
  postSlackMessageResult,
  postSlackImageMessage,
} from "back-end/src/services/slack/slackWebApi";
import { pinSlackNotificationThread } from "back-end/src/services/slack/slackThreadRouting";
import { logger } from "back-end/src/util/logger";

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
  deliveredAs: "card" | "text";
  messageTs: string | null;
} | null> {
  const getTextPayload = () =>
    !event.version
      ? getSlackMessageForLegacyNotificationEvent(event.data, event.id)
      : getSlackMessageForNotificationEvent(event.data, event.id);
  const notificationSettings = parseNotificationSettings(
    eventWebHook.notificationSettings,
  );
  const getCard = async () =>
    event.version && notificationSettings.type === "image"
      ? await renderNotificationCard(
          event.data,
          notificationSettings.cardFormat,
          { eventId: event.id },
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
  deliveredAs: "card" | "text";
  messageTs: string | null;
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
    return { result, payload, deliveredAs: "text", messageTs: null };
  }
  const teamId = eventWebHook.slack?.teamId;
  const connection = teamId
    ? await context.models.slackWorkspaceConnections.getByTeamId(teamId)
    : null;
  const botToken = connection
    ? decryptSlackBotToken(connection.encryptedBotAccessToken)
    : null;
  const channelId = eventWebHook.slack?.channelId;

  if (!botToken || !channelId || !teamId) {
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
      deliveredAs: "text",
      messageTs: null,
    };
  }

  const pinThread = async (messageTs: string | null) => {
    if (!messageTs) return;
    try {
      await pinSlackNotificationThread(
        { teamId, channelId, rootTs: messageTs },
        context.org.id,
      );
    } catch (error) {
      logger.error(error, "Could not pin the Slack notification thread");
    }
  };

  const card = await getCard();
  if (card) {
    // The image carries the event, units, and days itself; the caption is the
    // same small footer text messages get, minus the counts.
    const footer = {
      name: card.objectName,
      url: card.objectUrl,
      ownerEmail: card.ownerEmail,
    };
    const text = [messagePrefix, alertFooterText(footer)]
      .filter(Boolean)
      .join("\n");
    const blocks: KnownBlock[] = [
      ...(messagePrefix
        ? [
            {
              type: "section" as const,
              text: {
                type: "plain_text" as const,
                text: messagePrefix,
                emoji: false,
              },
            },
          ]
        : []),
      alertFooterBlock(footer),
    ];
    const posted = await postSlackImageMessage({
      token: botToken,
      png: card.png,
      filename: "notification-card.png",
      title: card.altText,
      channelId,
      caption: text,
      captionBlocks: blocks,
    });
    if (posted) {
      await pinThread(posted.messageTs);
      return {
        result: {
          result: "success",
          statusCode: 200,
          responseBody: posted.fileId,
        },
        payload: { text, blocks },
        deliveredAs: "card",
        messageTs: posted.messageTs,
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
  await pinThread(result.ts);

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
    deliveredAs: "text",
    messageTs: result.ts,
  };
}
