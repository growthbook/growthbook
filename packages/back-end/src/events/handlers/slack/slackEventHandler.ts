import cloneDeep from "lodash/cloneDeep";
import { logger } from "@back-end/src/util/logger";
import { getSlackIntegrationsForFilters } from "@back-end/src/models/SlackIntegrationModel";
import { NotificationEventHandler } from "@back-end/src/events/notifiers/EventNotifier";
import { filterEventForEnvironments } from "@back-end/src/events/handlers/utils";
import {
  getSlackDataForNotificationEvent,
  getSlackIntegrationContextBlock,
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
  const result = getSlackDataForNotificationEvent(data, id);
  if (!result) {
    // Unsupported events do not return a result
    return;
  }

  const { filterData, slackMessage } = result;
  const { tags, projects } = filterData;

  const slackIntegrations = (
    (await getSlackIntegrationsForFilters({
      organizationId,
      eventName: event,
      tags,
      projects,
    })) || []
  ).filter(({ environments }) =>
    filterEventForEnvironments({ event: data, environments })
  );

  slackIntegrations.forEach((slackIntegration) => {
    const slackMessageWithContext = cloneDeep(slackMessage);

    // Add the GrowthBook Slack integration context to all messages
    slackMessageWithContext.blocks.push(
      getSlackIntegrationContextBlock(slackIntegration)
    );

    sendSlackMessage(
      slackMessageWithContext,
      slackIntegration.slackIncomingWebHook
    ).then((isSuccessful) => {
      if (!isSuccessful) {
        logger.warn("Failed to notify for Slack integration", {
          id: slackIntegration.id,
        });
      }
    });
  });
};
