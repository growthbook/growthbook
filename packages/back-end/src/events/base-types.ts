export enum EmittedEvents {
  /**
   * This event should be emitted when a new record is added to the "events" collection
   */
  EVENT_CREATED = "EVENT_CREATED",
}

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
  event: EventName;
  object: ResourceType;
  data: DataType;
};
