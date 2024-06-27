import { UnionToIntersection } from "../types";

import {
  entityEvents as auditEvents,
  EntityType as AuditEventResource,
  EntityEventTemplate as AuditEventNameTemplate,
} from "../../types/Audit";

export {
  entityEvents as auditEvents,
  EntityType as auditEventResources,
  EntityType as AuditEventResource,
  EntityEventTemplate as AuditEventNameTemplate,
} from "../../types/Audit";

export type AuditNotificationEventMap<
  Resource extends AuditEventResource,
  Event extends AuditEventNameTemplate<Resource>
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

export const auditNotificationEvent = <
  Resource extends AuditEventResource,
  Event extends AuditEventNameTemplate<Resource>
>(
  resource: Resource,
  event: Event
) => {
  if (resource == "savedGroup" || resource == "archetype")
    return (event as unknown) as AuditNotificationEventMap<Resource, Event>;

  switch (event as unknown) {
    case "create":
      return ("created" as unknown) as AuditNotificationEventMap<
        Resource,
        Event
      >;
    case "update":
      return ("updated" as unknown) as AuditNotificationEventMap<
        Resource,
        Event
      >;
    case "delete":
      return ("deleted" as unknown) as AuditNotificationEventMap<
        Resource,
        Event
      >;
    default:
      return event as AuditNotificationEventMap<Resource, Event>;
  }
};

type AuditNotificationEventTemplate<R> = R extends AuditEventResource
  ? { [k in R]: AuditNotificationEventMap<R, AuditEventNameTemplate<R>>[] }
  : never;

// This is all the audit events mapped to the notification convention,
// e.g. attribute: ["created", ...]
type AuditNotificationEvents = UnionToIntersection<
  AuditNotificationEventTemplate<AuditEventResource>
>;

export const auditNotificationEvents: AuditNotificationEvents = (Object.keys(
  auditEvents
) as AuditEventResource[]).reduce<AuditNotificationEvents>(
  (mappings: AuditNotificationEvents, resource: AuditEventResource) => ({
    ...mappings,
    [resource]: auditEvents[resource].map((event) =>
      auditNotificationEvent(resource, event)
    ),
  }),
  ({} as unknown) as AuditNotificationEvents
);

type AuditNoficationEventNameTemplate<
  R,
  E = AuditEventNameTemplate<R>
> = R extends AuditEventResource
  ? E extends AuditEventNameTemplate<R>
    ? `${R}.${AuditNotificationEventMap<R, E>}`
    : never
  : never;

export type AuditNoficationEventName = AuditNoficationEventNameTemplate<AuditEventResource>;
