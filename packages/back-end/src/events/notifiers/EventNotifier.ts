import { Agenda, Job, JobAttributesData } from "agenda";
import { EventInterface } from "shared/types/events/event";
import { getEventAgendaInstance } from "back-end/src/services/queueing";
import { EVENT_QUEUE_CONFIG } from "back-end/src/util/secrets";
import { webHooksEventHandler } from "back-end/src/events/handlers/webhooks/webHooksEventHandler";
import { slackEventHandler } from "back-end/src/events/handlers/slack/slackEventHandler";
import { getEvent } from "back-end/src/models/EventModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { Context } from "back-end/src/models/BaseModel";

const definedAgendas = new WeakSet<Agenda>();

interface Notifier {
  perform(): Promise<void>;
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
    private agenda: Agenda = getEventAgendaInstance(),
  ) {
    this.eventId = eventId;
    EventNotifier.register(this.agenda);
  }

  static register(agenda: Agenda): void {
    if (definedAgendas.has(agenda)) return;

    agenda.define<EventNotificationData>(
      "eventCreated",
      EVENT_QUEUE_CONFIG.eventCreated,
      EventNotifier.jobHandler,
    );
    definedAgendas.add(agenda);
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

    const results = await Promise.allSettled([
      webHooksEventHandler(event, context),
      slackEventHandler(event, context),
    ]);
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
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
