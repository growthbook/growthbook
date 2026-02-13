import { Agenda, Job, JobAttributesData } from "agenda";
import {
  EventWebHookInterface,
  EventWebHookMethod,
} from "shared/types/event-webhook";
import { LegacyNotificationEvent } from "shared/types/events/notification-events";
import { NotificationEventName } from "shared/types/events/event";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { getEvent } from "back-end/src/models/EventModel";
import {
  getEventWebHookById,
  updateEventWebHookStatus,
} from "back-end/src/models/EventWebhookModel";
import { findOrganizationById } from "back-end/src/models/OrganizationModel";
import { createEventWebHookLog } from "back-end/src/models/EventWebHookLogModel";
import { logger } from "back-end/src/util/logger";
import { cancellableFetch } from "back-end/src/util/http.util";
import {
  getSlackMessageForNotificationEvent,
  getSlackMessageForLegacyNotificationEvent,
} from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import { getLegacyMessageForNotificationEvent } from "back-end/src/events/handlers/legacy";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { SecretsReplacer } from "back-end/src/util/secrets";
import {
  EventWebHookErrorResult,
  EventWebHookResult,
  EventWebHookSuccessResult,
  getEventWebHookSignatureForPayload,
} from "./event-webhooks-utils.js";

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

    const organization = await findOrganizationById(event.organizationId);
    if (!organization) {
      throw new Error(
        `EventWebHookNotifier -> ImplementationError: No organization for ID: ${event.organizationId}`,
      );
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
          return getSlackMessageForNotificationEvent(event.data, eventId);
        }

        case "discord": {
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

    await updateEventWebHookStatus(eventWebHookId, {
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

    await updateEventWebHookStatus(eventWebHookId, {
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
