import Agenda from "agenda";
import { slackDigestWindowMs, resolveExperimentDigest, resolveFeatureDigest, slackDigestNextRunAt } from "shared/validators";
import { EventModel } from "back-end/src/models/EventModel";
import {
  claimSlackDigestRun,
  releaseSlackDigestRun,
  getSlackWebhooksMissingDigestSchedule,
  getSlackWebhooksWithDigestDue,
  syncSlackDigestSchedule,
  type SlackDigestKind,
} from "back-end/src/models/EventWebhookModel";
import { postSlackMessage } from "back-end/src/services/slack/slackWebApi";
import { getSlackWorkspaceTokenForTeam } from "back-end/src/services/slackIntegration";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { digestEventPassesFilters } from "back-end/src/services/slack/digestFilters";
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
  try {
    const since = new Date(now.getTime() - slackDigestWindowMs(digest));
    const object = kind === "experiment" ? "experiment" : "feature";
    const events = await EventModel.find({
      organizationId: webhook.organizationId,
      object,
      dateCreated: { $gte: since, $lte: now },
    }).sort({ dateCreated: -1 }).limit(100).lean();
    const configured = webhook as typeof webhook & {
      experiments?: string[];
      features?: string[];
    };
    const filters = {
      projects: webhook.projects || [],
      tags: webhook.tags || [],
      environments: webhook.environments || [],
      ids: kind === "experiment" ? configured.experiments || [] : configured.features || [],
    };
    const matchingEvents = events.filter((event) =>
      digestEventPassesFilters(event as unknown as Parameters<typeof digestEventPassesFilters>[0], filters),
    );
    if (!matchingEvents.length) return;

    const context = await getContextForAgendaJobByOrgId(webhook.organizationId);
    const token = await getSlackWorkspaceTokenForTeam({
      context,
      teamId: webhook.slack.teamId,
    });
    const lines = matchingEvents.slice(0, 20).map((event) => {
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
    const posted = await postSlackMessage({
      token,
      channel: webhook.slack.channelId,
      text: `${kind === "experiment" ? "Experiment" : "Feature flag"} digest: ${matchingEvents.length} update${matchingEvents.length === 1 ? "" : "s"}`,
      blocks: [{ type: "header", text: { type: "plain_text", text: `${kind === "experiment" ? "Experiment" : "Feature flag"} digest` } }, { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
    });
    if (!posted) throw new Error("Slack digest delivery failed");
  } catch (error) {
    await releaseSlackDigestRun({
      eventWebHookId: webhook.id,
      organizationId: webhook.organizationId,
      kind,
      claimedAt: now,
      dueAt,
    });
    throw error;
  }
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
