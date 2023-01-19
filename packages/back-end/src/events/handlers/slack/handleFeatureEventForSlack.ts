import uniq from "lodash/uniq";
import { KnownBlock } from "@slack/web-api";
import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../../base-events";
import { getSlackIntegrationsForFilters } from "../../../models/SlackIntegrationModel";
import { FeatureEnvironment } from "../../../../types/feature";
import { SlackIntegrationInterface } from "../../../../types/slack-integration";
import { logger } from "../../../util/logger";
import { APP_ORIGIN } from "../../../util/secrets";
import { sendSlackMessage, SlackMessage } from "./slack-event-handler-utils";

type HandleFeatureEventOptions = {
  organizationId: string;
  eventId: string;
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent;
};
export const handleFeatureEventForSlack = async ({
  organizationId,
  eventId,
  featureEvent,
}: HandleFeatureEventOptions) => {
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

  slackIntegrations?.forEach((slackIntegration) => {
    // Build the Slack message for the given event
    const slackMessage = buildSlackMessageForEvent({
      eventId,
      slackIntegration,
      featureEvent,
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

type BuildSlackMessageOptions = {
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent;
  slackIntegration: SlackIntegrationInterface;
  eventId: string;
};
/**
 * Given an event, will build the desired Slack message
 * @param featureEvent
 * @param slackIntegration
 * @param eventId
 */
const buildSlackMessageForEvent = ({
  featureEvent,
  slackIntegration,
  eventId,
}: BuildSlackMessageOptions): SlackMessage => {
  switch (featureEvent.event) {
    case "feature.created":
      return buildCreatedEvent(featureEvent, slackIntegration, eventId);

    case "feature.updated":
      return buildUpdatedEvent(featureEvent, slackIntegration, eventId);

    case "feature.deleted":
      return buildDeletedEvent(featureEvent, slackIntegration, eventId);
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

const getFeatureUrlFormatted = (featureId: string): string =>
  `\n• <${APP_ORIGIN}/features/${featureId}|View Feature>`;

const getEventUrlFormatted = (eventId: string): string =>
  `\n• <${APP_ORIGIN}/events/${eventId}|View Event>`;

const buildCreatedEvent = (
  featureEvent: FeatureCreatedNotificationEvent,
  slackIntegration: SlackIntegrationInterface,
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
      getIntegrationContextBlock(slackIntegration),
    ],
  };
};

const buildUpdatedEvent = (
  featureEvent: FeatureUpdatedNotificationEvent,
  slackIntegration: SlackIntegrationInterface,
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
      getIntegrationContextBlock(slackIntegration),
    ],
  };
};

const buildDeletedEvent = (
  featureEvent: FeatureDeletedNotificationEvent,
  slackIntegration: SlackIntegrationInterface,
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
      getIntegrationContextBlock(slackIntegration),
    ],
  };
};
