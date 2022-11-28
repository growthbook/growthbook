import {
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "../../base-types";

/**
 * handle Slack events. Can be handled individually or with a common handler, depending on needs.
 */
export const slackEventHandler = async (
  event: NotificationEventPayload<
    NotificationEventName,
    NotificationEventResource,
    unknown
  >
): Promise<void> => {
  console.log("slackEventHandler", event);
};
