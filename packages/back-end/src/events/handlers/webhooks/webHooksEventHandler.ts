import {
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "../../base-types";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler = async (
  event: NotificationEventPayload<
    NotificationEventName,
    NotificationEventResource,
    unknown
  >
): Promise<void> => {
  console.log("webHooksEventHandler -> ", event);
};
