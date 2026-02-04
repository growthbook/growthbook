import { EventInterface } from "shared/types/events/event";

// region Feature

const getTitleForFeatureCreated = ({ id }: { id: string }) =>
  `The feature ${id} was created`;

const getTitleForFeatureUpdated = ({ id }: { id: string }) =>
  `The feature ${id} was updated`;

const getTitleForFeatureDeleted = ({ id }: { id: string }) =>
  `The feature ${id}  was deleted`;

// endregion Feature

// region Experiment

const getTitleForExperimentCreated = ({ name }: { name: string }) =>
  `The experiment ${name} was created`;

const getTitleForExperimentUpdated = ({ name }: { name: string }) =>
  `The experiment ${name} was updated`;

const getTitleForExperimentDeleted = ({ name }: { name: string }) =>
  `The experiment ${name} was deleted`;

// endregion Experiment

// region User

const getTitleForUserLogin = ({
  name,
  email,
}: {
  name: string;
  email: string;
}) => `The user ${name} (${email}) has logged in`;

export const getEventText = (event: EventInterface): string => {
  switch (event.data.event) {
    case "user.login":
      return getTitleForUserLogin(
        event.version ? event.data.data.object : event.data.data.current,
      );

    case "experiment.created":
      return getTitleForExperimentCreated(
        event.version ? event.data.data.object : event.data.data.current,
      );

    case "experiment.updated":
      return getTitleForExperimentUpdated(
        event.version ? event.data.data.object : event.data.data.current,
      );

    case "experiment.deleted":
      return getTitleForExperimentDeleted(
        event.version ? event.data.data.object : event.data.data.previous,
      );

    case "feature.created":
      return getTitleForFeatureCreated(
        event.version ? event.data.data.object : event.data.data.current,
      );

    case "feature.updated":
      return getTitleForFeatureUpdated(
        event.version ? event.data.data.object : event.data.data.current,
      );

    case "feature.deleted":
      return getTitleForFeatureDeleted(
        event.version ? event.data.data.object : event.data.data.previous,
      );

    default:
      // This fallthrough case prevents empty strings.
      // TODO: Remove this default case once we've fixed https://github.com/growthbook/growthbook/issues/1114
      return event.data.event;
  }
};
