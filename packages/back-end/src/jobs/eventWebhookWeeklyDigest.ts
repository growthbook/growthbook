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
import { postSlackMessage } from "back-end/src/services/slack/slackWebApi";
import { uploadCardImageBlock } from "back-end/src/services/slack/cardDelivery";
import { logger } from "back-end/src/util/logger";

const WEEKLY_DIGEST_JOB = "eventWebhookWeeklyDigest";

// Deliver the scorecard as a private, Slack-hosted image (files.upload) via
// chat.postMessage. The scorecard is image-only, so it requires a bot token +
// channel + files:write; we never host it at a public URL.
async function deliverScorecard(
  webhook: EventWebHookInterface,
  data: ScorecardData,
): Promise<void> {
  const altText = "Weekly experimentation scorecard";
  const text = `Weekly experimentation scorecard · ${data.week}`;

  const botToken = await getSlackBotAccessTokenForWebhook({
    eventWebHookId: webhook.id,
    organizationId: webhook.organizationId,
  });
  const channelId = (webhook.slack as { channelId?: string } | undefined)
    ?.channelId;
  if (!botToken || !channelId) {
    logger.warn(
      `Weekly scorecard: no bot token/channel for webhook ${webhook.id}; skipping (private upload required)`,
    );
    return;
  }

  const png = await renderWeeklyScorecard(data);
  const block = await uploadCardImageBlock({ token: botToken, png, altText });
  if (!block) {
    logger.warn(
      `Weekly scorecard: files.upload failed for webhook ${webhook.id} (files:write granted?); skipping`,
    );
    return;
  }

  await postSlackMessage({
    token: botToken,
    channel: channelId,
    text,
    blocks: [block],
  });
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
