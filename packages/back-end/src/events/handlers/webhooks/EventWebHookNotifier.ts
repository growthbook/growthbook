import { Agenda, Job, JobAttributesData } from "agenda";
import { getAgendaInstance } from "../../../services/queueing";
import { getEvent } from "../../../models/EventModel";
import {
  getEventWebHookById,
  updateEventWebHookStatus,
} from "../../../models/EventWebhookModel";
import { EventWebHookInterface } from "../../../../types/event-webhook";
import { getSavedGroupMap } from "../../../services/features";
import { findOrganizationById } from "../../../models/OrganizationModel";
import { createEventWebHookLog } from "../../../models/EventWebHookLogModel";
import { logger } from "../../../util/logger";
import { cancellableFetch } from "../../../util/http.util";
import {
  EventWebHookErrorResult,
  EventWebHookResult,
  EventWebHookSuccessResult,
  getEventWebHookSignatureForPayload,
  getPayloadForNotificationEvent,
} from "./event-webhooks-utils";

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
    private agenda: Agenda = getAgendaInstance()
  ) {
    if (jobDefined) return;

    this.agenda.define<EventWebHookJobData>(
      "eventWebHook",
      EventWebHookNotifier.handleAgendaJob
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
    job: Job<EventWebHookJobData>
  ): Promise<void> {
    const { eventId, eventWebHookId } = job.attrs.data;

    const event = await getEvent(eventId);
    if (!event) {
      // We should never get here.
      throw new Error(
        `EventWebHookNotifier -> ImplementationError: No event for provided ID ${eventId}`
      );
    }

    const eventWebHook = await getEventWebHookById(
      eventWebHookId,
      event.organizationId
    );
    if (!eventWebHook) {
      // We should never get here.
      throw new Error(
        `EventWebHookNotifier -> ImplementationError: No webhook for provided ID: ${eventWebHookId}`
      );
    }

    const organization = await findOrganizationById(event.organizationId);
    if (!organization) {
      throw new Error(
        `EventWebHookNotifier -> ImplementationError: No organization for ID: ${event.organizationId}`
      );
    }

    const savedGroupMap = await getSavedGroupMap(organization);
    const payload = getPayloadForNotificationEvent({
      event: event.data,
      organization,
      savedGroupMap,
    });

    if (!payload) {
      // Unsupported events return a null payload
      return;
    }

    const webHookResult = await EventWebHookNotifier.sendDataToWebHook({
      payload,
      eventWebHook,
    });

    switch (webHookResult.result) {
      case "success":
        return EventWebHookNotifier.handleWebHookSuccess(
          job,
          webHookResult,
          organization.id,
          payload
        );

      case "error":
        return EventWebHookNotifier.handleWebHookError(
          job,
          webHookResult,
          organization.id,
          payload
        );
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
  }: {
    payload: DataType;
    eventWebHook: EventWebHookInterface;
  }): Promise<EventWebHookResult> {
    const requestTimeout = 30000;
    const maxContentSize = 1000;

    try {
      const { url, signingKey } = eventWebHook;

      const signature = getEventWebHookSignatureForPayload({
        signingKey,
        payload,
      });

      const result = await cancellableFetch(
        url,
        {
          headers: {
            "Content-Type": "application/json",
            "X-GrowthBook-Signature": signature,
          },
          method: "POST",
          body: JSON.stringify(payload),
        },
        {
          maxTimeMs: requestTimeout,
          maxContentSize: maxContentSize,
        }
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

  private static async handleWebHookSuccess(
    job: Job<EventWebHookJobData>,
    successResult: EventWebHookSuccessResult,
    organizationId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const { eventWebHookId } = job.attrs.data;

    await updateEventWebHookStatus(eventWebHookId, {
      state: "success",
      responseBody: successResult.responseBody,
    });

    await createEventWebHookLog({
      eventWebHookId,
      organizationId,
      payload,
      result: {
        state: "success",
        responseBody: successResult.responseBody,
        responseCode: successResult.statusCode,
      },
    });
  }

  private static async handleWebHookError(
    job: Job<EventWebHookJobData>,
    errorResult: EventWebHookErrorResult,
    organizationId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const { eventWebHookId } = job.attrs.data;

    await updateEventWebHookStatus(eventWebHookId, {
      state: "error",
      error: errorResult.error,
    });

    await createEventWebHookLog({
      eventWebHookId,
      organizationId,
      payload,
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
