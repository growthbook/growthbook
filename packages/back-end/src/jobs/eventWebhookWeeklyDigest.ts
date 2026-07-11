import Agenda from "agenda";
import { EventWebHookInterface } from "shared/types/event-webhook";
import {
  resolveSlackDigest,
  isSlackDigestDue,
  slackDigestWindowMs,
} from "shared/validators";
import {
  EventWebHookModel,
  getSlackBotAccessTokenForWebhook,
} from "back-end/src/models/EventWebhookModel";
import {
  renderWeeklyScorecard,
  ScorecardData,
} from "back-end/src/services/slack/chartImage";
import {
  buildScorecardData,
  rangeLabel,
} from "back-end/src/services/slack/scorecardData";
import { uploadSlackImageFile } from "back-end/src/services/slack/slackWebApi";
import { logger } from "back-end/src/util/logger";

const WEEKLY_DIGEST_JOB = "eventWebhookWeeklyDigest";

// Scorecard cadences handled by this job (daily is a separate text-summary job).
const SCORECARD_FREQUENCIES = new Set([
  "weekly",
  "monthly",
  "quarterly",
  "custom",
]);
const PERIOD_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  custom: "Recurring",
};

// Deliver the scorecard as a private, Slack-hosted image shared into the
// channel (files.upload + completeUploadExternal with channel_id). The
// scorecard is image-only, so it requires a bot token + channel + files:write;
// we never host it at a public URL.
async function deliverScorecard(
  webhook: EventWebHookInterface,
  data: ScorecardData,
  periodLabel: string,
): Promise<void> {
  const altText = `${periodLabel} experimentation scorecard`;
  const text = `${periodLabel} experimentation scorecard · ${data.week}`;

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
  const fileId = await uploadSlackImageFile({
    token: botToken,
    png,
    filename: "scorecard.png",
    title: altText,
    channelId,
    initialComment: text,
  });
  if (!fileId) {
    logger.warn(
      `Weekly scorecard: files.upload failed for webhook ${webhook.id} (files:write granted? bot in channel?); skipping`,
    );
  }
}

export default function addWeeklyScorecardJob(agenda: Agenda) {
  agenda.define(WEEKLY_DIGEST_JOB, async () => {
    const now = new Date();

    // Scan enabled Slack installs and resolve each one's effective schedule
    // (new `digest` object or legacy weekly fields), then keep the ones whose
    // scorecard digest (weekly / monthly / quarterly / custom — daily is a
    // separate text summary) is due this hour. Slack installs are few, so an
    // hourly scan is cheap and keeps one source of truth for the schedule.
    const candidates = await EventWebHookModel.find({
      enabled: true,
      payloadType: "slack",
    }).lean<EventWebHookInterface[]>();

    const due = candidates
      .map((webhook) => ({
        webhook,
        digest: resolveSlackDigest(webhook.slackOptions),
      }))
      .filter(
        ({ digest }) =>
          SCORECARD_FREQUENCIES.has(digest.frequency) &&
          isSlackDigestDue(digest, now),
      );

    for (const { webhook, digest } of due) {
      try {
        const windowMs = slackDigestWindowMs(digest);
        const label = rangeLabel(new Date(now.getTime() - windowMs), now);
        const data = await buildScorecardData(
          webhook.organizationId,
          now,
          windowMs,
          label,
        );
        if (!data) continue;
        await deliverScorecard(webhook, data, PERIOD_LABELS[digest.frequency]);
      } catch (e) {
        logger.error(e, `Scorecard digest failed for webhook ${webhook.id}`);
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
