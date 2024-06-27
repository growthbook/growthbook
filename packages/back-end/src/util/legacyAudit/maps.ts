import { UnionToIntersection } from "../types";
import { DefinedEvent } from "../../events/notification-events";
import {
  AuditNotificationEventMap,
  AuditEventNameTemplate,
  AuditEventResource,
  auditNotificationEvent,
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
          };
        }
    : never
  : never;

// This is used to make audit interface to event interface.
// Tt has type: { "experiment.update": { entity: "experiment", event: "experiment.updated" } & ...
// and excludes the events already defined.
type AuditEventMappings = UnionToIntersection<
  AuditEventMappingTemplate<AuditEventResource>
>;

export const auditEventMappings: AuditEventMappings = (Object.keys(
  auditEvents
) as AuditEventResource[]).reduce<AuditEventMappings>(
  (mappings: AuditEventMappings, resource: AuditEventResource) => ({
    ...mappings,
    ...auditEvents[resource].reduce(
      (events, event) => ({
        ...events,
        [`${resource}.${event}`]: {
          object: resource,
          event: `${resource}.${auditNotificationEvent(resource, event)}`,
        },
      }),
      ({} as unknown) as AuditEventMappings
    ),
  }),
  ({} as unknown) as AuditEventMappings
);

export type AuditInterfaceTemplate<I> = I extends { event: unknown }
  ? I["event"] extends keyof AuditEventMappings
    ? I
    : never
  : never;
