import { UnionToTuple, UnionToIntersection } from "../util/types";
import {
  entityEvents as auditEvents,
  EntityEvents as AuditEvents,
  EntityType as AuditEventResource,
} from "../types/Audit";
import { EventAuditUser } from "./event-types";

export {
  entityEvents as auditEvents,
  EntityEvents as AuditEvents,
  EntityType as auditEventResources,
  EntityType as AuditEventResource,
} from "../types/Audit";

type FromAuditEventMap<Event> = Event extends "create"
  ? "created"
  : Event extends "update"
  ? "updated"
  : Event extends "delete"
  ? "deleted"
  : Event;

const fromAuditEvent = <V>(event: V) => {
  switch (event) {
    case "create":
      return "created" as FromAuditEventMap<V>;
    case "update":
      return "updated" as FromAuditEventMap<V>;
    case "delete":
      return "deleted" as FromAuditEventMap<V>;
    default:
      return event as FromAuditEventMap<V>;
  }
};

const fromAuditEvents = <V>(events: readonly V[]) => events.map(fromAuditEvent);

type ToAuditEventMap<Event> = Event extends "created"
  ? "create"
  : Event extends "updated"
  ? "update"
  : Event extends "deleted"
  ? "delete"
  : Event;

const toAuditEvent = <V>(event: V) => {
  switch (event) {
    case "created":
      return "create" as ToAuditEventMap<V>;
    case "updated":
      return "update" as ToAuditEventMap<V>;
    case "deleted":
      return "delete" as ToAuditEventMap<V>;
    default:
      return event as ToAuditEventMap<V>;
  }
};

type AuditEventMapping<R, E> = R extends AuditEventResource
  ? E extends AuditEvents[R][number]
    ? {
        [k in `${R}.${ToAuditEventMap<E>}`]: {
          entity: R;
          event: `${R}.${E}`;
        };
      }
    : never
  : never;

type AuditEventMappings<R> = R extends AuditEventResource
  ? AuditEventMapping<R, AuditEvents[R][number]>
  : never;

// This has type: { "experiment.updated": { entity: "experiment", event: "experiment.update" } & ...
type ToAuditEventMappings = UnionToIntersection<
  AuditEventMappings<AuditEventResource>
>;

const mapEvent = <
  R extends AuditEventResource,
  E extends AuditEvents[R][number]
>(
  resource: R
) => (
  events: Partial<ToAuditEventMappings>,
  event: E
): Partial<ToAuditEventMappings> => ({
  ...events,
  [`${resource}.${toAuditEvent(event)}`]: {
    entity: resource,
    event: `${resource}.${event}`,
  },
});

const reduceEvents = <R extends AuditEventResource>(resource: R) =>
  // This looks like a TS bug: the check refuses to use the infered type
  // definition for reduce unless spread.
  [...auditEvents[resource]].reduce(mapEvent(resource), {});

export const toAuditEventMappings: ToAuditEventMappings = (Object.keys(
  auditEvents
) as AuditEventResource[]).reduce<ToAuditEventMappings>(
  (mappings: ToAuditEventMappings, resource: AuditEventResource) => ({
    ...mappings,
    ...reduceEvents(resource),
  }),
  ({} as unknown) as ToAuditEventMappings
);

export const notificationEvents = {
  ...auditEvents,
  webhook: ["test"],
  feature: fromAuditEvents(auditEvents.feature),
  experiment: [...fromAuditEvents(auditEvents.experiment), "warning", "info"],
  user: [...fromAuditEvents(auditEvents.user), "login"],
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

export type OptionalNotificationEventNames<
  R
> = R extends NotificationEventResource
  ? NotificationEventNames<R>
  : NotificationEventName;

type AuditData = {
  reason: string;
  parent: {
    object: string;
    id: string;
    name: string;
  };
  details: string;
};

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
  auditData?: AuditData;
  user: EventAuditUser;
  projects: string[];
  tags: string[];
  environments: string[];
  containsSecrets: boolean;
};

// Only use this for zod validations!
export const zodNotificationEventNamesEnum = notificationEventNames as UnionToTuple<NotificationEventName>;
