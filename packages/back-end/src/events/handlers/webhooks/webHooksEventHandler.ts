import {
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "../../base-types";

/**
 * Common handler that looks up the web hooks and makes a post request with the event.
 * @param payload
 */
export const webHooksEventHandler = async (
  payload: NotificationEventPayload<NotificationEventName, unknown, unknown>
) => {
  const resourceWithOrganization = (payload as unknown) as NotificationEventPayload<
    NotificationEventName,
    NotificationEventResource,
    Record<string, unknown>
  >;

  console.log("webHooksEventHandler -> ", resourceWithOrganization);
};
