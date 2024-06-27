import { UnionToTuple } from "../util/types";
import {
  auditNotificationEvents,
  AuditNoficationEventName,
} from "../util/legacyAudit/base";
import { EventAuditUser } from "./event-types";

export const notificationEvents = {
  ...auditNotificationEvents,
  webhook: ["test"],
  experiment: [...auditNotificationEvents["experiment"], "warning", "info"],
  user: [...auditNotificationEvents["user"], "login"],
} as const;

type NotificationEvents = typeof notificationEvents;

/**
 * Supported resources for event notifications
 */
export const notificationEventResources = Object.keys(notificationEvents) as [
  keyof NotificationEvents
];
export type NotificationEventResource = typeof notificationEventResources[number];

export type NotificationEventTemplate<
  K extends NotificationEventResource
> = NotificationEvents[K][number];

export type NotificationEventNameTemplate<
  K extends NotificationEventResource,
  E = NotificationEvents[K][number]
> = K extends NotificationEventResource
  ? E extends NotificationEvents[K][number]
    ? `${K}.${NotificationEventTemplate<K>}`
    : never
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

type AuditData<EventName> = EventName extends AuditNoficationEventName
  ? {
      auditData: {
        reason?: string;
        parent?: {
          object: string;
          id: string;
        };
        details?: string;
      };
    }
  : unknown;

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
  user: EventAuditUser;
  projects: string[];
  tags: string[];
  environments: string[];
  containsSecrets: boolean;
} & AuditData<EventName>;

// Only use this for zod validations!
export const zodNotificationEventNamesEnum = notificationEventNames as UnionToTuple<NotificationEventName>;
