import { Agenda, Job, JobAttributesData } from "agenda";
import { getAgendaInstance } from "../../../services/queueing";
import { getEvent } from "../../../models/EventModel";
import {
  getEventWebHookById,
  updateEventWebHookStatus,
} from "../../../models/EventWebhookModel";
import fetch from "node-fetch";
import {
  EventWebHookErrorResult,
  EventWebHookResult,
  EventWebHookSuccessResult,
  getEventWebHookSignatureForPayload,
  getPayloadForNotificationEvent,
} from "./event-webhooks-utils";
import { EventWebHookInterface } from "../../../../types/event-webhook";
import { getSavedGroupMap } from "../../../services/features";
import { findOrganizationById } from "../../../models/OrganizationModel";

let jobDefined = false;

interface Notifier {
  perform(): void;
}

type EventWebHookNotificationHandlerOptions = {
  eventId: string;
  eventWebHookId: string;
};

type EventWebHookJobData = JobAttributesData &
  EventWebHookNotificationHandlerOptions;

export class EventWebHookNotifier implements Notifier {
  constructor(
    private options: EventWebHookNotificationHandlerOptions,
    private agenda: Agenda = getAgendaInstance()
  ) {
    if (jobDefined) return;

    this.agenda.define<EventWebHookJobData>(
      "eventWebHook",
      EventWebHookNotifier.jobHandler
    );
    jobDefined = true;
  }

  private static async jobHandler(
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

    const eventWebHook = await getEventWebHookById(eventWebHookId);
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

    const webHookResult = await performEventWebHookNotification({
      payload,
      eventWebHook,
    });

    console.log("❄️ Result", webHookResult);

    switch (webHookResult.result) {
      case "success":
        return EventWebHookNotifier.handleWebHookSuccess(job, webHookResult);

      case "error":
        return EventWebHookNotifier.handleWebHookError(job, webHookResult);
    }
  }

  private static async handleWebHookSuccess(
    job: Job<EventWebHookJobData>,
    successResult: EventWebHookSuccessResult
  ): Promise<void> {
    const { eventId, eventWebHookId } = job.attrs.data;
    console.log("✅ Success!", successResult, { eventId, eventWebHookId });

    await updateEventWebHookStatus(eventWebHookId, {
      state: "success",
    });
    // TODO: Log run with error result
  }

  private static async handleWebHookError(
    job: Job<EventWebHookJobData>,
    errorResult: EventWebHookErrorResult
  ): Promise<void> {
    const { eventId, eventWebHookId } = job.attrs.data;
    console.log("❗️ Error!", errorResult, { eventId, eventWebHookId });
    // TODO: Log run with error result
    // TODO: Retry logic

    await updateEventWebHookStatus(eventWebHookId, {
      state: "error",
      error: errorResult.error,
    });
  }

  perform = async (): Promise<void> => {
    const job = this.agenda.create<EventWebHookJobData>(
      "eventWebHook",
      this.options
    );
    job.unique({
      "data.eventId": this.options.eventId,
      "data.eventWebHookId": this.options.eventWebHookId,
    });
    job.schedule(new Date());
    await job.save();
  };
}

/**
 * This function makes the post request to the given event web hook with the provided payload,
 * signing it.
 * @param payload
 * @param eventWebHook
 */
const performEventWebHookNotification = async <DataType>({
  payload,
  eventWebHook,
}: {
  payload: DataType;
  eventWebHook: EventWebHookInterface;
}): Promise<EventWebHookResult> => {
  try {
    const { url, signingKey } = eventWebHook;

    const signature = getEventWebHookSignatureForPayload({
      signingKey,
      payload,
    });

    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-GrowthBook-Signature": signature,
      },
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // Server error
      return {
        result: "error",
        statusCode: res.status,
        error: res.statusText,
      };
    }

    // Success
    return {
      result: "success",
      statusCode: res.status,
    };
  } catch (e) {
    // Unknown error
    console.error("Unknown Error", e);

    return {
      result: "error",
      statusCode: null,
      error: e.message,
    };
  }
};
