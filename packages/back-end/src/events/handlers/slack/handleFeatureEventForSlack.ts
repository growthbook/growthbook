import {
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
} from "../../base-events";
import uniq from "lodash/uniq";
import { getSlackIntegrationsForFilters } from "../../../models/SlackIntegrationModel";

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

// TODO: Update to include environment changed OR environment enabled
const getEnvironmentsForFeatureEvent = (
  featureEvent:
    | FeatureCreatedNotificationEvent
    | FeatureUpdatedNotificationEvent
    | FeatureDeletedNotificationEvent
): string[] => {
  switch (featureEvent.event) {
    case "feature.created":
    case "feature.updated":
      return (
        Object.keys(featureEvent.data.current.environmentSettings || {}) || []
      );

    case "feature.deleted":
      return (
        Object.keys(featureEvent.data.previous.environmentSettings || {}) || []
      );
  }
};
