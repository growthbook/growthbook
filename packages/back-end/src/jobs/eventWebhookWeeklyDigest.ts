import Agenda from "agenda";
import {
  slackDigestWindowStart,
  resolveExperimentDigest,
  resolveFeatureDigest,
  slackDigestNextRunAt,
} from "shared/validators";
import { EventModel } from "back-end/src/models/EventModel";
import {
  claimSlackDigestRun,
  isSlackDigestRunCurrent,
  completeSlackDigestRun,
  releaseSlackDigestRun,
  getSlackWebhooksMissingDigestSchedule,
  getSlackWebhooksWithDigestDue,
  syncSlackDigestSchedule,
  type SlackDigestKind,
} from "back-end/src/models/EventWebhookModel";
import {
  postSlackMessage,
  isSlackWorkspacePlaceholderUrl,
} from "back-end/src/services/slack/slackWebApi";
import { getSlackWorkspaceTokenForTeam } from "back-end/src/services/slackIntegration";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { summarizeDigestEvents } from "back-end/src/services/slack/digestFilters";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "eventWebhookWeeklyDigest";

const runDigest = async (
  webhook: Awaited<ReturnType<typeof getSlackWebhooksWithDigestDue>>[number],
  kind: SlackDigestKind,
  now: Date,
) => {
  const dueAt =
    kind === "experiment"
      ? webhook.nextExperimentDigestAt
      : webhook.nextFeatureDigestAt;
  if (
    !isSlackWorkspacePlaceholderUrl(webhook.url) ||
    !dueAt ||
    dueAt > now ||
    !webhook.slack?.teamId ||
    !webhook.slack.channelId
  )
    return;
  const digest =
    kind === "experiment"
      ? resolveExperimentDigest(webhook.slackOptions)
      : resolveFeatureDigest(webhook.slackOptions);
  if (digest.frequency === "off") return;
  const claimed = await claimSlackDigestRun({
    eventWebHookId: webhook.id,
    organizationId: webhook.organizationId,
    kind,
    now,
    dueAt,
    dateUpdated: webhook.dateUpdated,
  });
  if (!claimed) return;
  try {
    const since = slackDigestWindowStart(digest, dueAt);
    const object = kind === "experiment" ? "experiment" : "feature";
    const events = EventModel.find({
      organizationId: webhook.organizationId,
      object,
      dateCreated: { $gte: since, $lt: dueAt },
    })
      .sort({ dateCreated: -1 })
      .lean()
      .cursor({ batchSize: 100 });
    const filters = {
      projects: webhook.projects || [],
      tags: webhook.tags || [],
      environments: webhook.environments || [],
      ids: [],
    };
    const summary = await summarizeDigestEvents(
      events,
      webhook.events,
      filters,
      claimed.leaseUntil,
    );
    const nextRunAt = slackDigestNextRunAt(digest, dueAt);
    if (!summary.count) {
      await completeSlackDigestRun({
        eventWebHookId: webhook.id,
        organizationId: webhook.organizationId,
        kind,
        leaseUntil: claimed.leaseUntil,
        nextRunAt,
        dueAt,
      });
      return;
    }

    const context = await getContextForAgendaJobByOrgId(webhook.organizationId);
    const token = await getSlackWorkspaceTokenForTeam({
      context,
      teamId: webhook.slack.teamId,
    });
    if (!(await isSlackDigestRunCurrent(webhook, kind, claimed.leaseUntil))) {
      await releaseSlackDigestRun({
        eventWebHookId: webhook.id,
        organizationId: webhook.organizationId,
        kind,
        leaseUntil: claimed.leaseUntil,
      });
      return;
    }
    const lines = summary.lines;
    if (summary.count > lines.length)
      lines.push(`… and ${summary.count - lines.length} more updates`);
    const posted = await postSlackMessage({
      token,
      channel: webhook.slack.channelId,
      text: `${kind === "experiment" ? "Experiment" : "Feature flag"} digest: ${summary.count} update${summary.count === 1 ? "" : "s"}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${kind === "experiment" ? "Experiment" : "Feature flag"} digest`,
          },
        },
        {
          type: "section",
          text: { type: "plain_text", text: lines.join("\n") },
        },
      ],
    });
    if (!posted) throw new Error("Slack digest delivery failed");
    await completeSlackDigestRun({
      eventWebHookId: webhook.id,
      organizationId: webhook.organizationId,
      kind,
      leaseUntil: claimed.leaseUntil,
      nextRunAt,
      dueAt,
    });
  } catch (error) {
    await releaseSlackDigestRun({
      eventWebHookId: webhook.id,
      organizationId: webhook.organizationId,
      kind,
      leaseUntil: claimed.leaseUntil,
    });
    throw error;
  }
};

export default function addEventWebhookWeeklyDigestJob(agenda: Agenda) {
  agenda.define(JOB_NAME, async () => {
    const now = new Date();
    for (const webhook of await getSlackWebhooksMissingDigestSchedule()) {
      await syncSlackDigestSchedule({
        eventWebHookId: webhook.id,
        organizationId: webhook.organizationId,
        slackOptions: webhook.slackOptions,
        from: now,
      });
    }
    for (const webhook of await getSlackWebhooksWithDigestDue(now)) {
      for (const kind of ["experiment", "feature"] as const) {
        try {
          await runDigest(webhook, kind, new Date());
        } catch (error) {
          logger.error(error, `Slack ${kind} digest failed for ${webhook.id}`);
        }
      }
    }
  });
  agenda
    .create(JOB_NAME, {})
    .unique({})
    .repeatEvery("1 hour")
    .save()
    .catch((error) =>
      logger.error(error, "Failed to schedule Slack digest job"),
    );
}
