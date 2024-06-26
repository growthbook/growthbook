import { DefinedEvent } from "../events/notification-events";
import { UnionToIntersection } from "../util/types";

import {
  entityEvents as auditEvents,
  EntityType as AuditEventResource,
  EntityEventTemplate as AuditEventTemplate,
} from "../types/Audit";

export {
  entityEvents as auditEvents,
  EntityType as auditEventResources,
  EntityType as AuditEventResource,
  EntityEventTemplate as AuditEventTemplate,
} from "../types/Audit";

export type FromAuditEventMap<
  Resource extends AuditEventResource,
  Event extends AuditEventTemplate<Resource>
> = Resource extends "savedGroup"
  ? Event
  : Resource extends "archetype"
  ? Event
  : Event extends "create"
  ? "created"
  : Event extends "update"
  ? "updated"
  : Event extends "delete"
  ? "deleted"
  : Event;

export const fromAuditEvent = <
  Resource extends AuditEventResource,
  Event extends AuditEventTemplate<Resource>
>(
  resource: Resource,
  event: Event
) => {
  if (resource == "savedGroup" || resource == "archetype")
    return (event as unknown) as FromAuditEventMap<Resource, Event>;

  switch (event as unknown) {
    case "create":
      return ("created" as unknown) as FromAuditEventMap<Resource, Event>;
    case "update":
      return ("updated" as unknown) as FromAuditEventMap<Resource, Event>;
    case "delete":
      return ("deleted" as unknown) as FromAuditEventMap<Resource, Event>;
    default:
      return event as FromAuditEventMap<Resource, Event>;
  }
};

type AuditNotificationEventTemplate<R> = R extends AuditEventResource
  ? { [k in R]: FromAuditEventMap<R, AuditEventTemplate<R>>[] }
  : never;

// This is all the audit events mapped to the notification convention,
// e.g. attribute: ["created", ...]
type AuditNotificationEvent = UnionToIntersection<
  AuditNotificationEventTemplate<AuditEventResource>
>;

export const auditNotificationEvent: AuditNotificationEvent = (Object.keys(
  auditEvents
) as AuditEventResource[]).reduce<AuditNotificationEvent>(
  (mappings: AuditNotificationEvent, resource: AuditEventResource) => ({
    ...mappings,
    [resource]: auditEvents[resource].map((event) =>
      fromAuditEvent(resource, event)
    ),
  }),
  ({} as unknown) as AuditNotificationEvent
);

type AuditEventMapping<R, E> = R extends AuditEventResource
  ? E extends AuditEventTemplate<R>
    ? // Here we exclude the audit events that are already defined as notification event.
      `${R}.${FromAuditEventMap<R, E>}` extends DefinedEvent
      ? never
      : {
          [k in `${R}.${E}`]: {
            object: R;
            event: `${R}.${FromAuditEventMap<R, E>}`;
          };
        }
    : never
  : never;

type AuditEventMappings<R> = R extends AuditEventResource
  ? AuditEventMapping<R, AuditEventTemplate<R>>
  : never;

// This is used to make audit interface to event interface.
// Tt has type: { "experiment.update": { entity: "experiment", event: "experiment.updated" } & ...
// and excludes the events already defined.
type ToAuditEventMappings = UnionToIntersection<
  AuditEventMappings<AuditEventResource>
>;

const mapEvent = <
  R extends AuditEventResource,
  E extends AuditEventTemplate<R>
>(
  resource: R
) => (
  events: Partial<ToAuditEventMappings>,
  event: E
): Partial<ToAuditEventMappings> => ({
  ...events,
  [`${resource}.${event}`]: {
    object: resource,
    event: `${resource}.${fromAuditEvent(resource, event)}`,
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

export type LegacyAuditInterfaceTemplate<I> = I extends { event: unknown }
  ? I["event"] extends keyof ToAuditEventMappings
    ? I
    : never
  : never;
