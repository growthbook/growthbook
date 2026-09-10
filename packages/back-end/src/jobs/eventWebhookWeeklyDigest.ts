import Agenda from "agenda";
import mongoose from "mongoose";
import { slackDigestWindowMs, resolveExperimentDigest, resolveFeatureDigest, slackDigestNextRunAt } from "shared/validators";
import { EventModel } from "back-end/src/models/EventModel";
import {
  claimSlackDigestRun,
  getSlackWebhooksMissingDigestSchedule,
  getSlackWebhooksWithDigestDue,
  syncSlackDigestSchedule,
  type SlackDigestKind,
} from "back-end/src/models/EventWebhookModel";
import { decryptSlackBotToken } from "back-end/src/util/slackToken";
import { postSlackMessage } from "back-end/src/services/slack/slackWebApi";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "eventWebhookWeeklyDigest";

const runDigest = async (webhook: Awaited<ReturnType<typeof getSlackWebhooksWithDigestDue>>[number], kind: SlackDigestKind, now: Date) => {
  const dueAt = kind === "experiment" ? webhook.nextExperimentDigestAt : webhook.nextFeatureDigestAt;
  if (!dueAt || dueAt > now || !webhook.slack?.teamId || !webhook.slack.channelId) return;
  const digest = kind === "experiment" ? resolveExperimentDigest(webhook.slackOptions) : resolveFeatureDigest(webhook.slackOptions);
  const claimed = await claimSlackDigestRun({
    eventWebHookId: webhook.id,
    organizationId: webhook.organizationId,
    kind,
    now,
    nextRunAt: slackDigestNextRunAt(digest, dueAt),
  });
  if (!claimed) return;

  const since = new Date(now.getTime() - slackDigestWindowMs(digest));
  const object = kind === "experiment" ? "experiment" : "feature";
  const events = await EventModel.find({
    organizationId: webhook.organizationId,
    object,
    dateCreated: { $gte: since, $lte: now },
  }).sort({ dateCreated: -1 }).limit(100).lean();
  if (!events.length) return;

  const connection = await mongoose.connection.db
    .collection("slackworkspaceconnections")
    .findOne({ organization: webhook.organizationId, teamId: webhook.slack.teamId });
  if (!connection) return;
  const token = decryptSlackBotToken(connection.encryptedBotAccessToken);
  if (!token) return;
  const lines = events.slice(0, 20).map((event) => {
    const typedEvent = event as unknown as {
      event: string;
      objectId?: string;
      data: { object?: { name?: string }; data?: { object?: { name?: string } } };
    };
    const name =
      typedEvent.data.object?.name ||
      typedEvent.data.data?.object?.name ||
      typedEvent.objectId ||
      "Unnamed";
    return `• ${typedEvent.event} — ${name}`;
  });
  await postSlackMessage({
    token,
    channel: webhook.slack.channelId,
    text: `${kind === "experiment" ? "Experiment" : "Feature flag"} digest: ${events.length} update${events.length === 1 ? "" : "s"}`,
    blocks: [{ type: "header", text: { type: "plain_text", text: `${kind === "experiment" ? "Experiment" : "Feature flag"} digest` } }, { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
  });
};

export default function addEventWebhookWeeklyDigestJob(agenda: Agenda) {
  agenda.define(JOB_NAME, async () => {
    const now = new Date();
    for (const webhook of await getSlackWebhooksMissingDigestSchedule()) {
      await syncSlackDigestSchedule({ eventWebHookId: webhook.id, organizationId: webhook.organizationId, slackOptions: webhook.slackOptions, from: now });
    }
    for (const webhook of await getSlackWebhooksWithDigestDue(now)) {
      for (const kind of ["experiment", "feature"] as const) {
        try { await runDigest(webhook, kind, now); } catch (error) { logger.error(error, `Slack ${kind} digest failed for ${webhook.id}`); }
      }
    }
  });
  agenda.create(JOB_NAME, {}).unique({}).repeatEvery("1 hour").save().catch((error) => logger.error(error, "Failed to schedule Slack digest job"));
}
