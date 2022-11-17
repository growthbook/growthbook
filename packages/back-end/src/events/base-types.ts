/**
 * Supported events for event notifications
 */
export type NotificationEventName =
  | "feature.created"
  | "feature.updated"
  | "feature.deleted";

/**
 * Supported resources for event notifications
 */
export type NotificationEventResource = "feature" | "experiment";

/**
 * Event Notification payload
 */
export type NotificationEventPayload<
  EventName extends NotificationEventName,
  ResourceType extends NotificationEventResource,
  DataType
> = {
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
