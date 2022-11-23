export const APP_NOTIFICATION_EVENT_EMITTER_NAME = "notification_event";

/**
 * Supported events for event notifications
 */
export const notificationEventNames = [
  "feature.created",
  "feature.updated",
  "feature.deleted",
] as const;

export type NotificationEventName = typeof notificationEventNames[number];

/**
 * Supported resources for event notifications
 */
export const notificationEventResources = ["feature", "experiment"] as const;
export type NotificationEventResource = typeof notificationEventResources[number];

/**
 * Event Notification payload
 */
export type NotificationEventPayload<
  EventName extends NotificationEventName,
  ResourceType extends NotificationEventResource | unknown,
  DataType
> = {
  event_id: string;
  organization_id: string;
  event: EventName;
  object: ResourceType;
  data: DataType;
};

export interface NotificationEventHandler<
  NotificationEventPayload,
  ReturnType
> {
  (payload: NotificationEventPayload): Promise<ReturnType>;
}
