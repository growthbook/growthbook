import { getAllEventWebHooksForEvent } from "../../../models/EventWebhookModel";
import { NotificationEventHandler } from "../../notifiers/EventNotifier";
import { getEvent } from "../../../models/EventModel";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */

export const webHooksEventHandler: NotificationEventHandler = async (event) => {
  const eventDoc = await getEvent(event.event_id);
  if (!eventDoc) {
    // We should never get here
    throw new Error("ImplementationError: No event for provided ID");
  }

  const eventWebHooks = await getAllEventWebHooksForEvent(
    eventDoc.organizationId,
    eventDoc.data.event
  );

  console.log("relevant web hooks", eventWebHooks);
};
