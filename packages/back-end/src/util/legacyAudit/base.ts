import { UnionToIntersection } from "../types";

import {
  entityEvents as auditEvents,
  EntityType as AuditEventResource,
  EntityEventTemplate as AuditEventTemplate,
} from "../../types/Audit";

export {
  entityEvents as auditEvents,
  EntityType as auditEventResources,
  EntityType as AuditEventResource,
  EntityEventTemplate as AuditEventTemplate,
} from "../../types/Audit";

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

type AuditNoficationEventNameTemplate<
  R,
  E = AuditEventTemplate<R>
> = R extends AuditEventResource
  ? E extends AuditEventTemplate<R>
    ? `${R}.${FromAuditEventMap<R, E>}`
    : never
  : never;

export type AuditNoficationEventName = AuditNoficationEventNameTemplate<AuditEventResource>;
