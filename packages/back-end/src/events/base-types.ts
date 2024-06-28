import { UnionToTuple } from "../util/types";
import { EventAuditUser } from "./event-types";

export const notificationEvents = {
  feature: ["created", "updated", "deleted"],
  experiment: ["created", "updated", "deleted", "warning", "info"],
  user: ["login"],
  webhook: ["test"],
} as const;

type NotificationEvents = typeof notificationEvents;

/**
 * Supported resources for event notifications
 */
export const notificationEventResources = Object.keys(notificationEvents) as [
  keyof NotificationEvents
];

export type NotificationEventResource = typeof notificationEventResources[number];

export type NotificationEventNames<K> = K extends NotificationEventResource
  ? `${K}.${NotificationEvents[K][number]}`
  : never;

export type NotificationEventName = NotificationEventNames<NotificationEventResource>;

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

type OptionalNotificationEventNames<R> = R extends NotificationEventResource
  ? NotificationEventNames<R>
  : NotificationEventName;

/**
 * Event Notification payload
 */
export type NotificationEventPayload<
  ResourceType extends NotificationEventResource | undefined,
  EventName extends OptionalNotificationEventNames<ResourceType> = OptionalNotificationEventNames<ResourceType>,
  DataType = unknown
> = {
  event: EventName;
  object: ResourceType;
  data: DataType;
  user: EventAuditUser;
  projects: string[];
  tags: string[];
  environments: string[];
  containsSecrets: boolean;
};

// Only use this for zod validations!
export const zodNotificationEventNamesEnum = notificationEventNames as UnionToTuple<NotificationEventName>;
