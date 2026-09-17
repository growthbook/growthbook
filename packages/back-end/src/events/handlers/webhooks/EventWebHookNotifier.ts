import { Agenda, Job, JobAttributesData } from "agenda";
import { EventWebHookMethod } from "shared/types/event-webhook";
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
import { deliverEventNotification } from "back-end/src/services/notifications/deliverEventNotification";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { isBookkeepingExperimentUpdate } from "back-end/src/events/experimentUpdateNoise";
import {
  EventWebHookErrorResult,
  EventWebHookSuccessResult,
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

    const method = eventWebHook.method || "POST";
    const context = getContextForAgendaJobByOrgObject(organization);
    if (
      eventWebHook.excludeBookkeepingUpdates &&
      isBookkeepingExperimentUpdate(event)
    )
      return;
    const delivery = await deliverEventNotification({
      context,
      event,
      eventWebHook,
    });

    // If the delivery is null, we don't need to do anything
    if (!delivery) {
      return;
    }

    const { result: webHookResult, payload: logPayload } = delivery;

    switch (webHookResult.result) {
      case "success":
        return EventWebHookNotifier.handleWebHookSuccess({
          job,
          webHookResult,
          organizationId: organization.id,
          event: event.event,
          url: eventWebHook.url,
          method,
          payload: logPayload,
        });

      case "error":
        return EventWebHookNotifier.handleWebHookError({
          job,
          webHookResult,
          organizationId: organization.id,
          event: event.event,
          url: eventWebHook.url,
          method,
          payload: logPayload,
        });
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
