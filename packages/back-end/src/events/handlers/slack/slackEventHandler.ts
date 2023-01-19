import { NotificationEventHandler } from "../../notifiers/EventNotifier";
import { logger } from "../../../util/logger";
import { handleFeatureEventForSlack } from "./handleFeatureEventForSlack";

/**
 * handle Slack events. Can be handled individually or with a common handler, depending on needs.
 */
export const slackEventHandler: NotificationEventHandler = async (event) => {
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
