import { NotificationEventHandler } from "../../notifiers/EventNotifier";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 */
export const webHooksEventHandler: NotificationEventHandler = async (event) => {
  console.log("webHooksEventHandler -> ", event);
};
