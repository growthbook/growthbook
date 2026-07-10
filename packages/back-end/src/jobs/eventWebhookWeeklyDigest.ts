import Agenda from "agenda";
import { EventWebHookInterface } from "shared/types/event-webhook";
import {
  EventWebHookModel,
  getSlackBotAccessTokenForWebhook,
} from "back-end/src/models/EventWebhookModel";
import {
  renderWeeklyScorecard,
  ScorecardData,
} from "back-end/src/services/slack/chartImage";
import { buildWeeklyScorecardData } from "back-end/src/services/slack/scorecardData";
import {
  postSlackMessage,
  uploadSlackImageFile,
} from "back-end/src/services/slack/slackWebApi";
import { uploadCardPng } from "back-end/src/services/slack/cardDelivery";
import { cancellableFetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

const WEEKLY_DIGEST_JOB = "eventWebhookWeeklyDigest";

// Deliver the scorecard image. Prefer a private files.upload via chat.postMessage
// (bot token), fall back to a hosted image_url posted to the incoming webhook.
async function deliverScorecard(
  webhook: EventWebHookInterface,
  data: ScorecardData,
): Promise<void> {
  const png = await renderWeeklyScorecard(data);
  const text = `Weekly experimentation scorecard · ${data.week}`;
  const altText = "Weekly experimentation scorecard";

  const botToken = await getSlackBotAccessTokenForWebhook({
    eventWebHookId: webhook.id,
    organizationId: webhook.organizationId,
  });
  const channelId = (webhook.slack as { channelId?: string } | undefined)
    ?.channelId;

  if (botToken && channelId) {
    const fileId = await uploadSlackImageFile({
      token: botToken,
      png,
      filename: "scorecard.png",
      title: altText,
    });
    const blocks: Record<string, unknown>[] = fileId
      ? [{ type: "image", slack_file: { id: fileId }, alt_text: altText }]
      : await (async () => {
          const url = await uploadCardPng(webhook.organizationId, png);
          return url
            ? [{ type: "image", image_url: url, alt_text: altText }]
            : [];
        })();
    await postSlackMessage({
      token: botToken,
      channel: channelId,
      text,
      blocks: blocks.length ? blocks : undefined,
    });
    return;
  }

  // No bot token — hosted image_url via the incoming-webhook URL.
  const url = await uploadCardPng(webhook.organizationId, png);
  const body = {
    text,
    ...(url
      ? { blocks: [{ type: "image", image_url: url, alt_text: altText }] }
      : {}),
  };
  await cancellableFetch(
    webhook.url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { maxTimeMs: 30000, maxContentSize: 1000 },
  );
}

export default function addWeeklyScorecardJob(agenda: Agenda) {
  agenda.define(WEEKLY_DIGEST_JOB, async () => {
    const now = new Date();
    const day = now.getUTCDay();
    const hour = now.getUTCHours();

    const webhooks = await EventWebHookModel.find({
      enabled: true,
      payloadType: "slack",
      "slackOptions.weeklyDigestEnabled": true,
      "slackOptions.weeklyDigestDayOfWeekUtc": day,
      "slackOptions.weeklyDigestHourUtc": hour,
    }).lean<EventWebHookInterface[]>();

    for (const webhook of webhooks) {
      try {
        const data = await buildWeeklyScorecardData(
          webhook.organizationId,
          now,
        );
        if (!data) continue;
        await deliverScorecard(webhook, data);
      } catch (e) {
        logger.error(e, `Weekly scorecard failed for webhook ${webhook.id}`);
      }
    }
  });

  agenda
    .create(WEEKLY_DIGEST_JOB, {})
    .unique({})
    .repeatEvery("1 hour")
    .save()
    .catch((e) => logger.error(e, "Failed to schedule weekly scorecard job"));
}
