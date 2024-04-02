import uniq from "lodash/uniq";
import isEqual from "lodash/isEqual";
import intersection from "lodash/intersection";
import {
  FeatureUpdatedNotificationEvent,
  NotificationEvent,
} from "../notification-events";
import { ApiFeature } from "../../../types/openapi";

export type FilterDataForNotificationEvent = {
  tags: string[];
  projects: string[];
};

export const getFilterDataForNotificationEvent = (
  event: NotificationEvent
): FilterDataForNotificationEvent | null => {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return null;

    case "feature.created":
      return {
        tags: event.data.current.tags || [],
        projects: event.data.current.project
          ? [event.data.current.project]
          : [],
      };

    case "feature.updated":
      return {
        tags: uniq(
          (event.data.current.tags || []).concat(event.data.previous.tags || [])
        ),
        projects: uniq(
          (event.data.current.project
            ? [event.data.current.project]
            : []
          ).concat(
            event.data.previous.project ? [event.data.previous.project] : []
          )
        ),
      };

    case "feature.deleted":
      return {
        tags: event.data.previous.tags || [],
        projects: event.data.previous.project
          ? [event.data.previous.project]
          : [],
      };

    case "experiment.created":
      return {
        tags: event.data.current.tags || [],
        projects: event.data.current.project
          ? [event.data.current.project]
          : [],
      };

    case "experiment.updated":
      return {
        tags: uniq(
          (event.data.current.tags || []).concat(event.data.previous.tags || [])
        ),
        projects: uniq(
          (event.data.current.project
            ? [event.data.current.project]
            : []
          ).concat(
            event.data.previous.project ? [event.data.previous.project] : []
          )
        ),
      };

    case "experiment.deleted":
      return {
        tags: event.data.previous.tags || [],
        projects: event.data.previous.project
          ? [event.data.previous.project]
          : [],
      };

    case "webhook.test":
      return { tags: [], projects: [] };

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
};

// Will only notify for environments in which rules were modified.
// Other feature events (currently) apply to all environments
export const filterEventForEnvironments = ({
  event,
  environments,
}: {
  event: NotificationEvent;
  environments: string[];
}): boolean => {
  let invalidEvent: never;

  switch (event.event) {
    case "user.login":
      return false;

    case "experiment.created":
    case "experiment.updated":
    case "experiment.deleted":
      return true;

    case "feature.created":
    case "feature.deleted":
      return true;

    case "feature.updated":
      return filterFeatureUpdatedNotificationEventForEnvironments({
        featureEvent: event,
        environments,
      });

    case "webhook.test":
      return true;

    default:
      invalidEvent = event;
      throw `Invalid event: ${invalidEvent}`;
  }
};

// Some of the feature keys that change affect all enabled environments
export const RELEVANT_KEYS_FOR_ALL_ENVS: (keyof ApiFeature)[] = [
  "archived",
  "defaultValue",
  "prerequisites",
  "project",
  "valueType",
];

export const filterFeatureUpdatedNotificationEventForEnvironments = ({
  featureEvent,
  environments,
}: {
  featureEvent: FeatureUpdatedNotificationEvent;
  environments: string[];
}): boolean => {
  const { previous, current } = featureEvent.data;
  if (previous.archived === true && current.archived === true) {
    // Do not notify for archived features
    return false;
  }

  // if the environments are not specified, notify for all environments
  if (environments.length === 0) {
    return true;
  }

  if (
    RELEVANT_KEYS_FOR_ALL_ENVS.some((k) => !isEqual(previous[k], current[k]))
  ) {
    // Some of the relevant keys for all environments has changed.
    return true;
  }

  // Manual environment filtering

  const allEnvs = new Set([
    ...Object.keys(previous.environments),
    ...Object.keys(current.environments),
  ]);

  const changedEnvironments = new Set<string>();

  // Add in environments if their specific settings changed
  allEnvs.forEach((env) => {
    const previousEnvSettings = previous.environments[env];
    const currentEnvSettings = current.environments[env];

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

  return intersection(Array.from(changedEnvironments), environments).length > 0;
};
