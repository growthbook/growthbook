import Agenda from "agenda";
import { EventWebHookInterface } from "shared/types/event-webhook";
import {
  resolveExperimentDigest,
  resolveFeatureDigest,
  isSlackDigestDue,
  slackDigestWindowMs,
  type ResolvedSlackDigest,
} from "shared/validators";
import {
  EventWebHookModel,
  getSlackBotAccessTokenForWebhook,
} from "back-end/src/models/EventWebhookModel";
import {
  renderWeeklyScorecard,
  renderFeatureDigest,
  ScorecardData,
} from "back-end/src/services/slack/chartImage";
import {
  buildScorecardData,
  rangeLabel,
} from "back-end/src/services/slack/scorecardData";
import {
  buildFeatureDigestData,
  buildFeatureDigestMessage,
} from "back-end/src/services/slack/featureDigestData";
import {
  isSlackIncomingWebhookUrl,
  uploadSlackImageFile,
} from "back-end/src/services/slack/slackWebApi";
import { growthbookViewLink } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import { cancellableFetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";

// Runs hourly and delivers both Slack digests (experiment scorecard image and
// feature-flag summary), each on its own schedule. (Job id kept for agenda
// continuity even though it's no longer weekly-only.)
const DIGEST_JOB = "eventWebhookWeeklyDigest";

const PERIOD_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  custom: "Recurring",
};

// Deliver the scorecard as a private, Slack-hosted image shared into the
// channel (files.upload + completeUploadExternal). It's image-only, so it needs
// a bot token + channel + files:write; we never host it at a public URL.
async function deliverScorecard(
  webhook: EventWebHookInterface,
  data: ScorecardData,
  periodLabel: string,
): Promise<void> {
  const altText = `${periodLabel} experimentation scorecard`;
  const text = `${periodLabel} experimentation scorecard · ${data.week}\n${growthbookViewLink(
    "/experiments",
    "View experiments in GrowthBook",
  )}`;

  const botToken = await getSlackBotAccessTokenForWebhook({
    eventWebHookId: webhook.id,
    organizationId: webhook.organizationId,
  });
  const channelId = (webhook.slack as { channelId?: string } | undefined)
    ?.channelId;
  if (!botToken || !channelId) {
    logger.warn(
      `Experiment digest: no bot token/channel for webhook ${webhook.id}; skipping (private upload required)`,
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
      `Experiment digest: files.upload failed for webhook ${webhook.id} (files:write granted? bot in channel?); skipping`,
    );
  }
}

async function deliverExperimentDigest(
  webhook: EventWebHookInterface,
  digest: ResolvedSlackDigest,
  now: Date,
): Promise<void> {
  const windowMs = slackDigestWindowMs(digest);
  const label = rangeLabel(new Date(now.getTime() - windowMs), now);
  const data = await buildScorecardData(
    webhook.organizationId,
    now,
    windowMs,
    label,
    {
      projects: webhook.projects || [],
      tags: webhook.tags || [],
      ids: webhook.experiments || [],
    },
  );
  if (!data) return;
  await deliverScorecard(webhook, data, PERIOD_LABELS[digest.frequency]);
}

// The feature-flag digest renders the same scorecard-style image as the
// experiment digest (private files.upload). If the install has no bot token /
// channel, fall back to a plain text/blocks message on the incoming webhook.
async function deliverFeatureDigest(
  webhook: EventWebHookInterface,
  digest: ResolvedSlackDigest,
  now: Date,
): Promise<void> {
  const windowMs = slackDigestWindowMs(digest);
  const label = rangeLabel(new Date(now.getTime() - windowMs), now);
  const data = await buildFeatureDigestData(
    webhook.organizationId,
    now,
    windowMs,
    label,
    {
      projects: webhook.projects || [],
      tags: webhook.tags || [],
      ids: webhook.features || [],
    },
  );
  if (!data) return;

  const botToken = await getSlackBotAccessTokenForWebhook({
    eventWebHookId: webhook.id,
    organizationId: webhook.organizationId,
  });
  const channelId = (webhook.slack as { channelId?: string } | undefined)
    ?.channelId;

  if (botToken && channelId) {
    const png = await renderFeatureDigest(data);
    const fileId = await uploadSlackImageFile({
      token: botToken,
      png,
      filename: "feature-digest.png",
      title: "Feature flag digest",
      channelId,
      initialComment: `Feature flag digest · ${data.period}\n${growthbookViewLink(
        "/features",
        "View feature flags in GrowthBook",
      )}`,
    });
    if (fileId) return;
    logger.warn(
      `Feature digest: files.upload failed for webhook ${webhook.id}; falling back to text`,
    );
  }

  // Fallback: text message via the incoming webhook URL — legacy installs
  // only. Workspace-level installs store a placeholder url that must never be
  // POSTed.
  if (!isSlackIncomingWebhookUrl(webhook.url)) {
    logger.warn(
      `Feature digest: no bot token/channel and no incoming-webhook URL for webhook ${webhook.id}; skipping`,
    );
    return;
  }
  const message = buildFeatureDigestMessage(data);
  await cancellableFetch(
    webhook.url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    },
    { maxTimeMs: 30000, maxContentSize: 1000 },
  );
}

export default function addWeeklyScorecardJob(agenda: Agenda) {
  agenda.define(DIGEST_JOB, async () => {
    const now = new Date();

    // Resolve each install's experiment and feature digest schedules
    // independently and deliver whichever are due this hour. Slack installs are
    // few, so an hourly scan is cheap.
    const webhooks = await EventWebHookModel.find({
      enabled: true,
      payloadType: "slack",
    }).lean<EventWebHookInterface[]>();

    for (const webhook of webhooks) {
      const experimentDigest = resolveExperimentDigest(webhook.slackOptions);
      if (isSlackDigestDue(experimentDigest, now)) {
        try {
          await deliverExperimentDigest(webhook, experimentDigest, now);
        } catch (e) {
          logger.error(e, `Experiment digest failed for webhook ${webhook.id}`);
        }
      }

      const featureDigest = resolveFeatureDigest(webhook.slackOptions);
      if (isSlackDigestDue(featureDigest, now)) {
        try {
          await deliverFeatureDigest(webhook, featureDigest, now);
        } catch (e) {
          logger.error(e, `Feature digest failed for webhook ${webhook.id}`);
        }
      }
    }
  });

  agenda
    .create(DIGEST_JOB, {})
    .unique({})
    .repeatEvery("1 hour")
    .save()
    .catch((e) => logger.error(e, "Failed to schedule Slack digest job"));
}
