import { NotificationEventPayload } from "./base-types";
import { ApiFeatureInterface } from "../../types/api";

export type FeatureCreatedNotificationEvent = NotificationEventPayload<
  "feature.created",
  "feature",
  ApiFeatureInterface
>;

export type FeatureUpdatedNotificationEvent = NotificationEventPayload<
  "feature.updated",
  "feature",
  {
    current: ApiFeatureInterface;
    previous: ApiFeatureInterface;
  }
>;

export type FeatureDeletedNotificationEvent = NotificationEventPayload<
  "feature.deleted",
  "feature",
  {
    previous: ApiFeatureInterface;
  }
>;

/**
 * All supported event types in the database
 */
export type NotificationEvent =
  | FeatureCreatedNotificationEvent
  | FeatureUpdatedNotificationEvent
  | FeatureDeletedNotificationEvent;
