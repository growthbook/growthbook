import { Agenda, Job, JobAttributesData } from "agenda";
import { EventInterface } from "shared/types/events/event";
import { getAgendaInstance } from "back-end/src/services/queueing";
import { webHooksEventHandler } from "back-end/src/events/handlers/webhooks/webHooksEventHandler";
import { slackEventHandler } from "back-end/src/events/handlers/slack/slackEventHandler";
import { getEvent } from "back-end/src/models/EventModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { Context } from "back-end/src/models/BaseModel";

let jobDefined = false;

interface Notifier {
  perform(): void;
}

interface EventNotificationData extends JobAttributesData {
  eventId: string;
}

export interface NotificationEventHandler {
  (event: EventInterface, context: Context): Promise<void>;
}

export class EventNotifier implements Notifier {
  private readonly eventId: string;

  constructor(
    eventId: string,
    private agenda: Agenda = getAgendaInstance(),
  ) {
    this.eventId = eventId;

    if (jobDefined) return;

    this.agenda.define<EventNotificationData>(
      "eventCreated",
      EventNotifier.jobHandler,
    );
    jobDefined = true;
  }

  private static async jobHandler(
    job: Job<EventNotificationData>,
  ): Promise<void> {
    const { eventId } = job.attrs.data;

    const event = await getEvent(eventId);
    if (!event) {
      // We should never get here
      throw new Error(`jobHandler -> No event for ID ${eventId}`);
    }

    const context = await getContextForAgendaJobByOrgId(event.organizationId);

    webHooksEventHandler(event, context);
    slackEventHandler(event, context);
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
