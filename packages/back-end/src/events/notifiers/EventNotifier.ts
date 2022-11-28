import { Agenda, Job, JobAttributesData } from "agenda";
import {
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "../base-types";
import { getAgendaInstance } from "../../services/queueing";
import { webHooksEventHandler } from "../handlers/webhooks/webHooksEventHandler";

interface Notifier {
  perform(): void;
}

interface EnqueuedData extends JobAttributesData {
  event: NotificationEventPayload<
    NotificationEventName,
    NotificationEventResource,
    unknown
  >;
}

export interface NotificationEventHandler {
  (
    payload: NotificationEventPayload<
      NotificationEventName,
      NotificationEventResource,
      unknown
    >
  ): Promise<void>;
}

export class EventNotifier implements Notifier {
  private readonly jobId: string;
  private readonly eventData: NotificationEventPayload<
    NotificationEventName,
    NotificationEventResource,
    unknown
  >;

  constructor(
    event: NotificationEventPayload<
      NotificationEventName,
      NotificationEventResource,
      unknown
    >,
    private agenda: Agenda = getAgendaInstance()
  ) {
    this.jobId = `events.notification.${event.event_id}`;
    this.eventData = event;

    this.agenda.define<EnqueuedData>(this.jobId, EventNotifier.jobHandler);
  }

  private static jobHandler(job: Job<EnqueuedData>): void {
    const { event } = job.attrs.data;

    webHooksEventHandler(event);
    // slackEventHandler(event);
  }

  perform() {
    this.agenda.now<EnqueuedData>(this.jobId, {
      event: this.eventData,
    });
  }
}
