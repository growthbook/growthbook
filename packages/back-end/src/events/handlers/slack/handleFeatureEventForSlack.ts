import uniq from "lodash/uniq";
import { KnownBlock } from "@slack/web-api";
import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../../base-events";
import { getSlackIntegrationsForFilters } from "../../../models/SlackIntegrationModel";
import { FeatureEnvironment } from "../../../../types/feature";
import { sendSlackMessage, SlackMessage } from "./slack-event-handler-utils";
import { SlackIntegrationInterface } from "../../../../types/slack-integration";
import { logger } from "../../../util/logger";

export const handleFeatureEventForSlack = async (
  organizationId: string,
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent
) => {
  // Get related feature.
  // console.log("🔵 handleFeatureEvent", featureEvent);

  // Build filtering query and get relevant SlackIntegration records
  const tags = getTagsForFeatureEvent(featureEvent);
  const environments = getEnvironmentsForFeatureEvent(featureEvent);
  const projects = getProjectsForFeatureEvent(featureEvent);

  const slackIntegrations = await getSlackIntegrationsForFilters({
    organizationId,
    eventName: featureEvent.event,
    tags,
    environments,
    projects,
  });

  // console.log("🔵 handleFeatureEvent -> query", {
  //   tags,
  //   environments,
  //   projects,
  // });
  // console.log("🔵 handleFeatureEvent -> slackMessage", slackMessage);
  // console.log("🔵 handleFeatureEvent -> slackIntegrations", slackIntegrations);

  slackIntegrations?.forEach((slackIntegration) => {
    // Build the Slack message for the given event
    const slackMessage = buildSlackMessageForEvent(
      featureEvent,
      slackIntegration
    );

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

/**
 * Gets current and previous projects
 * @param featureEvent
 */
const getProjectsForFeatureEvent = (
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent
): string[] => {
  switch (featureEvent.event) {
    case "feature.created":
      return featureEvent.data.current.project
        ? [featureEvent.data.current.project]
        : [];

    case "feature.updated":
      return uniq(
        (featureEvent.data.current.project
          ? [featureEvent.data.current.project]
          : []
        ).concat(
          featureEvent.data.previous.project
            ? [featureEvent.data.previous.project]
            : []
        )
      );

    case "feature.deleted":
      return featureEvent.data.previous.project
        ? [featureEvent.data.previous.project]
        : [];
  }
};

/**
 * Gets all current and previous tags for the event
 * @param featureEvent
 */
const getTagsForFeatureEvent = (
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent
): string[] => {
  switch (featureEvent.event) {
    case "feature.created":
      return featureEvent.data.current.tags || [];

    case "feature.updated":
      return uniq(
        (featureEvent.data.current.tags || []).concat(
          featureEvent.data.previous.tags || []
        )
      );

    case "feature.deleted":
      return featureEvent.data.previous.tags || [];
  }
};

/**
 * The relevant environments are any environments that are either currently enabled
 * or were previously enabled
 * @param featureEvent
 */
const getEnvironmentsForFeatureEvent = (
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent
): string[] => {
  return getEnabledEnvironmentsForEvent(featureEvent);
};

/**
 * Returns a list of the environments that are enabled for the event.
 * For events with multiple states (e.g. "feature.updated"), it will include environments
 * that are enabled in any of the available states (e.g. both `previous` and `current`)
 * @param featureEvent
 */
const getEnabledEnvironmentsForEvent = (
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent
): string[] => {
  switch (featureEvent.event) {
    case "feature.created":
      return getEnabledEnvironmentsForEnvironmentSettings(
        featureEvent.data.current.environmentSettings
      );

    case "feature.updated":
      return uniq(
        getEnabledEnvironmentsForEnvironmentSettings(
          featureEvent.data.previous.environmentSettings
        ).concat(
          getEnabledEnvironmentsForEnvironmentSettings(
            featureEvent.data.current.environmentSettings
          )
        )
      );

    case "feature.deleted":
      return getEnabledEnvironmentsForEnvironmentSettings(
        featureEvent.data.previous.environmentSettings
      );
  }
};

const getEnabledEnvironmentsForEnvironmentSettings = (
  environmentSettings: Record<string, FeatureEnvironment>
): string[] => {
  if (!environmentSettings) {
    return [];
  }

  return Object.keys(environmentSettings).filter(
    (env) => environmentSettings[env]?.enabled
  );
};

/**
 * Given an event, will build the desired Slack message
 * @param featureEvent
 * @param slackIntegration
 */
const buildSlackMessageForEvent = (
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent,
  slackIntegration: SlackIntegrationInterface
): SlackMessage => {
  switch (featureEvent.event) {
    case "feature.created":
      return buildCreatedEvent(featureEvent, slackIntegration);

    case "feature.updated":
      return buildUpdatedEvent(featureEvent, slackIntegration);

    case "feature.deleted":
      return buildDeletedEvent(featureEvent, slackIntegration);
  }
};

const getIntegrationContextBlock = (
  slackIntegration: SlackIntegrationInterface
): KnownBlock => {
  return {
    type: "context",
    elements: [
      {
        type: "plain_text",
        text: `This was sent from your Slack integration: ${slackIntegration.name}`,
      },
    ],
  };
};

const buildCreatedEvent = (
  featureEvent: FeatureCreatedNotificationEvent,
  slackIntegration: SlackIntegrationInterface
): SlackMessage => {
  const text = `The feature ${featureEvent.event} has been created in GrowthBook`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `The feature *${featureEvent.event}* has been created in GrowthBook`,
        },
      },
      getIntegrationContextBlock(slackIntegration),
    ],
  };
};

const buildUpdatedEvent = (
  featureEvent: FeatureUpdatedNotificationEvent,
  slackIntegration: SlackIntegrationInterface
): SlackMessage => {
  return {
    text: "todo: feature.updated",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*todo*: feature.updated",
        },
      },
      getIntegrationContextBlock(slackIntegration),
    ],
  };
};

const buildDeletedEvent = (
  featureEvent: FeatureDeletedNotificationEvent,
  slackIntegration: SlackIntegrationInterface
): SlackMessage => {
  return {
    text: "todo: feature.deleted",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*todo*: feature.deleted",
        },
      },
      getIntegrationContextBlock(slackIntegration),
    ],
  };
};
