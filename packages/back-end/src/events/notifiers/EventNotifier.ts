import { Agenda, Job, JobAttributesData } from "agenda";
import { getAgendaInstance } from "../../services/queueing";
import { EventInterface } from "../../../types/event";
import { NotificationEvent } from "../base-events";

let jobDefined = false;

interface Notifier {
  perform(): void;
}

interface EventNotificationData extends JobAttributesData {
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

    if (jobDefined) return;

    this.agenda.define<EventNotificationData>(
      "eventCreated",
      EventNotifier.jobHandler
    );
    jobDefined = true;
  }

  private static jobHandler(_job: Job<EventNotificationData>): void {
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
