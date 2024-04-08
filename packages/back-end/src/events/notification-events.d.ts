import { ApiExperiment, ApiFeature } from "../../types/openapi";
import { IfEqual } from "../util/types";
import { ExperimentWarningNotificationPayload } from "../types/ExperimentNotification";
import { NotificationEventName, NotificationEventPayload } from "./base-types";
import { UserLoginAuditableProperties } from "./event-types";

// region User

export type UserLoginNotificationEvent = NotificationEventPayload<
  "user.login",
  "user",
  {
    current: UserLoginAuditableProperties;
  }
>;

// endregion User

// region Feature

export type FeatureCreatedNotificationEvent = NotificationEventPayload<
  "feature.created",
  "feature",
  {
    current: ApiFeature;
  }
>;

export type FeatureUpdatedNotificationEvent = NotificationEventPayload<
  "feature.updated",
  "feature",
  {
    current: ApiFeature;
    previous: ApiFeature;
  }
>;

export type FeatureDeletedNotificationEvent = NotificationEventPayload<
  "feature.deleted",
  "feature",
  {
    previous: ApiFeature;
  }
>;

// endregion Feature

// region Experiment

export type ExperimentCreatedNotificationEvent = NotificationEventPayload<
  "experiment.created",
  "experiment",
  {
    current: ApiExperiment;
  }
>;

export type ExperimentUpdatedNotificationEvent = NotificationEventPayload<
  "experiment.updated",
  "experiment",
  {
    current: ApiExperiment;
    previous: ApiExperiment;
  }
>;

export type ExperimentDeletedNotificationEvent = NotificationEventPayload<
  "experiment.deleted",
  "experiment",
  {
    previous: ApiExperiment;
  }
>;

export type ExperimentInfoNotificationEvent = NotificationEventPayload<
  "experiment.info",
  "experiment",
  null
>;

export type ExperimentWarningNotificationEvent = NotificationEventPayload<
  "experiment.warning",
  "experiment",
  ExperimentWarningNotificationPayload
>;

export type WebhookTestEvent = NotificationEventPayload<
  "webhook.test",
  "webhook",
  { webhookId: string }
>;

// endregion Experiment

/**
 * All supported event types in the database
 */
type AllNotificationEvent =
  | UserLoginNotificationEvent
  | FeatureCreatedNotificationEvent
  | FeatureUpdatedNotificationEvent
  | FeatureDeletedNotificationEvent
  | ExperimentCreatedNotificationEvent
  | ExperimentUpdatedNotificationEvent
  | ExperimentDeletedNotificationEvent
  | ExperimentInfoNotificationEvent
  | ExperimentWarningNotificationEvent
  | WebhookTestEvent;

// Make sure we have a payload for each type of event
type NotificationEvent = IfEqual<
  NotificationEventName,
  AllNotificationEvent["event"],
  AllNotificationEvent
>;
