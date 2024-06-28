import { UnionToIntersection } from "../types";
import { DefinedEvent } from "../../events/notification-events";
import { NotificationEventTemplate } from "../../events/base-types";
import {
  AuditNotificationEventMap,
  AuditEventNameTemplate,
  AuditEventResource,
  auditNotificationEvent,
  auditNotificationEvents,
  auditEvents,
} from "./base";

type AuditEventMappingTemplate<
  R,
  E = AuditEventNameTemplate<R>
> = R extends AuditEventResource
  ? E extends AuditEventNameTemplate<R>
    ? // Here we exclude the audit events that are already defined as notification event.
      `${R}.${AuditNotificationEventMap<R, E>}` extends DefinedEvent
      ? never
      : {
          [k in `${R}.${E}`]: {
            object: R;
            event: `${R}.${AuditNotificationEventMap<R, E>}`;
            auditData: {
              id: string;
              reason?: string;
              parent?: {
                object: R;
                id: string;
              };
              details?: string;
            };
          };
        }
    : never
  : never;

// This is used to make audit interface to event interface.
// It has type: { "experiment.update": { entity: "experiment", event: "experiment.updated" } & ...
// and excludes the events already defined.
type AuditEventMappings = UnionToIntersection<
  AuditEventMappingTemplate<AuditEventResource>
>;

export const auditEventMappings = ({
  id,
  reason,
  parent,
  details,
}: {
  id: string;
  reason?: string;
  parent?: string;
  details?: string;
}): AuditEventMappings =>
  (Object.keys(auditEvents) as AuditEventResource[]).reduce<AuditEventMappings>(
    (mappings: AuditEventMappings, resource: AuditEventResource) => ({
      ...mappings,
      ...auditEvents[resource].reduce(
        (events, event) => ({
          ...events,
          [`${resource}.${event}`]: {
            object: resource,
            event: `${resource}.${auditNotificationEvent(resource, event)}`,
            auditData: {
              id,
              reason,
              ...(parent ? { parent: { object: resource, id: parent } } : {}),
              details,
            },
          },
        }),
        ({} as unknown) as AuditEventMappings
      ),
    }),
    ({} as unknown) as AuditEventMappings
  );

export type EventAuditMap<
  Resource extends AuditEventResource,
  Event extends NotificationEventTemplate<Resource>
> = Resource extends "savedGroup"
  ? Event
  : Resource extends "archetype"
  ? Event
  : Event extends "created"
  ? "create"
  : Event extends "updated"
  ? "update"
  : Event extends "deleted"
  ? "delete"
  : Event;

export const eventAudit = <
  Resource extends AuditEventResource,
  Event extends NotificationEventTemplate<Resource>
>(
  resource: Resource,
  event: Event
) => {
  if (resource == "savedGroup" || resource == "archetype")
    return (event as unknown) as EventAuditMap<Resource, Event>;

  switch (event as unknown) {
    case "create":
      return ("created" as unknown) as EventAuditMap<Resource, Event>;
    case "update":
      return ("updated" as unknown) as EventAuditMap<Resource, Event>;
    case "delete":
      return ("deleted" as unknown) as EventAuditMap<Resource, Event>;
    default:
      return event as EventAuditMap<Resource, Event>;
  }
};

type EventAuditMappingTemplate<
  R extends AuditEventResource,
  E = NotificationEventTemplate<R>
> = R extends AuditEventResource
  ? E extends NotificationEventTemplate<R>
    ? {
        [k in `${R}.${E}`]: {
          entity: { object: R; id: string; name?: string };
          event: `${R}.${EventAuditMap<R, E>}`;
          parent?: { object: R; id: string };
        };
      }
    : never
  : never;

// This is used to map notification event to audit event.
// Tt has type: { "experiment.updated": experiment.update } & ...
type EventAuditMappings = UnionToIntersection<
  EventAuditMappingTemplate<AuditEventResource>
>;

export const eventAuditMappings = ({
  id,
  name,
  parent,
}: {
  id: string;
  name?: string;
  parent?: string;
}): EventAuditMappings =>
  (Object.keys(auditEvents) as AuditEventResource[]).reduce<EventAuditMappings>(
    (mappings: EventAuditMappings, resource: AuditEventResource) => ({
      ...mappings,
      ...[...auditNotificationEvents[resource]].reduce(
        (events, event) => ({
          ...events,
          [`${resource}.${event}`]: {
            entity: { object: resource, id, name },
            event: `${resource}.${eventAudit(resource, event)}`,
            ...(parent ? { parent: { object: resource, id: parent } } : {}),
          },
        }),
        ({} as unknown) as EventAuditMappings
      ),
    }),
    ({} as unknown) as EventAuditMappings
  );

export type AuditInterfaceTemplate<I> = I extends { event: unknown }
  ? I["event"] extends keyof AuditEventMappings
    ? I
    : never
  : never;
