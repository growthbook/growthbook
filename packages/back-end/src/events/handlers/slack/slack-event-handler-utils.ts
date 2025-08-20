import { KnownBlock } from "@slack/types";
import formatNumber from "number-format.js";
import { logger } from "back-end/src/util/logger";
import { cancellableFetch } from "back-end/src/util/http.util";
import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "back-end/src/events/notification-events";
import { EventInterface } from "back-end/types/event";
import { getEvent } from "back-end/src/models/EventModel";
import { SlackIntegrationInterface } from "back-end/types/slack-integration";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import {
  FilterDataForNotificationEvent,
  getFilterDataForNotificationEvent,
} from "back-end/src/events/handlers/utils";
import { ExperimentWarningNotificationPayload } from "back-end/src/validators/experiment-warnings";
import { ExperimentInfoSignificancePayload } from "back-end/src/validators/experiment-info";
import { ExperimentDecisionNotificationPayload } from "back-end/src/validators/experiment-decision";
import {
  SafeRolloutDecisionNotificationPayload,
  SafeRolloutUnhealthyNotificationPayload,
} from "back-end/src/validators/safe-rollout-notifications";

// region Filtering

export type DataForNotificationEvent = {
  filterData: FilterDataForNotificationEvent;
  slackMessage: SlackMessage;
};

export const getSlackMessageForNotificationEvent = async (
  event: NotificationEvent,
  eventId: string,
): Promise<SlackMessage | null> => {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return null;

    case "feature.created":
      return buildSlackMessageForFeatureCreatedEvent(
        event.data.object.id,
        eventId,
      );

    case "feature.updated":
      return buildSlackMessageForFeatureUpdatedEvent(
        event.data.object.id,
        eventId,
      );

    case "feature.deleted":
      return buildSlackMessageForFeatureDeletedEvent(
        event.data.object.id,
        eventId,
      );

    case "feature.saferollout.ship":
      return buildSlackMessageForSafeRolloutShipEvent(
        event.data.object,
        eventId,
      );

    case "feature.saferollout.rollback":
      return buildSlackMessageForSafeRolloutRollbackEvent(
        event.data.object,
        eventId,
      );

    case "feature.saferollout.unhealthy":
      return buildSlackMessageForSafeRolloutUnhealthyEvent(
        event.data.object,
        eventId,
      );

    case "experiment.created":
      return buildSlackMessageForExperimentCreatedEvent(
        event.data.object,
        eventId,
      );

    case "experiment.updated":
      return buildSlackMessageForExperimentUpdatedEvent(
        event.data.object,
        eventId,
      );

    case "experiment.warning":
      return buildSlackMessageForExperimentWarningEvent(event.data.object);

    case "experiment.info.significance":
      return buildSlackMessageForExperimentInfoSignificanceEvent(
        event.data.object,
      );

    case "experiment.deleted":
      return buildSlackMessageForExperimentDeletedEvent(
        event.data.object.name,
        eventId,
      );

    case "experiment.decision.ship":
      return buildSlackMessageForExperimentShipEvent(event.data.object);

    case "experiment.decision.rollback":
      return buildSlackMessageForExperimentRollbackEvent(event.data.object);

    case "experiment.decision.review":
      return buildSlackMessageForExperimentReviewEvent(event.data.object);

    case "webhook.test":
      return buildSlackMessageForWebhookTestEvent(event.data.object.webhookId);

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
};

export const getSlackMessageForLegacyNotificationEvent = async (
  event: LegacyNotificationEvent,
  eventId: string,
): Promise<SlackMessage | null> => {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return null;

    case "feature.created":
      return buildSlackMessageForFeatureCreatedEvent(
        event.data.current.id,
        eventId,
      );

    case "feature.updated":
      return buildSlackMessageForFeatureUpdatedEvent(
        event.data.current.id,
        eventId,
      );

    case "feature.deleted":
      return buildSlackMessageForFeatureDeletedEvent(
        event.data.previous.id,
        eventId,
      );

    case "experiment.created":
      return buildSlackMessageForExperimentCreatedEvent(
        event.data.current,
        eventId,
      );

    case "experiment.updated":
      return buildSlackMessageForExperimentUpdatedEvent(
        event.data.current,
        eventId,
      );

    case "experiment.warning":
      return buildSlackMessageForExperimentWarningEvent(event.data);

    case "experiment.deleted":
      return buildSlackMessageForExperimentDeletedEvent(
        event.data.previous.name,
        eventId,
      );

    case "webhook.test":
      return buildSlackMessageForWebhookTestEvent(event.data.webhookId);

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
};

