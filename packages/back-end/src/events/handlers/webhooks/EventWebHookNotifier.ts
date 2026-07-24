import { Agenda, Job, JobAttributesData } from "agenda";
import {
  EventWebHookInterface,
  EventWebHookMethod,
} from "shared/types/event-webhook";
import { LegacyNotificationEvent } from "shared/types/events/notification-events";
import {
  EventInterface,
  NotificationEventName,
} from "shared/types/events/event";
import { NotificationEventResource } from "shared/types/events/base-types";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { getEvent } from "back-end/src/models/EventModel";
import {
  getEventWebHookById,
  getSlackBotAccessTokenForWebhook,
  updateEventWebHookStatus,
} from "back-end/src/models/EventWebhookModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { createEventWebHookLog } from "back-end/src/models/EventWebHookLogModel";
import { claimCoalesceBucket } from "back-end/src/models/EventWebHookCoalesceBucketModel";
import { logger } from "back-end/src/util/logger";
import { cancellableFetch } from "back-end/src/util/http.util";
import {
  buildCoalescedSlackMessage,
  getExperimentViewLink,
  getSlackMessageForNotificationEvent,
  getSlackMessageForLegacyNotificationEvent,
  renderExperimentCardForEvent,
  SlackMessage,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import {
  isSlackIncomingWebhookUrl,
  postSlackMessageResult,
  uploadSlackImageFile,
} from "back-end/src/services/slack/slackWebApi";
import { getLegacyMessageForNotificationEvent } from "back-end/src/events/handlers/legacy";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { SecretsReplacer } from "back-end/src/util/secrets";
import {
  EventWebHookErrorResult,
  EventWebHookResult,
  EventWebHookSuccessResult,
  getEventWebHookSignatureForPayload,
} from "./event-webhooks-utils";

export const EVENT_WEBHOOK_COALESCE_FLUSH_JOB = "eventWebHookCoalesceFlush";

type EventWebHookCoalesceFlushJobData = JobAttributesData & {
  organizationId: string;
  eventWebHookId: string;
  objectType: NotificationEventResource;
  objectId: string;
  retryCount: number;
  // Populated after the first execution claims the bucket. Subsequent
  // retries reuse these so we never lose events mid-retry.
  eventIds?: string[];
};

let jobDefined = false;

interface Notifier {
  enqueue(): void;
}

type EventWebHookNotificationHandlerOptions = {
  eventId: string;
  eventWebHookId: string;
};

type EventWebHookJobData = JobAttributesData &
  EventWebHookNotificationHandlerOptions & {
    retryCount: number;
  };

export class EventWebHookNotifier implements Notifier {
  constructor(
    private options: EventWebHookNotificationHandlerOptions,
    private agenda: Agenda = getAgendaInstance(),
  ) {
    if (jobDefined) return;

    this.agenda.define<EventWebHookJobData>(
      "eventWebHook",
      EventWebHookNotifier.handleAgendaJob,
    );
    this.agenda.define<EventWebHookCoalesceFlushJobData>(
      EVENT_WEBHOOK_COALESCE_FLUSH_JOB,
      EventWebHookNotifier.handleCoalesceFlushJob,
    );
    jobDefined = true;
  }

  /**
   * Enqueue the job to be performed immediately asynchronously in Agenda
   */
  async enqueue(): Promise<void> {
    const job = this.agenda.create<EventWebHookJobData>("eventWebHook", {
      ...this.options,
      retryCount: 0,
    });
    job.unique({
      "data.eventId": this.options.eventId,
      "data.eventWebHookId": this.options.eventWebHookId,
    });
    job.schedule(new Date());
    await job.save();
  }

  /**
   * Schedule a coalesce-window flush for (org, webhook, object). Uniqued by
   * that tuple so concurrent events within the window don't create extra jobs:
   * the first scheduling wins, later events just extend the existing bucket
   * which the pending job picks up at `flushAt`.
   */
  static async scheduleFlush({
    organizationId,
    eventWebHookId,
    objectType,
    objectId,
    flushAt,
    agenda = getAgendaInstance(),
  }: {
    organizationId: string;
    eventWebHookId: string;
    objectType: NotificationEventResource;
    objectId: string;
    flushAt: Date;
    agenda?: Agenda;
  }): Promise<void> {
    const job = agenda.create<EventWebHookCoalesceFlushJobData>(
      EVENT_WEBHOOK_COALESCE_FLUSH_JOB,
      {
        organizationId,
        eventWebHookId,
        objectType,
        objectId,
        retryCount: 0,
      },
    );
    job.unique({
      "data.organizationId": organizationId,
      "data.eventWebHookId": eventWebHookId,
      "data.objectType": objectType,
      "data.objectId": objectId,
    });
    job.schedule(flushAt);
    await job.save();
  }

  /**
   * This is the entry point for when the job executes
   * @param job
   * @private
   */
  private static async handleAgendaJob(
    job: Job<EventWebHookJobData>,
  ): Promise<void> {
    const { eventId, eventWebHookId } = job.attrs.data;

    const event = await getEvent(eventId);
    if (!event) {
      // We should never get here.
      throw new Error(
        `EventWebHookNotifier -> ImplementationError: No event for provided ID ${eventId}`,
      );
    }

    const eventWebHook = await getEventWebHookById(
      eventWebHookId,
      event.organizationId,
    );
    if (!eventWebHook) {
      // We should never get here.
      throw new Error(
        `EventWebHookNotifier -> ImplementationError: No webhook for provided ID: ${eventWebHookId}`,
      );
    }

    // The fan-out only enqueues enabled webhooks, but an admin can pause one
    // while this job waits in the queue. Don't deliver a notification for a
    // now-disabled webhook. Matches the coalesce-flush guard.
    if (!eventWebHook.enabled) {
      logger.info(
        { eventWebHookId, organizationId: event.organizationId },
        "EventWebHook: skipping delivery, webhook disabled after it was queued",
      );
      return;
    }

    const organization = await findOrganizationById(event.organizationId);
    if (!organization) {
      throw new Error(
        `EventWebHookNotifier -> ImplementationError: No organization for ID: ${event.organizationId}`,
      );
    }

    // Slack webhooks with a bot token deliver via chat.postMessage (not the
    // incoming-webhook URL) so a privately-uploaded (files.upload) results card
    // can be embedded. Short-circuits here; every other case falls through to
    // the generic URL delivery below.
    if ((eventWebHook.payloadType || "raw") === "slack" && event.version) {
      const handled = await EventWebHookNotifier.deliverSlackViaBotToken({
        job,
        event,
        eventId,
        eventWebHook,
        organizationId: organization.id,
      });
      if (handled) return;

      // No bot token/channel AND no real incoming-webhook URL (workspace-level
      // installs store a placeholder) — there is nowhere to deliver. Surface
      // an error in Run Logs rather than POSTing the placeholder.
      if (!isSlackIncomingWebhookUrl(eventWebHook.url)) {
        return EventWebHookNotifier.handleWebHookError({
          job,
          webHookResult: {
            result: "error",
            statusCode: null,
            error:
              "Slack delivery failed: no bot token or channel for this connection (reconnect the Slack workspace)",
          },
          organizationId: organization.id,
          event: event.event,
          url: eventWebHook.url,
          method: eventWebHook.method || "POST",
          payload: {},
        });
      }
    }

    const payload = await (async () => {
      let invalidPayloadType: never;

      // There might be very old webhook definitions who don't have
      // a payloadType at all. Assume "raw" in this case.
      const payloadType = eventWebHook.payloadType || "raw";

      switch (payloadType) {
        case "json": {
          if (!event.version) throw new Error("Internal error");
          return event.data;
        }

        case "raw": {
          const legacyPayload: LegacyNotificationEvent | undefined =
            event.version
              ? getLegacyMessageForNotificationEvent(event.data)
              : event.data;
          return legacyPayload;
        }

        case "slack": {
          if (!event.version)
            return getSlackMessageForLegacyNotificationEvent(
              event.data,
              eventId,
            );
          // Reached only when there's no bot token (the bot-token path is
          // handled earlier). Without a token we can't upload a private file,
          // and we never host experiment results at a public URL — so this is
          // text-only, delivered via the incoming-webhook URL.
          return getSlackMessageForNotificationEvent(event.data, eventId, {
            organizationId: event.organizationId,
          });
        }

        case "discord": {
          // Discord only uses the text; skip card rendering (no renderContext).
          const data = await (!event.version
            ? getSlackMessageForLegacyNotificationEvent(event.data, eventId)
            : getSlackMessageForNotificationEvent(event.data, eventId));

          if (!data) return null;

          return { content: data.text };
        }

        default:
          invalidPayloadType = payloadType;
          throw `Invalid payload type: ${invalidPayloadType}`;
      }
    })();
    if (!payload) {
      // Unsupported events return a null payload
      return;
    }

    const method = eventWebHook.method || "POST";

    const context = getContextForAgendaJobByOrgObject(organization);

    const origin = new URL(eventWebHook.url).origin;

    const applySecrets =
      await context.models.webhookSecrets.getBackEndSecretsReplacer(origin);

    const webHookResult = await EventWebHookNotifier.sendDataToWebHook({
      payload,
      eventWebHook,
      method,
      applySecrets,
    });

    switch (webHookResult.result) {
      case "success":
        return EventWebHookNotifier.handleWebHookSuccess({
          job,
          webHookResult,
          organizationId: organization.id,
          event: event.event,
          url: eventWebHook.url,
          method,
          payload,
        });

      case "error":
        return EventWebHookNotifier.handleWebHookError({
          job,
          webHookResult,
          organizationId: organization.id,
          event: event.event,
          url: eventWebHook.url,
          method,
          payload,
        });
    }
  }

  /**
   * Deliver a Slack notification via chat.postMessage using the webhook's bot
   * token, so a privately-uploaded (files.upload) results card can be embedded.
   * Returns false when there's no bot token/channel (caller falls back to the
   * generic incoming-webhook delivery); true when it handled delivery.
   */
  private static async deliverSlackViaBotToken({
    job,
    event,
    eventId,
    eventWebHook,
    organizationId,
  }: {
    job: Job<EventWebHookJobData>;
    event: EventInterface;
    eventId: string;
    eventWebHook: EventWebHookInterface;
    organizationId: string;
  }): Promise<boolean> {
    if (!event.version) return false; // legacy events use the generic path

    const botToken = await getSlackBotAccessTokenForWebhook({
      eventWebHookId: eventWebHook.id,
      organizationId,
    });
    const channelId = (eventWebHook.slack as { channelId?: string } | undefined)
      ?.channelId;
    if (!botToken || !channelId) return false;

    const message = await getSlackMessageForNotificationEvent(
      event.data,
      eventId,
      { organizationId },
    );
    if (!message) return true; // nothing to send; still skip the generic path

    // For card-worthy events the results card IS the message. Slack rejects
    // slack_file image blocks, so the card can't be combined with rich blocks in
    // one message; the card carries the detail, so buttons are dropped here.
    // Non-card events fall back to the rich text/buttons message.
    const card = await renderExperimentCardForEvent(
      event.data,
      organizationId,
      eventWebHook.slackOptions?.experimentCardFormat ?? "compact",
    );

    let ok: boolean;
    let error: string | null = null;
    let responseBody = "ok";
    if (card) {
      // No caption (the card image is self-describing), but a click-through
      // link so the image isn't a dead end — it's the only way to open the
      // experiment, since the card path drops the text message and buttons.
      const fileId = await uploadSlackImageFile({
        token: botToken,
        png: card.png,
        // Title by the event (e.g. "Experiment stopped"), not the experiment
        // name — the card already shows the name.
        title: card.caption,
        filename: "experiment-card.png",
        channelId,
        initialComment: getExperimentViewLink(card.experimentId),
      });
      ok = !!fileId;
      if (fileId) responseBody = fileId;
      else error = "files.upload/completeUploadExternal failed";
    } else {
      const result = await postSlackMessageResult({
        token: botToken,
        channel: channelId,
        text: message.text,
        blocks: message.blocks as unknown as Record<string, unknown>[],
        // Don't preview links that appear in the text (e.g. a URL in a name).
        unfurl: false,
      });
      ok = result.ok;
      error = result.error;
      if (result.ts) responseBody = result.ts;
    }

    const method = eventWebHook.method || "POST";
    const payload = message as unknown as Record<string, unknown>;
    if (ok) {
      await EventWebHookNotifier.handleWebHookSuccess({
        job,
        webHookResult: { result: "success", statusCode: 200, responseBody },
        organizationId,
        event: event.event,
        url: eventWebHook.url,
        method,
        payload,
      });
    } else {
      await EventWebHookNotifier.handleWebHookError({
        job,
        webHookResult: {
          result: "error",
          statusCode: null,
          // Surface the real Slack error (e.g. not_in_channel) in Run Logs.
          error: `Slack delivery failed: ${error}`,
        },
        organizationId,
        event: event.event,
        url: eventWebHook.url,
        method,
        payload,
      });
    }
    return true;
  }

  /**
   * Coalesce-flush job: claim the bucket (or reuse retry-captured event ids),
   * render a digest, deliver it as one Slack/Discord message, and log it as one
   * webhook delivery. On error the captured event ids are preserved in the job
   * data so retries replay the same payload instead of re-claiming an empty
   * bucket.
   */
  private static async handleCoalesceFlushJob(
    job: Job<EventWebHookCoalesceFlushJobData>,
  ): Promise<void> {
    const {
      organizationId,
      eventWebHookId,
      objectType,
      objectId,
      eventIds: cachedEventIds,
    } = job.attrs.data;

    let eventIds: string[];
    if (cachedEventIds && cachedEventIds.length > 0) {
      eventIds = cachedEventIds;
    } else {
      const bucket = await claimCoalesceBucket({
        organizationId,
        eventWebHookId,
        objectType,
        objectId,
      });
      if (!bucket || bucket.eventIds.length === 0) {
        // Nothing to deliver — bucket was already drained by another
        // worker or pruned. Treat as a no-op.
        return;
      }
      eventIds = bucket.eventIds;
      job.attrs.data.eventIds = eventIds;
    }

    const eventWebHook = await getEventWebHookById(
      eventWebHookId,
      organizationId,
    );
    if (!eventWebHook) {
      logger.warn(
        { eventWebHookId, organizationId },
        "Coalesce flush: webhook not found, dropping bucket",
      );
      return;
    }

    // A webhook disabled during the coalesce window must not deliver its
    // buffered digest — match the immediate fan-out, which excludes disabled
    // webhooks. The bucket is already claimed above, so returning drops it.
    if (!eventWebHook.enabled) {
      logger.info(
        { eventWebHookId, organizationId },
        "Coalesce flush: webhook disabled, dropping bucket",
      );
      return;
    }

    const organization = await findOrganizationById(organizationId);
    if (!organization) {
      logger.error(
        { organizationId },
        "Coalesce flush: organization not found",
      );
      return;
    }

    const loadedEvents: EventInterface[] = [];
    for (const id of eventIds) {
      const e = await getEvent(id);
      if (e) loadedEvents.push(e);
    }
    if (loadedEvents.length === 0) {
      logger.warn(
        { eventIds, eventWebHookId },
        "Coalesce flush: no events resolved, dropping bucket",
      );
      return;
    }

    const payload = await EventWebHookNotifier.buildCoalescedPayload({
      events: loadedEvents,
      payloadType: eventWebHook.payloadType || "raw",
    });
    if (!payload) {
      // No renderable events; nothing to deliver.
      return;
    }

    const method = eventWebHook.method || "POST";

    const logPayload = {
      ...(payload.body as Record<string, unknown>),
      coalescedEventIds: eventIds,
    };

    // Use the first event's name as the representative "event" for
    // status/log entries; the bundled ids are preserved in the payload.
    const representativeEvent = loadedEvents[0].event;

    const finish = (webHookResult: EventWebHookResult) =>
      webHookResult.result === "success"
        ? EventWebHookNotifier.handleWebHookSuccess({
            job: job as unknown as Job<EventWebHookJobData>,
            webHookResult,
            organizationId,
            event: representativeEvent,
            url: eventWebHook.url,
            method,
            payload: logPayload,
          })
        : EventWebHookNotifier.handleWebHookError({
            job: job as unknown as Job<EventWebHookJobData>,
            webHookResult,
            organizationId,
            event: representativeEvent,
            url: eventWebHook.url,
            method,
            payload: logPayload,
          });

    // Slack: prefer the bot token (chat.postMessage). Workspace-level installs
    // have no real incoming-webhook URL — only a placeholder that must never
    // be POSTed — and legacy installs with a token get delivery consistent
    // with the immediate (non-coalesced) path.
    if ((eventWebHook.payloadType || "raw") === "slack") {
      const botToken = await getSlackBotAccessTokenForWebhook({
        eventWebHookId,
        organizationId,
      });
      const channelId = (
        eventWebHook.slack as { channelId?: string } | undefined
      )?.channelId;
      if (botToken && channelId) {
        const message = payload.body as unknown as SlackMessage;
        const result = await postSlackMessageResult({
          token: botToken,
          channel: channelId,
          text: message.text,
          blocks: message.blocks as unknown as Record<string, unknown>[],
          unfurl: false,
        });
        return finish(
          result.ok
            ? {
                result: "success",
                statusCode: 200,
                responseBody: result.ts || "ok",
              }
            : {
                result: "error",
                statusCode: null,
                error: `Slack delivery failed: ${result.error}`,
              },
        );
      }
      if (!isSlackIncomingWebhookUrl(eventWebHook.url)) {
        return finish({
          result: "error",
          statusCode: null,
          error:
            "Slack delivery failed: no bot token or channel for this connection (reconnect the Slack workspace)",
        });
      }
    }

    const context = getContextForAgendaJobByOrgObject(organization);
    const origin = new URL(eventWebHook.url).origin;
    const applySecrets =
      await context.models.webhookSecrets.getBackEndSecretsReplacer(origin);

    const webHookResult = await EventWebHookNotifier.sendDataToWebHook({
      payload: payload.body,
      eventWebHook,
      method,
      applySecrets,
    });

    return finish(webHookResult);
  }

  /**
   * Render an array of events into a single Slack/Discord payload. Returns null
   * for raw/JSON types, which must stay 1:1 with events for API consumers.
   */
  private static async buildCoalescedPayload({
    events,
    payloadType,
  }: {
    events: EventInterface[];
    payloadType: NonNullable<EventWebHookInterface["payloadType"]>;
  }): Promise<{ body: Record<string, unknown> } | null> {
    if (payloadType !== "slack" && payloadType !== "discord") return null;

    const slackMessage = await buildCoalescedSlackMessage(events);
    if (!slackMessage) return null;

    if (payloadType === "slack") {
      return { body: slackMessage as unknown as Record<string, unknown> };
    }

    return { body: { content: (slackMessage as SlackMessage).text } };
  }

  /**
   * This function makes the post request to the given event web hook with the provided payload,
   * signing it.
   * @param payload
   * @param eventWebHook
   */
  private static async sendDataToWebHook<DataType>({
    payload,
    eventWebHook,
    method,
    applySecrets,
  }: {
    payload: DataType;
    eventWebHook: EventWebHookInterface;
    method: EventWebHookMethod;
    applySecrets: SecretsReplacer;
  }): Promise<EventWebHookResult> {
    const requestTimeout = 30000;
    const maxContentSize = 1000;

    try {
      const { url, signingKey, headers = {} } = eventWebHook;

      const signature = getEventWebHookSignatureForPayload({
        signingKey,
        payload,
      });

      const result = await cancellableFetch(
        applySecrets(url, { encode: encodeURIComponent }),
        {
          headers: {
            ...applySecrets(headers),
            "Content-Type": "application/json",
            "User-Agent": "GrowthBook Webhook",
            "X-GrowthBook-Signature": signature,
          },
          method,
          body: JSON.stringify(payload),
        },
        {
          maxTimeMs: requestTimeout,
          maxContentSize: maxContentSize,
        },
      );

      const { stringBody, responseWithoutBody } = result;

      if (!responseWithoutBody.ok) {
        // Server error
        return {
          result: "error",
          statusCode: responseWithoutBody.status,
          error: responseWithoutBody.statusText,
        };
      }

      return {
        result: "success",
        statusCode: responseWithoutBody.status,
        responseBody: stringBody,
      };
    } catch (e) {
      // Unknown error
      logger.error(e, "Unknown Error");

      return {
        result: "error",
        statusCode: null,
        error: e.message,
      };
    }
  }

  // region Result handling

  private static async handleWebHookSuccess({
    job,
    webHookResult: successResult,
    organizationId,
    event,
    url,
    method,
    payload,
  }: {
    job: Job<EventWebHookJobData>;
    webHookResult: EventWebHookSuccessResult;
    organizationId: string;
    event: NotificationEventName;
    url: string;
    method: EventWebHookMethod;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const { eventWebHookId } = job.attrs.data;

    await updateEventWebHookStatus(eventWebHookId, organizationId, {
      state: "success",
      responseBody: successResult.responseBody,
    });

    await createEventWebHookLog({
      eventWebHookId,
      organizationId,
      payload,
      event,
      url,
      method,
      result: {
        state: "success",
        responseBody: successResult.responseBody,
        responseCode: successResult.statusCode,
      },
    });
  }

  private static async handleWebHookError({
    job,
    webHookResult: errorResult,
    organizationId,
    event,
    url,
    method,
    payload,
  }: {
    job: Job<EventWebHookJobData>;
    webHookResult: EventWebHookErrorResult;
    organizationId: string;
    event: NotificationEventName;
    url: string;
    method: EventWebHookMethod;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const { eventWebHookId } = job.attrs.data;

    await updateEventWebHookStatus(eventWebHookId, organizationId, {
      state: "error",
      error: errorResult.error,
    });

    await createEventWebHookLog({
      eventWebHookId,
      organizationId,
      payload,
      event,
      url,
      method,
      result: {
        state: "error",
        responseBody: errorResult.error,
        responseCode: errorResult.statusCode,
      },
    });

    await EventWebHookNotifier.retryJob(job);
  }

  /**
   * Retries the job. Should only be called when a job has failed.
   * Retries up to 3 times.
   * Retries are as follows:
   *  1. 30 seconds later
   *  2. 5 minutes later
   *  3. 5 minutes later
   * @param job
   * @private
   */
  private static async retryJob(job: Job<EventWebHookJobData>) {
    if (job.attrs.data.retryCount >= 3) {
      // If it failed 3 times, give up
      return;
    }

    let nextRunAt = Date.now();
    if (job.attrs.data.retryCount === 0) {
      // Wait 30s after the first failure
      nextRunAt += 30000;
    } else {
      // Wait 5m after the second failure
      nextRunAt += 300000;
    }

    job.attrs.data.retryCount++;
    job.attrs.nextRunAt = new Date(nextRunAt);
    await job.save();
  }

  // endregion Result handling
}
