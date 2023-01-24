import { KnownBlock } from "@slack/web-api";
import uniq from "lodash/uniq";
import isEqual from "lodash/isEqual";
import intersection from "lodash/intersection";
import { logger } from "../../../util/logger";
import { cancellableFetch } from "../../../util/http.util";
import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
  NotificationEvent,
} from "../../base-events";
import { SlackIntegrationInterface } from "../../../../types/slack-integration";
import { FeatureInterface } from "../../../../types/feature";
import { APP_ORIGIN } from "../../../util/secrets";

// region Filtering

/**
 * Gets all current and previous tags for the event
 * @param event
 */
export const getTagsForNotificationEvent = (
  event: NotificationEvent
): string[] => {
  switch (event.event) {
    case "feature.created":
      return event.data.current.tags || [];

    case "feature.updated":
      return uniq(
        (event.data.current.tags || []).concat(event.data.previous.tags || [])
      );

    case "feature.deleted":
      return event.data.previous.tags || [];
  }
};

/**
 * Gets current and previous projects
 * @param event
 */
export const getProjectsForNotificationEvent = (
  event: NotificationEvent
): string[] => {
  switch (event.event) {
    case "feature.created":
      return event.data.current.project ? [event.data.current.project] : [];

    case "feature.updated":
      return uniq(
        (event.data.current.project ? [event.data.current.project] : []).concat(
          event.data.previous.project ? [event.data.previous.project] : []
        )
      );

    case "feature.deleted":
      return event.data.previous.project ? [event.data.previous.project] : [];
  }
};

/**
 * In the case of some resources, e.g. features, we want to do our own filtering for environments.
 * We need to include all environments in that case.
 * @param event
 */
export const getEnvironmentsForNotificationEvent = (
  event: NotificationEvent
): string[] => {
  switch (event.event) {
    case "feature.created":
      return Object.keys(event.data.current.environmentSettings);

    case "feature.updated":
      return uniq(
        Object.keys(event.data.current.environmentSettings).concat(
          Object.keys(event.data.previous.environmentSettings)
        )
      );

    case "feature.deleted":
      return Object.keys(event.data.previous.environmentSettings);
  }
};

/**
 * Predicate for Array.filter.
 * Depending on the resource type, each event type may have different relevance.
 * For example, for features, all created and deleted events are relevant
 * but only some update events are.
 * We filter the integration out based on resource- and event-specific requirements.
 * @param slackIntegration
 * @param event
 * @return boolean should include
 */
export const filterSlackIntegrationForRelevance = (
  slackIntegration: SlackIntegrationInterface,
  event: NotificationEvent
): boolean => {
  switch (event.event) {
    case "feature.created":
    case "feature.deleted":
      return true;
    case "feature.updated":
      return filterFeatureUpdateEventForRelevance(slackIntegration, event);
  }
};

// region Filtering -> feature

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

// endregion Filtering -> feature

// endregion Filtering

// region Slack API

type BuildSlackMessageOptions = {
  event: NotificationEvent;
  slackIntegration: SlackIntegrationInterface;
  eventId: string;
};

/**
 * Given an event, will build the desired Slack message
 * @param options
 */
export const buildSlackMessageForEvent = (
  options: BuildSlackMessageOptions
): SlackMessage => {
  const slackMessage = buildBaseSlackMessageForEvent(options);

  // Add the GrowthBook Slack integration context to all messages
  slackMessage.blocks.push(
    getIntegrationContextBlock(options.slackIntegration)
  );

  return slackMessage;
};

/**
 * GrowthBook Slack context that should be appended to all messages
 * @param slackIntegration
 */
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

// region Event-specific messages

/**
 * Builds the event-specific Slack KnownBlocks
 * @param event
 * @param slackIntegration
 * @param eventId
 */
const buildBaseSlackMessageForEvent = ({
  event,
  slackIntegration,
  eventId,
}: BuildSlackMessageOptions): SlackMessage => {
  switch (event.event) {
    case "feature.created":
      return buildFeatureCreatedEvent(event, slackIntegration, eventId);

    case "feature.updated":
      return buildFeatureUpdatedEvent(event, slackIntegration, eventId);

    case "feature.deleted":
      return buildFeatureDeletedEvent(event, slackIntegration, eventId);
  }
};

// region Event-specific messages -> Feature

const getFeatureUrlFormatted = (featureId: string): string =>
  `\n• <${APP_ORIGIN}/features/${featureId}|View Feature>`;

const getEventUrlFormatted = (eventId: string): string =>
  `\n• <${APP_ORIGIN}/events/${eventId}|View Event>`;

const buildFeatureCreatedEvent = (
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
    ],
  };
};

const buildFeatureUpdatedEvent = (
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
    ],
  };
};

const buildFeatureDeletedEvent = (
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
    ],
  };
};

// endregion Event-specific messages -> Feature

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
