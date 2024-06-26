import { UnionToTuple } from "../util/types";
import { auditNotificationEvent } from "../util/legacyAuditBase";

export const notificationEvents = {
  ...auditNotificationEvent,
  webhook: ["test"],
  experiment: [...auditNotificationEvent["experiment"], "warning", "info"],
  user: [...auditNotificationEvent["user"], "login"],
} as const;

type NotificationEvents = typeof notificationEvents;

/**
 * Supported resources for event notifications
 */
export const notificationEventResources = Object.keys(notificationEvents) as [
  keyof NotificationEvents
];
export type NotificationEventResource = typeof notificationEventResources[number];

export type NotificationEventNameTemplate<
  K
> = K extends NotificationEventResource
  ? `${K}.${NotificationEvents[K][number]}`
  : never;

export type NotificationEventName = NotificationEventNameTemplate<NotificationEventResource>;

export const notificationEventNames = (Object.keys(notificationEvents) as [
  NotificationEventResource
]).reduce<NotificationEventName[]>(
  (names, key) => [
    ...names,
    ...notificationEvents[key].map(
      (n) => `${key}.${n}` as NotificationEventName
    ),
  ],
  [] as NotificationEventName[]
);

export type OptionalNotificationEventNameTemplate<
  R
> = R extends NotificationEventResource
  ? NotificationEventNameTemplate<R>
  : NotificationEventName;

type AuditData = {
  reason?: string;
  parent?: {
    object: string;
    id: string;
  };
  details?: string;
};

/**
 * Event Notification payload
 */
export type NotificationEventPayload<
  ResourceType extends NotificationEventResource | undefined,
  EventName extends OptionalNotificationEventNameTemplate<ResourceType> = OptionalNotificationEventNameTemplate<ResourceType>,
  DataType = unknown
> = {
  event: EventName;
  object: ResourceType;
  data: DataType;
  auditData?: AuditData;
  user: EventAuditUser;
  projects: string[];
  tags: string[];
  environments: string[];
  containsSecrets: boolean;
};

// Only use this for zod validations!
export const zodNotificationEventNamesEnum = notificationEventNames as UnionToTuple<NotificationEventName>;
