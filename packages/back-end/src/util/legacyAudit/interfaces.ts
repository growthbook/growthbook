import { UnionToIntersection } from "../types";
import { DefinedEvent } from "../../events/notification-events";
import {
  FromAuditEventMap,
  AuditEventTemplate,
  AuditEventResource,
  fromAuditEvent,
  auditEvents,
} from "./base";

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
