import { getAllEventWebHooksForEvent } from "../../../models/EventWebhookModel";
import { NotificationEventHandler } from "../../notifiers/EventNotifier";
import { EventWebHookNotifier } from "./EventWebHookNotifier";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler: NotificationEventHandler = async (event) => {
  const eventWebHooks = await getAllEventWebHooksForEvent(
    event.organizationId,
    event.data.event,
    true
  );

  eventWebHooks.forEach((eventWebHook) => {
    const notifier = new EventWebHookNotifier({
      eventId: event.id,
      eventWebHookId: eventWebHook.id,
    });
    notifier.enqueue();
  });
};
