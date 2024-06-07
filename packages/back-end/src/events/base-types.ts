import { EventAuditUser } from "./event-types";

export const notificationEvents = {
  feature: ["created", "updated", "deleted"],
  experiment: ["created", "updated", "deleted", "warning", "info"],
  user: ["login"],
  webhook: ["test"],
} as const;

export type NotificationEvents = typeof notificationEvents;
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

export type OptionalNotificationEventNames<
  R
> = R extends NotificationEventResource
  ? NotificationEventNames<R>
  : NotificationEventName;

/**
 * Event Notification payload
 */
export type NotificationEventPayload<
  ResourceType extends NotificationEventName | unknown,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

type LastOf<T> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  UnionToIntersection<T extends any ? () => T : never> extends () => infer R
    ? R
    : never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Push<T extends any[], V> = [...T, V];

type TuplifyUnion<
  T,
  L = LastOf<T>,
  N = [T] extends [never] ? true : false
> = true extends N ? [] : Push<TuplifyUnion<Exclude<T, L>>, L>;

// Only use this for zod validations!
export const zodNotificationEventNamesEnum = notificationEventNames as TuplifyUnion<NotificationEventName>;
