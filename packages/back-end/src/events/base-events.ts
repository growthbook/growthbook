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
  ApiFeatureInterface & WithOrganizationId
>;

export type FeatureUpdatedNotificationEvent = NotificationEventPayload<
  "feature.updated",
  "feature",
  ApiFeatureInterface & WithOrganizationId
>;

export type FeatureDeletedNotificationEvent = NotificationEventPayload<
  "feature.deleted",
  "feature",
  { featureId: string } & WithOrganizationId
>;
