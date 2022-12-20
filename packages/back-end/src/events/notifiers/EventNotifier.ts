import { Agenda, Job, JobAttributesData } from "agenda";
import { getAgendaInstance } from "../../services/queueing";
import { webHooksEventHandler } from "../handlers/webhooks/webHooksEventHandler";

let jobDefined = false;

interface Notifier {
  perform(): void;
}

interface EventNotificationData extends JobAttributesData {
  eventId: string;
}

export interface NotificationEventHandler {
  (eventId: string): Promise<void>;
}

export class EventNotifier implements Notifier {
  private readonly eventId: string;

  constructor(eventId: string, private agenda: Agenda = getAgendaInstance()) {
    this.eventId = eventId;

    if (jobDefined) return;

    this.agenda.define<EventNotificationData>(
      "eventCreated",
      EventNotifier.jobHandler
    );
    jobDefined = true;
  }

  private static jobHandler(job: Job<EventNotificationData>): void {
    const { eventId } = job.attrs.data;
    webHooksEventHandler(eventId);
    // slackEventHandler(event);
  }

  async perform() {
    const job = this.agenda.create<EventNotificationData>("eventCreated", {
      eventId: this.eventId,
    });
    job.unique({ "data.eventId": this.eventId });
    job.schedule(new Date());
    await job.save();
  }
}
