import { KnownBlock } from "@slack/web-api";
import { logger } from "../../../util/logger";
import { cancellableFetch } from "../../../util/http.util";
import {
  ExperimentCreatedNotificationEvent,
  ExperimentDeletedNotificationEvent,
  ExperimentUpdatedNotificationEvent,
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
  NotificationEvent,
} from "../../notification-events";
import { SlackIntegrationInterface } from "../../../../types/slack-integration";
import { APP_ORIGIN } from "../../../util/secrets";
import {
  FilterDataForNotificationEvent,
  getFilterDataForNotificationEvent,
} from "../utils";

// region Filtering

type DataForNotificationEvent = {
  filterData: FilterDataForNotificationEvent;
  slackMessage: SlackMessage;
};

export const getDataForNotificationEvent = (
  event: NotificationEvent,
  eventId: string
): DataForNotificationEvent | null => {
  const filterData = getFilterDataForNotificationEvent(event);
  if (!filterData) return null;

  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return null;

    case "feature.created":
      return {
        filterData,
        slackMessage: buildSlackMessageForFeatureCreatedEvent(event, eventId),
      };

    case "feature.updated":
      return {
        filterData,
        slackMessage: buildSlackMessageForFeatureUpdatedEvent(event, eventId),
      };

    case "feature.deleted":
      return {
        filterData,
        slackMessage: buildSlackMessageForFeatureDeletedEvent(event, eventId),
      };

    case "experiment.created":
      return {
        filterData,
        slackMessage: buildSlackMessageForExperimentCreatedEvent(
          event,
          eventId
        ),
      };

    case "experiment.updated":
      return {
        filterData,
        slackMessage: buildSlackMessageForExperimentUpdatedEvent(
          event,
          eventId
        ),
      };

    case "experiment.deleted":
      return {
        filterData,
        slackMessage: buildSlackMessageForExperimentDeletedEvent(
          event,
          eventId
        ),
      };

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
};

// endregion Filtering -> feature

// endregion Filtering

// region Slack API

/**
 * GrowthBook Slack context that should be appended to all messages
 * @param slackIntegration
 */
export const getSlackIntegrationContextBlock = (
  slackIntegration: SlackIntegrationInterface
): KnownBlock => {
  return {
    type: "context",
    elements: [
      {
        type: "image",
        image_url:
          "https://github.com/growthbook/growthbook/blob/main/packages/front-end/public/logo/Logo-mark.png?raw=true",
        alt_text: "GrowthBook logo",
      },
      {
        type: "plain_text",
        text: `This was sent from your Slack integration: ${slackIntegration.name}`,
      },
    ],
  };
};

// region Event-specific messages

// region Event-specific messages -> Feature

const getFeatureUrlFormatted = (featureId: string): string =>
  `\n• <${APP_ORIGIN}/features/${featureId}|View Feature>`;

const getEventUrlFormatted = (eventId: string): string =>
  `\n• <${APP_ORIGIN}/events/${eventId}|View Event>`;

const buildSlackMessageForFeatureCreatedEvent = (
  featureEvent: FeatureCreatedNotificationEvent,
  eventId: string
): SlackMessage => {
  const featureId = featureEvent.data.current.id;

  const text = `The feature ${featureId} has been created`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been created.` +
            getFeatureUrlFormatted(featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForFeatureUpdatedEvent = (
  featureEvent: FeatureUpdatedNotificationEvent,
  eventId: string
): SlackMessage => {
  const featureId = featureEvent.data.current.id;

  const text = `The feature ${featureId} has been updated`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been updated.` +
            getFeatureUrlFormatted(featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForFeatureDeletedEvent = (
  featureEvent: FeatureDeletedNotificationEvent,
  eventId: string
): SlackMessage => {
  const featureId = featureEvent.data.previous.id;
  const text = `The feature ${featureId} has been deleted.`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been deleted.` +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

// endregion Event-specific messages -> Feature

// region Event-specific messages -> Experiment

const getExperimentUrlFormatted = (experimentId: string): string =>
  `\n• <${APP_ORIGIN}/experiment/${experimentId}|View Experiment>`;

const buildSlackMessageForExperimentCreatedEvent = (
  experimentEvent: ExperimentCreatedNotificationEvent,
  eventId: string
): SlackMessage => {
  const experimentId = experimentEvent.data.current.id;
  const experimentName = experimentEvent.data.current.name;
  const text = `The experiment ${experimentName} has been created`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The experiment *${experimentName}* has been created.` +
            getExperimentUrlFormatted(experimentId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentUpdatedEvent = (
  experimentEvent: ExperimentUpdatedNotificationEvent,
  eventId: string
): SlackMessage => {
  const experimentId = experimentEvent.data.previous.id;
  const experimentName = experimentEvent.data.previous.name;
  const text = `The experiment ${experimentName} has been updated`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The experiment *${experimentName}* has been updated.` +
            getExperimentUrlFormatted(experimentId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentDeletedEvent = (
  experimentEvent: ExperimentDeletedNotificationEvent,
  eventId: string
): SlackMessage => {
  const experimentName = experimentEvent.data.previous.name;
  const text = `The experiment ${experimentName} has been deleted`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The experiment *${experimentName}* has been deleted.` +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

// endregion Event-specific messages -> Experiment

// endregion Event-specific messages

export type SlackMessage = {
  text: string;
  blocks: KnownBlock[];
};

/**
 * Sends a Slack message.
 * @param slackMessage
 * @param webHookEndpoint
 * @throws Error If the request fails
 */
export const sendSlackMessage = async (
  slackMessage: SlackMessage,
  webHookEndpoint: string
): Promise<boolean> => {
  try {
    const { stringBody, responseWithoutBody } = await cancellableFetch(
      webHookEndpoint,
      {
        method: "POST",
        body: JSON.stringify(slackMessage),
      },
      {
        maxTimeMs: 15000,
        maxContentSize: 500,
      }
    );

    if (!responseWithoutBody.ok) {
      logger.error("Failed to send Slack integration message", {
        text: stringBody,
      });
    }

    return responseWithoutBody.ok;
  } catch (e) {
    logger.error(e);
    return false;
  }
};

// endregion Slack API
