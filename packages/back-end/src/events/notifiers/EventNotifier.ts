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
  private readonly eventData: EventInterface<NotificationEvent>;

  constructor(
    event: EventInterface<NotificationEvent>,
    private agenda: Agenda = getAgendaInstance()
  ) {
    this.eventData = event;

    this.agenda.define<EnqueuedData>("eventCreated", EventNotifier.jobHandler);
  }

  private static jobHandler(_job: Job<EnqueuedData>): void {
    // const { event } = job.attrs.data;
    // webHooksEventHandler(event);
    // slackEventHandler(event);
  }

  async perform() {
    const job = this.agenda.create("eventCreated", {
      event: this.eventData,
    });
    job.unique({ "data.event.id": this.eventData.id });
    job.schedule(new Date());
    await job.save();
  }
}
