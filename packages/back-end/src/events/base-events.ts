import { FeatureInterface } from "@/back-end/types/feature";
import { NotificationEventPayload } from "./base-types";

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

/**
 * All supported event types in the database
 */
export type NotificationEvent =
  | FeatureCreatedNotificationEvent
  | FeatureUpdatedNotificationEvent
  | FeatureDeletedNotificationEvent;
