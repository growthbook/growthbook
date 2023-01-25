import { Agenda, Job, JobAttributesData } from "agenda";
import { getAgendaInstance } from "../../services/queueing";
import { webHooksEventHandler } from "../handlers/webhooks/webHooksEventHandler";
import { slackEventHandler } from "../handlers/slack/slackEventHandler";
import { EventInterface } from "../../../types/event";
import { NotificationEvent } from "../base-events";
import { getEvent } from "../../models/EventModel";

let jobDefined = false;

interface Notifier {
  perform(): void;
}

interface EventNotificationData extends JobAttributesData {
  eventId: string;
}

export interface NotificationEventHandler {
  (event: EventInterface<NotificationEvent>): Promise<void>;
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

  private static async jobHandler(
    job: Job<EventNotificationData>
  ): Promise<void> {
    const { eventId } = job.attrs.data;

    const event = await getEvent(eventId);
    if (!event) {
      // We should never get here
      throw new Error(`jobHandler -> No event for ID ${eventId}`);
    }

    webHooksEventHandler(event);
    slackEventHandler(event);
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
