import { NotificationEventHandler } from "../../notifiers/EventNotifier";
import { getEvent } from "../../../models/EventModel";
import { logger } from "../../../util/logger";
import { handleFeatureEventForSlack } from "./handleFeatureEventForSlack";

/**
 * handle Slack events. Can be handled individually or with a common handler, depending on needs.
 */
export const slackEventHandler: NotificationEventHandler = async (eventId) => {
  const event = await getEvent(eventId);
  if (!event) {
    // We should never get here
    throw new Error(
      "slackEventHandler -> ImplementationError: No event for provided ID"
    );
  }

  // Get all Slack integrations for the organization and the events
  switch (event.event) {
    case "feature.created":
    case "feature.updated":
    case "feature.deleted":
      return await handleFeatureEventForSlack({
        organizationId: event.organizationId,
        featureEvent: event.data,
        eventId: event.id,
      });

    default:
      logger.error(`Unsupported event: ${event.event}`);
      break;
  }
};
