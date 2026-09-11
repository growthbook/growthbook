import Agenda, { Job } from "agenda";
import isEqual from "lodash/isEqual";
import { SlackNotificationBatchModel } from "back-end/src/models/SlackNotificationBatchModel";
import { getEvent } from "back-end/src/models/EventModel";
import {
  getEventWebHookById,
  updateEventWebHookStatus,
} from "back-end/src/models/EventWebhookModel";
import { createEventWebHookLog } from "back-end/src/models/EventWebHookLogModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getSlackWorkspaceTokenForTeam } from "back-end/src/services/slackIntegration";
import {
  postSlackMessageResult,
  isSlackWorkspacePlaceholderUrl,
} from "back-end/src/services/slack/slackWebApi";
import { EventWebHookNotifier } from "back-end/src/events/handlers/webhooks/EventWebHookNotifier";
import {
  digestEventLine,
  digestEventMatchesSubscription,
  digestEventPassesFilters,
} from "back-end/src/services/slack/digestFilters";
import {
  getCoalescingExperimentId,
  COALESCE_JOB,
  scheduleCoalescedBatch,
} from "back-end/src/services/slack/notificationCoalescing";
import { logger } from "back-end/src/util/logger";

type BatchJob = { bucketId: string; organization: string; attempts: number };
export async function flushSlackNotificationBatch(
  data: BatchJob,
  agenda: Agenda,
): Promise<void> {
  const context = await getContextForAgendaJobByOrgId(data.organization);
  const model = context.models.slackNotificationBatches;
  const batch = await model.claim(data.bucketId, new Date());
  if (!batch) return;
  let reportFailure: ((message: string) => Promise<void>) | null = null;
  let delivered = false;
  try {
    const webhook = await getEventWebHookById(
      batch.eventWebHookId,
      data.organization,
    );
    if (
      !webhook?.enabled ||
      webhook.payloadType !== "slack" ||
      !isSlackWorkspacePlaceholderUrl(webhook.url) ||
      !webhook.slack?.teamId ||
      !webhook.slack.channelId
    ) {
      await model.finish(batch.id, batch.leaseUntil, "sent");
      return;
    }
    const events = (await Promise.all(batch.eventIds.map(getEvent))).filter(
      (event): event is NonNullable<typeof event> =>
        !!event &&
        event.organizationId === data.organization &&
        getCoalescingExperimentId(event) === batch.experimentId &&
        digestEventMatchesSubscription(event, webhook.events) &&
        digestEventPassesFilters(event, {
          projects: webhook.projects || [],
          environments: webhook.environments || [],
          tags: webhook.tags || [],
          ids: [],
        }),
    );
    if (
      events.length <= 1 ||
      webhook.slackOptions?.coalesceNotifications !== true
    ) {
      for (const event of events)
        await new EventWebHookNotifier(
          {
            eventId: event.id,
            eventWebHookId: webhook.id,
            bypassCoalescing: true,
          },
          agenda,
        ).enqueue();
      await model.finish(batch.id, batch.leaseUntil, "sent");
      return;
    }
    reportFailure = async (message) => {
      await updateEventWebHookStatus(webhook.id, data.organization, {
        state: "error",
        error: message,
      });
      await createEventWebHookLog({
        eventWebHookId: webhook.id,
        organizationId: data.organization,
        event: events[0].event,
        url: webhook.url,
        method: webhook.method || "POST",
        payload: { coalescedEventIds: events.map((event) => event.id) },
        result: { state: "error", responseBody: message, responseCode: 0 },
      });
    };
    const lines = events.slice(0, 5).map(digestEventLine);
    const text = `${events.length} experiment updates\n\n${lines.join("\n\n")}${events.length > 5 ? `\n\n${events.length - 5} additional updates.` : ""}`;
    const token = await getSlackWorkspaceTokenForTeam({
      context,
      teamId: webhook.slack.teamId,
    });
    const payload = {
      text: "Experiment notification summary",
      blocks: [{ type: "section", text: { type: "plain_text", text } }],
    };
    // Settings may have changed while loading events or resolving the token.
    const current = await getEventWebHookById(webhook.id, data.organization);
    if (
      !current ||
      !isEqual(
        [
          current.payloadType,
          current.enabled,
          current.url,
          current.slack,
          current.slackOptions,
          current.events,
          current.projects,
          current.tags,
          current.environments,
        ],
        [
          webhook.payloadType,
          webhook.enabled,
          webhook.url,
          webhook.slack,
          webhook.slackOptions,
          webhook.events,
          webhook.projects,
          webhook.tags,
          webhook.environments,
        ],
      )
    )
      throw new Error("Slack batch settings changed before delivery");
    if (!(await model.hasCurrentLease(batch.id, batch.leaseUntil)))
      throw new Error("Slack batch delivery lease expired");
    const result = await postSlackMessageResult({
      token,
      channel: webhook.slack.channelId,
      ...payload,
    });
    if (!result.ok)
      throw new Error(`Slack batch delivery failed: ${result.error}`);
    await model.finish(batch.id, batch.leaseUntil, "sent");
    delivered = true;
    await updateEventWebHookStatus(webhook.id, data.organization, {
      state: "success",
      responseBody: result.ts || "ok",
    });
    await createEventWebHookLog({
      eventWebHookId: webhook.id,
      organizationId: data.organization,
      event: events[0].event,
      url: webhook.url,
      method: webhook.method || "POST",
      payload: {
        ...payload,
        coalescedEventIds: events.map((event) => event.id),
      },
      result: {
        state: "success",
        responseBody: result.ts || "ok",
        responseCode: 200,
      },
    });
  } catch (error) {
    if (delivered) throw error;
    try {
      if (
        reportFailure &&
        (await model.hasCurrentLease(batch.id, batch.leaseUntil))
      )
        await reportFailure(
          error instanceof Error
            ? error.message
            : "Slack batch delivery failed",
        );
    } catch (reportError) {
      logger.error(reportError, "Slack batch failure reporting failed");
    }
    if (batch.attempts >= 4)
      await model.finish(batch.id, batch.leaseUntil, "failed");
    else await model.release(batch.id, batch.leaseUntil);
    throw error;
  }
}
export default function addSlackNotificationCoalescing(agenda: Agenda) {
  agenda.define(COALESCE_JOB, async (job: Job<BatchJob>) => {
    try {
      await flushSlackNotificationBatch(job.attrs.data, agenda);
    } catch (error) {
      logger.error(error, "Slack batch delivery failed");
      if (job.attrs.data.attempts >= 3) {
        throw error;
      }
      job.attrs.data.attempts++;
      job.schedule(new Date(Date.now() + 60000));
      await job.save();
    }
  });
  agenda.define("slackNotificationBatchRecovery", async () => {
    for (const batch of await SlackNotificationBatchModel.dangerousGetDue(
      new Date(),
    )) {
      try {
        await scheduleCoalescedBatch(
          agenda,
          batch,
          Math.floor(Date.now() / 60000),
        );
      } catch (error) {
        logger.error(error, "Slack batch recovery failed");
      }
    }
  });
  agenda
    .create("slackNotificationBatchRecovery", {})
    .unique({})
    .repeatEvery("1 minute")
    .save()
    .catch((error) =>
      logger.error(error, "Slack batch recovery scheduling failed"),
    );
}
