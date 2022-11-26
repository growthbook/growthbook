import { getEvent } from "../../../models/EventModel";
import { getAllEventWebHooksForEvent } from "../../../models/EventWebhookModel";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler = async (eventId: string): Promise<void> => {
  console.log("webHooksEventHandler -> ", eventId);

  const event = await getEvent(eventId);
  if (!event) {
    // We should never get here
    throw new Error("No event for provided ID");
  }

  const eventWebHooks = await getAllEventWebHooksForEvent(
    event.organizationId,
    event.data.event
  );

  console.log("relevant web hooks", eventWebHooks);

  // TODO: Enqueue each web hook in Agenda
};
