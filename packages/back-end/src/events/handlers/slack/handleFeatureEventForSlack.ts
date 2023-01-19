import uniq from "lodash/uniq";
import isEqual from "lodash/isEqual";
import intersection from "lodash/intersection";
import { KnownBlock } from "@slack/web-api";
import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../../base-events";
import { getSlackIntegrationsForFilters } from "../../../models/SlackIntegrationModel";
import { FeatureInterface } from "../../../../types/feature";
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
  const projects = getProjectsForFeatureEvent(featureEvent);

  // Environment filtering will be handled outside of the Mongo query
  const allEnvironments = getAllEnvironmentsForFeatureEvent(featureEvent);

  const slackIntegrations = (
    await getSlackIntegrationsForFilters({
      organizationId,
      eventName: featureEvent.event,
      tags,
      environments: allEnvironments,
      projects,
    })
  )?.filter((int) => filterForRelevance(int, featureEvent));

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
 * All created and deleted events are relevant but only some update events are.
 * @param slackIntegration
 * @param featureEvent
 * @return boolean should include
 */
const filterForRelevance = (
  slackIntegration: SlackIntegrationInterface,
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent
): boolean => {
  switch (featureEvent.event) {
    case "feature.created":
    case "feature.deleted":
      return true;
    case "feature.updated":
      return filterFeatureUpdateEventForRelevance(
        slackIntegration,
        featureEvent
      );
  }
};

/**
 * Filters the update event, considering environments and relevant keys that impact all environments.
 * @param slackIntegration
 * @param featureEvent
 * @return boolean should include
 */
const filterFeatureUpdateEventForRelevance = (
  slackIntegration: SlackIntegrationInterface,
  featureEvent: FeatureUpdatedNotificationEvent
): boolean => {
  const { previous, current } = featureEvent.data;

  if (previous.archived && current.archived) {
    // Do not notify for archived features
    return false;
  }

  // Manual environment filtering
  const changedEnvironments = new Set<string>();

  // Some of the feature keys that change affect all enabled environments
  const relevantKeysForAllEnvs: (keyof FeatureInterface)[] = [
    "archived",
    "defaultValue",
    "project",
    "valueType",
    "nextScheduledUpdate",
  ];
  if (relevantKeysForAllEnvs.some((k) => !isEqual(previous[k], current[k]))) {
    // Some of the relevant keys for all environments has changed.
    return true;
  }

  const allEnvs = new Set([
    ...Object.keys(previous.environmentSettings),
    ...Object.keys(current.environmentSettings),
  ]);

  // Add in environments if their specific settings changed
  allEnvs.forEach((env) => {
    const previousEnvSettings = previous.environmentSettings[env];
    const currentEnvSettings = current.environmentSettings[env];

    // If the environment is disabled both before and after the change, ignore changes
    if (!previousEnvSettings?.enabled && !currentEnvSettings?.enabled) {
      return;
    }

    // the environment has changed
    if (!isEqual(previousEnvSettings, currentEnvSettings)) {
      changedEnvironments.add(env);
    }
  });

  const environmentChangesAreRelevant = changedEnvironments.size > 0;
  if (!environmentChangesAreRelevant) {
    return false;
  }

  return (
    slackIntegration.environments.length === 0 ||
    intersection(Array.from(changedEnvironments), slackIntegration.environments)
      .length > 0
  );
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

const getAllEnvironmentsForFeatureEvent = (
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent
): string[] => {
  switch (featureEvent.event) {
    case "feature.created":
      return Object.keys(featureEvent.data.current.environmentSettings);

    case "feature.updated":
      return Object.keys(featureEvent.data.current.environmentSettings).concat(
        Object.keys(featureEvent.data.previous.environmentSettings)
      );

    case "feature.deleted":
      return Object.keys(featureEvent.data.previous.environmentSettings);
  }
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
