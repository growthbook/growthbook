import isEqual from "lodash/isEqual";
import intersection from "lodash/intersection";
import {
  NotificationEvent,
  LegacyNotificationEvent,
} from "shared/types/events/notification-events";
import { ApiFeature } from "shared/types/openapi";

export type FilterDataForNotificationEvent = {
  tags: string[];
  projects: string[];
};

export const getFilterDataForNotificationEvent = (
  event: NotificationEvent | LegacyNotificationEvent,
): FilterDataForNotificationEvent | null => {
  return {
    tags: event.tags || [],
    projects: event.projects || [],
  };
};

// Will only notify for environments in which rules were modified.
// Other feature events (currently) apply to all environments
export const filterEventForEnvironments = ({
  event,
  environments,
}: {
  event: NotificationEvent | LegacyNotificationEvent;
  environments: string[];
}): boolean => {
  // if the environments are not specified, notify for all environments
  if (environments.length === 0) {
    return true;
  }

  return intersection(event.environments || [], environments).length > 0;
};

// Some of the feature keys that change affect all enabled environments
export const RELEVANT_KEYS_FOR_ALL_ENVS: (keyof ApiFeature)[] = [
  "archived",
  "defaultValue",
  "prerequisites",
  "project",
  "valueType",
];

export function getChangedApiFeatureEnvironments(
  previous: ApiFeature,
  current: ApiFeature,
): string[] {
  const allEnvs = Array.from(
    new Set([
      ...Object.keys(previous.environments),
      ...Object.keys(current.environments),
    ]),
  );

  if (
    RELEVANT_KEYS_FOR_ALL_ENVS.some((k) => !isEqual(previous[k], current[k]))
  ) {
    // Some of the relevant keys for all environments has changed.
    return allEnvs;
  }

  // Manual environment filtering
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

  return Array.from(changedEnvironments);
}
