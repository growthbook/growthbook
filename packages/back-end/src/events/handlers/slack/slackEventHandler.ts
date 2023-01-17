import { NotificationEventHandler } from "../../notifiers/EventNotifier";
import { getEvent } from "../../../models/EventModel";
import { logger } from "../../../util/logger";
import { handleFeatureEventForSlack } from "./handleFeatureEventForSlack";

/**
 * handle Slack events. Can be handled individually or with a common handler, depending on needs.
 */
export const slackEventHandler: NotificationEventHandler = async (eventId) => {
  console.log("🔵 slackEventHandler", eventId);

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
      return await handleFeatureEventForSlack(event.organizationId, event.data);

    default:
      logger.error(`Unsupported event: ${event.event}`);
      break;
  }
};
