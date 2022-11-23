import {
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "../../base-types";
import { createEvent } from "../../../models/EventModel";

/**
 * Log all the things!
 * @param payload
 */
export const eventLoggingHandler = async (
  payload: NotificationEventPayload<NotificationEventName, unknown, unknown>
) => {
  const resourceWithOrganization = (payload as unknown) as NotificationEventPayload<
    NotificationEventName,
    NotificationEventResource,
    Record<string, unknown>
  >;

  try {
    await createEvent(
      resourceWithOrganization.organization_id,
      resourceWithOrganization
    );
  } catch (e) {
    console.error(
      "eventLoggingHandler -> Failed to log event. Error: ",
      e,
      "Payload: ",
      payload
    );
  }
};
