import { ApiExperiment, ApiFeature } from "../../types/openapi";
import { ExperimentWarningNotificationPayload } from "../types/ExperimentNotification";
import {
  NotificationEventPayload,
  OptionalNotificationEventNames,
  AuditEvents,
  AuditEventResource,
} from "./base-types";
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

// endregion Experiment

export type WebhookTestEvent = NotificationEventPayload<
  "webhook",
  "webhook.test",
  { webhookId: string }
>;

type DefinedNotificationEvent =
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

// We add back all audit payloads that are not otherwise defined above:

type DefinedEventTemplate<R> = R extends DefinedNotificationEvent
  ? R["event"]
  : never;

type DefinedEvent = DefinedEventTemplate<DefinedNotificationEvent>;

type AuditResourceEventTemplate<R, E> = R extends AuditEventResource
  ? E extends OptionalNotificationEventNames<R>
    ? // Here we exluded events already defined.
      E extends DefinedEvent
      ? never
      : NotificationEventPayload<R, E, undefined>
    : never
  : never;

type AuditEventTemplate<R> = R extends AuditEventResource
  ? AuditResourceEventTemplate<R, AuditEvents[R][number]>
  : never;

export type AuditNotificationEvent = AuditEventTemplate<AuditEventResource>;

/**
 * All supported event types in the database
 */
type NotificationEvent =
  | DefinedNotificationEvent
  | AuditNotificationEvent
