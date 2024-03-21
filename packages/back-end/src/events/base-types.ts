import { EventAuditUser } from "./event-types";

/**
 * Supported events for event notifications
 */
export const notificationEventNames = [
  // Features
  "feature.created",
  "feature.updated",
  "feature.deleted",
  // Experiments
  "experiment.created",
  "experiment.updated",
  "experiment.deleted",
  // User
  "user.login",
  // Test
  "webhook.test",
] as const;

export type NotificationEventName = typeof notificationEventNames[number];

/**
 * Supported resources for event notifications
 */
export const notificationEventResources = [
  "feature",
  "experiment",
  "user",
  "webhook",
] as const;
export type NotificationEventResource = typeof notificationEventResources[number];

/**
 * Event Notification payload
 */
export type NotificationEventPayload<
  EventName extends NotificationEventName,
  ResourceType extends NotificationEventResource | unknown,
  DataType
> = {
  event: EventName;
  object: ResourceType;
  data: DataType;
  user: EventAuditUser;
};
