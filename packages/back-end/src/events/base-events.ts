import { FeatureInterface } from "../../types/feature";
import { ExperimentInterface } from "../../types/experiment";
import { NotificationEventPayload } from "./base-types";

// region Feature

export type FeatureCreatedNotificationEvent = NotificationEventPayload<
  "feature.created",
  "feature",
  {
    current: FeatureInterface;
  }
>;

export type FeatureUpdatedNotificationEvent = NotificationEventPayload<
  "feature.updated",
  "feature",
  {
    current: FeatureInterface;
    previous: FeatureInterface;
  }
>;

export type FeatureDeletedNotificationEvent = NotificationEventPayload<
  "feature.deleted",
  "feature",
  {
    previous: FeatureInterface;
  }
>;

// endregion Feature

// region Experiment

export type ExperimentCreatedNotificationEvent = NotificationEventPayload<
  "experiment.created",
  "experiment",
  {
    current: ExperimentInterface;
  }
>;

export type ExperimentUpdatedNotificationEvent = NotificationEventPayload<
  "experiment.updated",
  "experiment",
  {
    current: ExperimentInterface;
    previous: ExperimentInterface;
  }
>;

export type ExperimentDeletedNotificationEvent = NotificationEventPayload<
  "experiment.deleted",
  "experiment",
  {
    previous: ExperimentInterface;
  }
>;

// endregion Experiment

/**
 * All supported event types in the database
 */
export type NotificationEvent =
  | FeatureCreatedNotificationEvent
  | FeatureUpdatedNotificationEvent
  | FeatureDeletedNotificationEvent
  | ExperimentCreatedNotificationEvent
  | ExperimentUpdatedNotificationEvent
  | ExperimentDeletedNotificationEvent;
