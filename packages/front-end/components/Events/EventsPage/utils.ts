import {
  EventInterface,
  ExperimentCreatedNotificationEvent,
  ExperimentDeletedNotificationEvent,
  ExperimentUpdatedNotificationEvent,
  FeatureCreatedNotificationEvent,
  FeatureDeletedNotificationEvent,
  FeatureUpdatedNotificationEvent,
  UserLoginNotificationEvent,
} from "back-end/types/event";
import { NotificationEvent } from "back-end/src/events/notification-events";

export const getEventText = (
  event: EventInterface<NotificationEvent>
): string => {
  switch (event.data.event) {
    case "user.login":
      return getTitleForUserLogin(
        (event.data as unknown) as UserLoginNotificationEvent
      );

    case "experiment.created":
      return getTitleForExperimentCreated(
        (event.data as unknown) as ExperimentCreatedNotificationEvent
      );

    case "experiment.updated":
      return getTitleForExperimentUpdated(
        (event.data as unknown) as ExperimentUpdatedNotificationEvent
      );

    case "experiment.deleted":
      return getTitleForExperimentDeleted(
        (event.data as unknown) as ExperimentDeletedNotificationEvent
      );

    case "feature.created":
      return getTitleForFeatureCreated(
        (event.data as unknown) as FeatureCreatedNotificationEvent
      );

    case "feature.updated":
      return getTitleForFeatureUpdated(
        (event.data as unknown) as FeatureUpdatedNotificationEvent
      );

    case "feature.deleted":
      return getTitleForFeatureDeleted(
        (event.data as unknown) as FeatureDeletedNotificationEvent
      );

    default:
      // This fallthrough case prevents empty strings.
      // TODO: Remove this default case once we've fixed https://github.com/growthbook/growthbook/issues/1114
      return event.data.event;
  }
};

// region Feature

const getTitleForFeatureCreated = ({
  data,
}: FeatureCreatedNotificationEvent): string => {
  return `The feature ${data?.current?.id || "(unknown)"} was created`;
};

const getTitleForFeatureUpdated = ({
  data,
}: FeatureUpdatedNotificationEvent): string => {
  return `The feature ${data?.current?.id || "(unknown)"} was updated`;
};

const getTitleForFeatureDeleted = ({
  data,
}: FeatureDeletedNotificationEvent): string => {
  return `The feature ${data?.previous?.id || "(unknown)"} was deleted`;
};

// endregion Feature

// region Experiment

const getTitleForExperimentCreated = ({
  data,
}: ExperimentCreatedNotificationEvent): string => {
  return `The experiment ${
    data?.current?.name || data?.current?.id || "(unknown)"
  } was created`;
};

const getTitleForExperimentUpdated = ({
  data,
}: ExperimentUpdatedNotificationEvent): string => {
  return `The experiment ${
    data?.previous?.name || data?.previous?.id || "(unknown)"
  } was updated`;
};

const getTitleForExperimentDeleted = ({
  data,
}: ExperimentDeletedNotificationEvent): string => {
  return `The experiment ${
    data?.previous?.name || data?.previous?.id || "(unknown)"
  } was deleted`;
};

// endregion Experiment

// region User

const getTitleForUserLogin = ({ data }: UserLoginNotificationEvent): string => {
  return `The user ${data.current.name} (${data.current.email}) has logged in`;
};

// endregion User