export const getSlackDataForNotificationEvent = async (
  event: EventInterface,
): Promise<DataForNotificationEvent | null> => {
  if (event.event === "webhook.test") return null;

  const filterData = getFilterDataForNotificationEvent(event.data);
  if (!filterData) return null;

  const slackMessage = await (event.version
    ? getSlackMessageForNotificationEvent(event.data, event.id)
    : getSlackMessageForLegacyNotificationEvent(event.data, event.id));

  if (!slackMessage) return null;

  return { filterData, slackMessage };
};

// endregion Filtering -> feature

// endregion Filtering

// region Slack API

/**
 * GrowthBook Slack context that should be appended to all messages
 * @param slackIntegration
 */
export const getSlackIntegrationContextBlock = (
  slackIntegration: SlackIntegrationInterface,
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

export const getFeatureUrlFormatted = (featureId: string): string =>
  `\n• <${APP_ORIGIN}/features/${featureId}|View Feature>`;

export const getEventUrlFormatted = (eventId: string): string =>
  `\n• <${APP_ORIGIN}/events/${eventId}|View Event>`;

export const getEventUserFormatted = async (eventId: string) => {
  const event = await getEvent(eventId);

  if (!event || !event.data?.user) return "an unknown user";

  if (event.data.user.type === "api_key")
    return `an API request with key ending in ...${event.data.user.apiKey.slice(
      -4,
    )}`;
  return `${event.data.user.name} (${event.data.user.email})`;
};

const buildSlackMessageForFeatureCreatedEvent = async (
  featureId: string,
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);

  const text = `The feature ${featureId} has been created by ${eventUser}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been created by ${eventUser}.` +
            getFeatureUrlFormatted(featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForFeatureUpdatedEvent = async (
  featureId: string,
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);

  const text = `The feature ${featureId} has been updated by ${eventUser}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been updated ${eventUser}.` +
            getFeatureUrlFormatted(featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForFeatureDeletedEvent = async (
  featureId: string,
  eventId: string,
): Promise<SlackMessage> => {
  const eventUser = await getEventUserFormatted(eventId);
  const text = `The feature ${featureId} has been deleted by ${eventUser}.`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `The feature *${featureId}* has been deleted by ${eventUser}.` +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForSafeRolloutShipEvent = (
  data: SafeRolloutDecisionNotificationPayload,
  eventId: string,
): SlackMessage => {
  const text = `A Safe Rollout on feature ${data.featureId} in environment ${data.environment} is ready to ship to 100% of traffic.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getFeatureUrlFormatted(data.featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForSafeRolloutRollbackEvent = (
  data: SafeRolloutDecisionNotificationPayload,
  eventId: string,
): SlackMessage => {
  const text = `A Safe Rollout on feature ${data.featureId} in environment ${data.environment} has a failing guardrail and should be rolled back.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getFeatureUrlFormatted(data.featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

const buildSlackMessageForSafeRolloutUnhealthyEvent = (
  data: SafeRolloutUnhealthyNotificationPayload,
  eventId: string,
): SlackMessage => {
  const text = `A Safe Rollout on feature ${data.featureId} in environment ${data.environment} is failing a health check and may not be working as expected.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text +
            getFeatureUrlFormatted(data.featureId) +
            getEventUrlFormatted(eventId),
        },
      },
    ],
  };
};

// endregion Event-specific messages -> Feature

// region Event-specific messages -> Experiment

export const getExperimentUrlFormatted = (experimentId: string): string =>
  `\n• <${APP_ORIGIN}/experiment/${experimentId}|View Experiment>`;

export const getExperimentUrlAndNameFormatted = (
  experimentId: string,
  experimentName: string,
): string => `<${APP_ORIGIN}/experiment/${experimentId}|${experimentName}>`;

const buildSlackMessageForExperimentCreatedEvent = (
  { id: experimentId, name: experimentName }: { id: string; name: string },
  eventId: string,
): SlackMessage => {
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
  { id: experimentId, name: experimentName }: { id: string; name: string },
  eventId: string,
): SlackMessage => {
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

const buildSlackMessageForWebhookTestEvent = (
  webhookId: string,
): SlackMessage => ({
  text: `This is a test event for webhook ${webhookId}`,
  blocks: [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `This is a *test event* for ${webhookId}`,
      },
    },
  ],
});

const buildSlackMessageForExperimentDeletedEvent = (
  experimentName: string,
  eventId: string,
): SlackMessage => {
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

const buildSlackMessageForExperimentInfoSignificanceEvent = ({
  metricName,
  experimentName,
  experimentId,
  variationName,
  statsEngine,
  criticalValue,
  winning,
}: ExperimentInfoSignificancePayload): SlackMessage => {
  const percentFormatter = (v: number) => {
    if (v > 0.99) {
      return ">99%";
    }
    if (v < 0.01) {
      return "<1%";
    }
    return formatNumber("#0.%", v * 100);
  };

  const text = ({
    metricName,
    variationName,
    experimentName,
  }: {
    metricName: string;
    variationName: string;
    experimentName: string;
  }) => {
    if (statsEngine === "frequentist") {
      return `In experiment ${experimentName}: metric ${metricName} for variation ${variationName} is ${
        winning ? "beating" : "losing to"
      } the baseline and has reached statistical significance (p-value = ${criticalValue.toFixed(
        3,
      )}).`;
    }
    return `In experiment ${experimentName}: metric ${metricName} for variation ${variationName} has ${
      winning ? "reached a" : "dropped to a"
    } ${percentFormatter(criticalValue)} chance to beat the baseline.`;
  };

  return {
    text: text({ metricName, experimentName, variationName }),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: text({
            metricName: `*${metricName}*`,
            experimentName: getExperimentUrlAndNameFormatted(
              experimentId,
              experimentName,
            ),
            variationName: `*${variationName}*`,
          }),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentWarningEvent = (
  data: ExperimentWarningNotificationPayload,
): SlackMessage => {
  let invalidData: never;

  switch (data.type) {
    case "auto-update": {
      const makeText = (name: string) =>
        `Automatic snapshot creation for ${name} ${
          data.success ? "succeeded" : "failed"
        }!`;

      return {
        text: makeText(data.experimentName),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                makeText(`*${data.experimentName}*`) +
                getExperimentUrlFormatted(data.experimentId),
            },
          },
        ],
      };
    }

    case "multiple-exposures": {
      const numberFormatter = (v: number) => formatNumber("#,##0.", v);
      const percentFormatter = (v: number) => formatNumber("#0.%", v * 100);

      const text = (experimentName: string) =>
        `Multiple Exposures Warning for experiment ${experimentName}: ${numberFormatter(
          data.usersCount,
        )} users (${percentFormatter(
          data.percent,
        )}) saw multiple variations and were automatically removed from results.`;

      return {
        text: text(data.experimentName),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                text(`*${data.experimentName}*`) +
                getExperimentUrlFormatted(data.experimentId),
            },
          },
        ],
      };
    }

    case "srm": {
      const text = (experimentName: string) =>
        `Traffic imbalance detected for experiment detected for experiment ${experimentName} : Sample Ratio Mismatch (SRM) p-value below ${data.threshold}.`;

      return {
        text: text(data.experimentName),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                text(`*${data.experimentName}*`) +
                getExperimentUrlFormatted(data.experimentId),
            },
          },
        ],
      };
    }

    default:
      invalidData = data;
      throw `Invalid data: ${invalidData}`;
  }
};

const buildSlackMessageForExperimentShipEvent = (
  data: ExperimentDecisionNotificationPayload,
): SlackMessage => {
  const text = (experimentName: string, description?: string) =>
    `Experiment ${experimentName} has reached the "Ship now" status.${
      description ? ` ${description}` : null
    }`;
  return {
    text: text(data.experimentName, data.decisionDescription),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text(`*${data.experimentName}*`, data.decisionDescription) +
            getExperimentUrlFormatted(data.experimentId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentRollbackEvent = (
  data: ExperimentDecisionNotificationPayload,
): SlackMessage => {
  const text = (experimentName: string, description?: string) =>
    `Experiment ${experimentName} has reached the "Roll back now" status.${
      description ? ` ${description}` : null
    }`;
  return {
    text: text(data.experimentName, data.decisionDescription),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text(`*${data.experimentName}*`, data.decisionDescription) +
            getExperimentUrlFormatted(data.experimentId),
        },
      },
    ],
  };
};

const buildSlackMessageForExperimentReviewEvent = (
  data: ExperimentDecisionNotificationPayload,
): SlackMessage => {
  const text = (experimentName: string, description?: string) =>
    `Experiment ${experimentName} has reached the "Ready for review" status.${
      description ? ` ${description}` : null
    }`;
  return {
    text: text(data.experimentName, data.decisionDescription),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            text(`*${data.experimentName}*`, data.decisionDescription) +
            getExperimentUrlFormatted(data.experimentId),
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
  webHookEndpoint: string,
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
      },
    );

    if (!responseWithoutBody.ok) {
      logger.error(
        {
          text: stringBody,
        },
        "Failed to send Slack integration message",
      );
    }

    return responseWithoutBody.ok;
  } catch (e) {
    logger.error(e);
    return false;
  }
};

// endregion Slack API
