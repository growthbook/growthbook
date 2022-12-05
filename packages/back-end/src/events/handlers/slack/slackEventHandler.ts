import { NotificationEventHandler } from "../../notifiers/EventNotifier";

/**
 * handle Slack events. Can be handled individually or with a common handler, depending on needs.
 */
export const slackEventHandler: NotificationEventHandler = async (eventId) => {
  console.log("slackEventHandler", eventId);
};
