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
  event: EventName;
  object: ResourceType;
  data: DataType;
  user: EventAuditUser;
};

// region Audit

/**
 * You can get this property on the response.locals.eventAudit property
 */
export type EventAuditUser =
  | EventAuditUserLoggedIn
  | EventAuditUserApiKey
  | null;

/**
 * You can get this property on the response.locals.eventAudit property.
 * Example usage:
 *    (req, res: Response<MyResponseData, EventAuditUserForResponseLocals>) => {}
 */
export type EventAuditUserForResponseLocals = {
  eventAudit: EventAuditUser;
};

export type EventAuditUserLoggedIn = {
  type: "dashboard";
  id: string;
  email: string;
  name: string;
};

export type EventAuditUserApiKey = {
  type: "api_key";
  apiKey: string;
};

// endregion Audit
