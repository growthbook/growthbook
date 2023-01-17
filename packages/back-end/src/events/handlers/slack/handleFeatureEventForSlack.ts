import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../../base-events";
import uniq from "lodash/uniq";
import { getSlackIntegrationsForFilters } from "../../../models/SlackIntegrationModel";
import { FeatureEnvironment } from "../../../../types/feature";

export const handleFeatureEventForSlack = async (
  organizationId: string,
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent
) => {
  // Get related feature.
  // console.log("🔵 handleFeatureEvent", featureEvent);

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
  console.log("🔵 handleFeatureEvent -> slackIntegrations", slackIntegrations);
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
