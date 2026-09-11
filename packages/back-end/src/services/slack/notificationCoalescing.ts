import { createHash } from "node:crypto";
import Agenda from "agenda";
import { EventInterface } from "shared/types/events/event";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { ReqContext } from "back-end/types/request";
import { isSlackWorkspacePlaceholderUrl } from "back-end/src/services/slack/slackWebApi";
import { logger } from "back-end/src/util/logger";

export const COALESCE_JOB = "slackNotificationBatch";
export function getCoalesceWindow(
  organization: string,
  webhook: string,
  experiment: string,
  now = new Date(),
) {
  const end = (Math.floor(now.getTime() / 60000) + 1) * 60000;
  return {
    id:
      "slackbatch_" +
      createHash("sha256")
        .update(JSON.stringify([organization, webhook, experiment, end]))
        .digest("hex"),
    flushAt: new Date(end),
  };
}
export function getCoalescingExperimentId(
  event: EventInterface,
): string | null {
  if (!event.version || event.data.object !== "experiment") return null;
  const object = event.data.data.object;
  if ("experimentId" in object && typeof object.experimentId === "string")
    return object.experimentId || null;
  if ("id" in object && typeof object.id === "string") return object.id || null;
  return null;
}
export function shouldCoalesce(
  event: EventInterface,
  webhook: EventWebHookInterface,
): boolean {
  return (
    webhook.enabled &&
    webhook.payloadType === "slack" &&
    isSlackWorkspacePlaceholderUrl(webhook.url) &&
    webhook.slackOptions?.coalesceNotifications === true &&
    !!webhook.slack?.teamId &&
    !!webhook.slack.channelId &&
    getCoalescingExperimentId(event) !== null
  );
}
export async function scheduleCoalescedBatch(
  agenda: Agenda,
  batch: { id: string; organization: string; flushAt: Date },
  recoveryWindow = 0,
) {
  await agenda._collection.createIndex(
    { name: 1, "data.bucketId": 1, "data.recoveryWindow": 1 },
    {
      name: "slack_notification_batch_identity",
      unique: true,
      partialFilterExpression: { name: COALESCE_JOB },
    },
  );
  const job = agenda.create(COALESCE_JOB, {
    bucketId: batch.id,
    organization: batch.organization,
    attempts: 0,
    recoveryWindow,
  });
  job.unique(
    { "data.bucketId": batch.id, "data.recoveryWindow": recoveryWindow },
    { insertOnly: true },
  );
  job.schedule(batch.flushAt);
  await job.save();
}
export async function enqueueCoalescedEvent(
  event: EventInterface,
  webhook: EventWebHookInterface,
  context: ReqContext,
  agenda: Agenda,
): Promise<boolean> {
  const experimentId = getCoalescingExperimentId(event);
  if (!shouldCoalesce(event, webhook) || !experimentId) return false;
  const window = getCoalesceWindow(
    event.organizationId,
    webhook.id,
    experimentId,
  );
  let accepted: boolean;
  try {
    accepted = await context.models.slackNotificationBatches.append({
      ...window,
      eventWebHookId: webhook.id,
      experimentId: experimentId,
      eventId: event.id,
    });
  } catch (error) {
    logger.error(
      error,
      "Slack batch persistence failed; using ordinary delivery",
    );
    return false;
  }
  if (!accepted) return false;
  try {
    await scheduleCoalescedBatch(agenda, {
      ...window,
      organization: event.organizationId,
    });
  } catch (error) {
    // The durable bucket remains discoverable by the recovery sweep.
    logger.error(
      error,
      "Slack batch scheduling failed; recovery sweep will retry",
    );
  }
  return true;
}
