import { NotificationEventHandler } from "../../notifiers/EventNotifier";
import { logger } from "../../../util/logger";
import { getSlackIntegrationsForFilters } from "../../../models/SlackIntegrationModel";
import {
  buildSlackMessageForEvent,
  filterSlackIntegrationForRelevance,
  getEnvironmentsForNotificationEvent,
  getProjectsForNotificationEvent,
  getTagsForNotificationEvent,
  sendSlackMessage,
} from "./slack-event-handler-utils";

/**
 * handle Slack events. Can be handled individually or with a common handler, depending on needs.
 */
export const slackEventHandler: NotificationEventHandler = async ({
  data,
  event,
  organizationId,
  id,
}) => {
  const tags = getTagsForNotificationEvent(data);
  const projects = getProjectsForNotificationEvent(data);
  const environments = getEnvironmentsForNotificationEvent(data);

  const slackIntegrations = (
    (await getSlackIntegrationsForFilters({
      organizationId,
      eventName: event,
      tags,
      environments,
      projects,
    })) || []
  ).filter((slackIntegration) =>
    filterSlackIntegrationForRelevance(slackIntegration, data)
  );

  slackIntegrations.forEach((slackIntegration) => {
    const slackMessage = buildSlackMessageForEvent({
      event: data,
      slackIntegration,
      eventId: id,
    });

    sendSlackMessage(slackMessage, slackIntegration.slackIncomingWebHook).then(
      (isSuccessful) => {
        if (!isSuccessful) {
          logger.warn("Failed to notify for Slack integration", {
            id: slackIntegration.id,
          });
        }
      }
    );
  });
};
