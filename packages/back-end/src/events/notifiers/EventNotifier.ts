import { Agenda, Job, JobAttributesData } from "agenda";
import { getAgendaInstance } from "../../services/queueing";
import { EventInterface } from "../../../types/event";
import { NotificationEvent } from "../base-events";

interface Notifier {
  perform(): void;
}

interface EnqueuedData extends JobAttributesData {
  event: EventInterface<NotificationEvent>;
}

export interface NotificationEventHandler {
  (event: EventInterface<NotificationEvent>): Promise<void>;
}

export class EventNotifier implements Notifier {
  private readonly jobId: string;
  private readonly eventData: EventInterface<NotificationEvent>;

  constructor(
    event: EventInterface<NotificationEvent>,
    private agenda: Agenda = getAgendaInstance()
  ) {
    this.jobId = `events.notification.${event.id}`;
    this.eventData = event;

    this.agenda.define<EnqueuedData>(this.jobId, EventNotifier.jobHandler);
  }

  private static jobHandler(_job: Job<EnqueuedData>): void {
    // const { event } = job.attrs.data;
    // webHooksEventHandler(event);
    // slackEventHandler(event);
  }

  perform() {
    this.agenda.now<EnqueuedData>(this.jobId, {
      event: this.eventData,
    });
  }
}
