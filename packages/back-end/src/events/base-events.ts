import { NotificationEventPayload } from "./base-types";
import { ApiFeatureInterface } from "../../types/api";

/**
 * The created feature.
 * @param data is the feature definition
 */
export type FeatureCreatedNotificationEvent = NotificationEventPayload<
  "feature.created",
  "feature",
  ApiFeatureInterface
>;

/**
 * The updated feature.
 * @param data is the feature definition
 */
export type FeatureUpdatedNotificationEvent = NotificationEventPayload<
  "feature.updated",
  "feature",
  ApiFeatureInterface
>;

/**
 * The deleted feature.
 * @param data  is the feature.id
 */
export type FeatureDeletedNotificationEvent = NotificationEventPayload<
  "feature.deleted",
  "feature",
  string
>;
