import Agenda from "agenda";
import {
  slackDigestWindowMs,
  resolveExperimentDigest,
  resolveFeatureDigest,
  slackDigestNextRunAt,
} from "shared/validators";
import { EventModel } from "back-end/src/models/EventModel";
import {
  claimSlackDigestRun,
  completeSlackDigestRun,
  releaseSlackDigestRun,
  getSlackWebhooksMissingDigestSchedule,
  getSlackWebhooksWithDigestDue,
  syncSlackDigestSchedule,
  type SlackDigestKind,
} from "back-end/src/models/EventWebhookModel";
import { postSlackMessage } from "back-end/src/services/slack/slackWebApi";
import { getSlackWorkspaceTokenForTeam } from "back-end/src/services/slackIntegration";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import {
  digestEventMatchesSubscription,
  digestEventPassesFilters,
} from "back-end/src/services/slack/digestFilters";
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
  const claimed = await claimSlackDigestRun({
    eventWebHookId: webhook.id,
    organizationId: webhook.organizationId,
    kind,
    now,
  });
  if (!claimed) return;
  try {
    const since = new Date(dueAt.getTime() - slackDigestWindowMs(digest));
    const object = kind === "experiment" ? "experiment" : "feature";
    const events = await EventModel.find({
      organizationId: webhook.organizationId,
      object,
      dateCreated: { $gte: since, $lte: dueAt },
    })
      .sort({ dateCreated: -1 })
      .lean();
    const filters = {
      projects: webhook.projects || [],
      tags: webhook.tags || [],
      environments: webhook.environments || [],
      ids: [],
    };
    const matchingEvents = events.filter(
      (event) =>
        digestEventMatchesSubscription(event, webhook.events) &&
        digestEventPassesFilters(event, filters),
    );
    const nextRunAt = slackDigestNextRunAt(digest, dueAt);
    if (!matchingEvents.length) {
      await completeSlackDigestRun({
        eventWebHookId: webhook.id,
        organizationId: webhook.organizationId,
        kind,
        leaseUntil: claimed.leaseUntil,
        nextRunAt,
      });
      return;
    }

    const context = await getContextForAgendaJobByOrgId(webhook.organizationId);
    const token = await getSlackWorkspaceTokenForTeam({
      context,
      teamId: webhook.slack.teamId,
    });
    const lines = matchingEvents.slice(0, 20).map((event) => {
      const data =
        typeof event.data === "object" && event.data !== null
          ? (event.data as Record<string, unknown>)
          : {};
      const nested =
        typeof data.data === "object" && data.data !== null
          ? (data.data as Record<string, unknown>)
          : {};
      const object =
        typeof data.object === "object" && data.object !== null
          ? (data.object as Record<string, unknown>)
          : {};
      const nestedObject =
        typeof nested.object === "object" && nested.object !== null
          ? (nested.object as Record<string, unknown>)
          : {};
      const name =
        (typeof object.name === "string" && object.name) ||
        (typeof nestedObject.name === "string" && nestedObject.name) ||
        (typeof object.id === "string" && object.id) ||
        "Unnamed";
      return `• ${escapeSlackText(event.event)} — ${escapeSlackText(name)}`;
    });
    const posted = await postSlackMessage({
      token,
      channel: webhook.slack.channelId,
      text: `${kind === "experiment" ? "Experiment" : "Feature flag"} digest: ${matchingEvents.length} update${matchingEvents.length === 1 ? "" : "s"}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${kind === "experiment" ? "Experiment" : "Feature flag"} digest`,
          },
        },
        { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      ],
    });
    if (!posted) throw new Error("Slack digest delivery failed");
    await completeSlackDigestRun({
      eventWebHookId: webhook.id,
      organizationId: webhook.organizationId,
      kind,
      leaseUntil: claimed.leaseUntil,
      nextRunAt,
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

const escapeSlackText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
          await runDigest(webhook, kind, now);
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
