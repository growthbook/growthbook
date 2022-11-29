import { getAllEventWebHooksForEvent } from "../../../models/EventWebhookModel";
import { NotificationEventHandler } from "../../notifiers/EventNotifier";
import { getEvent } from "../../../models/EventModel";
import { EventWebHookNotifier } from "./EventWebHookNotifier";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler: NotificationEventHandler = async (
  eventId
) => {
  const event = await getEvent(eventId);
  if (!event) {
    // We should never get here
    throw new Error(
      "webHooksEventHandler -> ImplementationError: No event for provided ID"
    );
  }

  const eventWebHooks = await getAllEventWebHooksForEvent(
    event.organizationId,
    event.data.event
  );

  eventWebHooks.forEach((eventWebHook) => {
    const notifier = new EventWebHookNotifier({
      eventId,
      eventWebHookId: eventWebHook.id,
    });
    notifier.perform();
  });
};
