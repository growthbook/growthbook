import { ApiExperiment, ApiFeature } from "../../types/openapi";
import { IfEqual } from "../util/types";
import { ExperimentWarningNotificationPayload } from "../types/ExperimentNotification";
import { NotificationEventName, NotificationEventPayload } from "./base-types";
import { UserLoginAuditableProperties } from "./event-types";

// region User

export type UserLoginNotificationEvent = NotificationEventPayload<
  "user",
  "user.login",
  {
    current: UserLoginAuditableProperties;
  }
>;

// endregion User

// region Feature

export type FeatureCreatedNotificationEvent = NotificationEventPayload<
  "feature",
  "feature.created",
  {
    current: ApiFeature;
  }
>;

export type FeatureUpdatedNotificationEvent = NotificationEventPayload<
  "feature",
  "feature.updated",
  {
    current: ApiFeature;
    previous: ApiFeature;
  }
>;

export type FeatureDeletedNotificationEvent = NotificationEventPayload<
  "feature",
  "feature.deleted",
  {
    previous: ApiFeature;
  }
>;

// endregion Feature

// region Experiment

export type ExperimentCreatedNotificationEvent = NotificationEventPayload<
  "experiment",
  "experiment.created",
  {
    current: ApiExperiment;
  }
>;

export type ExperimentUpdatedNotificationEvent = NotificationEventPayload<
  "experiment",
  "experiment.updated",
  {
    current: ApiExperiment;
    previous: ApiExperiment;
  }
>;

export type ExperimentDeletedNotificationEvent = NotificationEventPayload<
  "experiment",
  "experiment.deleted",
  {
    previous: ApiExperiment;
  }
>;

export type ExperimentInfoNotificationEvent = NotificationEventPayload<
  "experiment",
  "experiment.info",
  null
>;

export type ExperimentWarningNotificationEvent = NotificationEventPayload<
  "experiment",
  "experiment.warning",
  ExperimentWarningNotificationPayload
>;

export type WebhookTestEvent = NotificationEventPayload<
  "webhook",
  "webhook.test",
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
