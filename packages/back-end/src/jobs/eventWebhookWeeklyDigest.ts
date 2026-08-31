import Agenda from "agenda";
import { EventWebHookInterface } from "shared/types/event-webhook";
import {
  resolveExperimentDigest,
  resolveFeatureDigest,
  slackDigestNextRunAt,
  slackDigestWindowMs,
  type ResolvedSlackDigest,
} from "shared/validators";
import {
  claimSlackDigestRun,
  getSlackWebhooksMissingDigestSchedule,
  getSlackWebhooksWithDigestDue,
  syncSlackDigestSchedule,
  getSlackBotAccessTokenForWebhook,
  type SlackDigestKind,
} from "back-end/src/models/EventWebhookModel";
import {
  renderWeeklyScorecard,
  renderFeatureDigest,
  ScorecardData,
} from "back-end/src/services/notificationCards/cardImages";
import {
  buildScorecardData,
  rangeLabel,
} from "back-end/src/services/notificationCards/scorecardData";
import { buildFeatureDigestData } from "back-end/src/services/notificationCards/featureDigestData";
import { buildSlackFeatureDigestMessage } from "back-end/src/services/slack/featureDigestMessage";
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
  const message = buildSlackFeatureDigestMessage(data);
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

// Deliver one digest if it's still due. Claiming advances the stored next-run
// timestamp first, so a duplicated job run finds nothing to claim and exits —
// at-least-once job scheduling can't produce a double digest. A delivery that
// then throws is skipped rather than retried; a duplicate post is worse than a
// missed one, and the next scheduled run is already set.
async function runDigestIfDue(
  webhook: EventWebHookInterface,
  kind: SlackDigestKind,
  now: Date,
): Promise<void> {
  const dueAt =
    kind === "experiment"
      ? webhook.nextExperimentDigestAt
      : webhook.nextFeatureDigestAt;
  if (!dueAt || dueAt > now) return;

  const digest =
    kind === "experiment"
      ? resolveExperimentDigest(webhook.slackOptions)
      : resolveFeatureDigest(webhook.slackOptions);

  const claimed = await claimSlackDigestRun({
    eventWebHookId: webhook.id,
    organizationId: webhook.organizationId,
    kind,
    now,
    // Schedule from the due time, not `now`, so a late run doesn't drift the
    // cadence forward.
    nextRunAt: slackDigestNextRunAt(digest, dueAt),
  });
  if (!claimed) return;

  try {
    if (kind === "experiment") {
      await deliverExperimentDigest(webhook, digest, now);
    } else {
      await deliverFeatureDigest(webhook, digest, now);
    }
  } catch (e) {
    logger.error(e, `${kind} digest failed for webhook ${webhook.id}`);
  }
}

export default function addWeeklyScorecardJob(agenda: Agenda) {
  agenda.define(DIGEST_JOB, async () => {
    const now = new Date();

    // Connections created before digest scheduling existed have no next-run
    // timestamp. Seed them (first run in the future) instead of firing now.
    for (const webhook of await getSlackWebhooksMissingDigestSchedule()) {
      try {
        await syncSlackDigestSchedule({
          eventWebHookId: webhook.id,
          organizationId: webhook.organizationId,
          slackOptions: webhook.slackOptions,
          from: now,
        });
      } catch (e) {
        logger.error(e, `Failed seeding digest schedule for ${webhook.id}`);
      }
    }

    for (const webhook of await getSlackWebhooksWithDigestDue(now)) {
      await runDigestIfDue(webhook, "experiment", now);
      await runDigestIfDue(webhook, "feature", now);
    }
  });

  agenda
    .create(DIGEST_JOB, {})
    .unique({})
    .repeatEvery("1 hour")
    .save()
    .catch((e) => logger.error(e, "Failed to schedule Slack digest job"));
}
