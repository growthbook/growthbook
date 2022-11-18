import {
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "../../base-types";
import { WithOrganizationId } from "../../base-events";
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
    Record<string, unknown> & WithOrganizationId
  >;

  await createEvent(
    resourceWithOrganization.data.organizationId,
    resourceWithOrganization
  );
};
