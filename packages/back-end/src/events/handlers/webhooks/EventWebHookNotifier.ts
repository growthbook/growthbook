import { Agenda, Job, JobAttributesData } from "agenda";
import { getAgendaInstance } from "../../../services/queueing";
import { getEvent } from "../../../models/EventModel";
import { getEventWebHookById } from "../../../models/EventWebhookModel";

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
    console.log("❄️ jobHandler", job.attrs.data);

    const { eventId, eventWebHookId } = job.attrs.data;

    const event = await getEvent(eventId);
    if (!event) {
      // We should never get here.
      throw new Error(
        "EventWebHookNotifier -> ImplementationError: No event for provided ID"
      );
    }

    const eventWebHook = await getEventWebHookById(eventWebHookId);

    console.log("❄️ Perform the action for this web hook", eventWebHook);

    // const savedGroupMap = await getSavedGroupMap(organization);
  }

  async perform() {
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
  }
}

// switch (event.data.event) {
//   case "feature.created":
//     return handleWebHooksForFeatureCreated({
//       organization,
//       savedGroupMap,
//       eventWebHooks,
//       event: event.data,
//     });
//   case "feature.updated":
//     return handleWebHooksForFeatureUpdated({
//       organization,
//       savedGroupMap,
//       eventWebHooks,
//       event: event.data,
//     });
//   case "feature.deleted":
//     return handleWebHooksForFeatureDeleted({
//       organization,
//       savedGroupMap,
//       eventWebHooks,
//       event: event.data,
//     });
// }

/*

type BaseHandlerOptions = {
  organization: OrganizationInterface;
  savedGroupMap: GroupMap;
  eventWebHooks: EventWebHookInterface[];
};

const handleWebHooksForFeatureCreated = async ({
  event,
  organization,
  savedGroupMap,
}: BaseHandlerOptions & {
  event: FeatureCreatedNotificationEvent;
}): Promise<void> => {
  console.log("handleWebHooksForFeatureCreated");
};

const handleWebHooksForFeatureUpdated = async ({
  event,
  organization,
  savedGroupMap,
}: BaseHandlerOptions & {
  event: FeatureUpdatedNotificationEvent;
}): Promise<void> => {
  console.log("handleWebHooksForFeatureUpdated");

  const payload: NotificationEventPayload<
    "feature.updated",
    "feature",
    { current: ApiFeatureInterface; previous: ApiFeatureInterface }
  > = {
    ...event,
    data: {
      ...event.data,
      current: getApiFeatureObj(
        event.data.current,
        organization,
        savedGroupMap
      ),
      previous: getApiFeatureObj(
        event.data.previous,
        organization,
        savedGroupMap
      ),
    },
  };

  // const result = performEventWebHookNotification({
  //   eventWebHook,
  // })
};

const handleWebHooksForFeatureDeleted = async ({
  event,
  organization,
  savedGroupMap,
}: BaseHandlerOptions & {
  event: FeatureDeletedNotificationEvent;
}): Promise<void> => {
  console.log("handleWebHooksForFeatureDeleted");
};
*/
