import { NotificationEventPayload } from "./base-types";
import { ApiFeatureInterface } from "../../types/api";

/**
 * Some resource IDs are not unique. This can help.
 * Example:   ApiFeatureInterface & WithOrganizationId
 */
export type WithOrganizationId = { organizationId: string };

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
  { featureId: string }
>;
