import { ApiExperiment, ApiFeature } from "back-end/types/openapi";
import { ExperimentWarningNotificationPayload } from "back-end/src/validators/experiment-warnings";
import { LegacyNotificationEventPayload } from "./base-types";
import { UserLoginEventProperties } from "./event-types";

export { NotificationEvent } from "./base-types";

// region User

export type LegacyUserLoginNotificationEvent = LegacyNotificationEventPayload<
  "user",
  "user.login",
  {
    current: UserLoginEventProperties;
  }
>;

// endregion User

// region Feature

export type LegacyFeatureCreatedNotificationEvent =
  LegacyNotificationEventPayload<
    "feature",
    "feature.created",
    {
      current: ApiFeature;
    }
  >;

export type LegacyFeatureUpdatedNotificationEvent =
  LegacyNotificationEventPayload<
    "feature",
    "feature.updated",
    {
      current: ApiFeature;
      previous: ApiFeature;
    }
  >;

export type LegacyFeatureDeletedNotificationEvent =
  LegacyNotificationEventPayload<
    "feature",
    "feature.deleted",
    {
      previous: ApiFeature;
    }
  >;

// endregion Feature

// region Experiment

export type LegacyExperimentCreatedNotificationEvent =
  LegacyNotificationEventPayload<
    "experiment",
    "experiment.created",
    {
      current: ApiExperiment;
    }
  >;

export type LegacyExperimentUpdatedNotificationEvent =
  LegacyNotificationEventPayload<
    "experiment",
    "experiment.updated",
    {
      current: ApiExperiment;
      previous: ApiExperiment;
    }
  >;

export type LegacyExperimentDeletedNotificationEvent =
  LegacyNotificationEventPayload<
    "experiment",
    "experiment.deleted",
    {
      previous: ApiExperiment;
    }
  >;

export type LegacyExperimentWarningNotificationEvent =
  LegacyNotificationEventPayload<
    "experiment",
    "experiment.warning",
    ExperimentWarningNotificationPayload
  >;

export type LegacyWebhookTestEvent = LegacyNotificationEventPayload<
  "webhook",
  "webhook.test",
  { webhookId: string }
>;

// endregion Experiment

/**
 * All supported event types in the database
 */
export type LegacyNotificationEvent =
  | LegacyUserLoginNotificationEvent
  | LegacyFeatureCreatedNotificationEvent
  | LegacyFeatureUpdatedNotificationEvent
  | LegacyFeatureDeletedNotificationEvent
  | LegacyExperimentCreatedNotificationEvent
  | LegacyExperimentUpdatedNotificationEvent
  | LegacyExperimentDeletedNotificationEvent
  | LegacyExperimentWarningNotificationEvent
  | LegacyWebhookTestEvent;
