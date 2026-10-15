import {
  getEventValidator,
  listAuditsValidator,
  listEventsValidator,
} from "shared/validators";
import { AuditInterface } from "shared/types/audit";
import { EventInterface } from "shared/types/events/event";
import {
  findAllAuditsByEntityType,
  findAllAuditsByEntityTypeParent,
  findAuditByEntity,
  findAuditByEntityParent,
} from "back-end/src/models/AuditModel";
import {
  getEventForOrganization,
  getEventsForOrganization,
} from "back-end/src/models/EventModel";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";

const DEFAULT_LIMIT = 50;

function assertCanViewAuditLogs(context: ApiReqContext) {
  if (!context.permissions.canViewAuditLogs()) {
    context.permissions.throwPermissionError();
  }
}

function toApiAudit(a: AuditInterface) {
  return {
    id: a.id,
    event: a.event,
    entity: a.entity,
    parent: a.parent,
    user: a.user,
    reason: a.reason,
    details: a.details,
    dateCreated: a.dateCreated.toISOString(),
  };
}

function toApiEvent(e: EventInterface) {
  return {
    id: e.id,
    event: e.event,
    version: e.version,
    data: e.data as unknown as Record<string, unknown>,
    dateCreated: e.dateCreated.toISOString(),
  };
}

type Cursor = { date: Date; seen: string[] };

// `before` is a date-time, or a nextCursor "<date-time>_<ids>" listing the
// entries already returned at that time, so ties at a page boundary aren't lost.
function parseBefore(context: ApiReqContext, before?: string): Cursor | null {
  if (!before) return null;
  const sep = before.indexOf("_");
  const date = new Date(sep === -1 ? before : before.slice(0, sep));
  if (isNaN(date.getTime())) context.throwBadRequestError("Invalid `before`");
  return { date, seen: sep === -1 ? [] : before.slice(sep + 1).split(",") };
}

// Wrapped in $or so it composes with the events `after` filter on dateCreated
function cursorFilter(cursor: Cursor | null) {
  if (!cursor) return {};
  const unseenAtDate = cursor.seen.length
    ? [{ dateCreated: cursor.date, id: { $nin: cursor.seen } }]
    : [];
  return { $or: [{ dateCreated: { $lt: cursor.date } }, ...unseenAtDate] };
}

// A full page may have more behind it; a short one is the end.
function getNextCursor(
  page: { id: string; dateCreated: Date }[],
  limit: number,
  cursor: Cursor | null,
) {
  if (page.length < limit) return null;
  const date = page[page.length - 1].dateCreated;
  const seen = page
    .filter((e) => e.dateCreated.getTime() === date.getTime())
    .map((e) => e.id);
  if (cursor?.date.getTime() === date.getTime()) seen.push(...cursor.seen);
  return `${date.toISOString()}_${seen.join(",")}`;
}

export const listAudits = createApiRequestHandler(listAuditsValidator)(async (
  req,
) => {
  const { context } = req;
  assertCanViewAuditLogs(context);
  const { entityType, entityId, before } = req.query;
  // Key history exposes roles and scope, so it needs the key-admin permission
  if (entityType === "apiKey" && !context.permissions.canCreateApiKey()) {
    context.permissions.throwPermissionError();
  }

  const limit = req.query.limit ?? DEFAULT_LIMIT;
  const options = { limit, sort: { dateCreated: -1 as const } };
  const cursor = parseBefore(context, before);
  const filter = cursorFilter(cursor);
  const orgId = context.org.id;

  const [own, children] = await Promise.all(
    entityId
      ? [
          findAuditByEntity(orgId, entityType, entityId, options, filter),
          findAuditByEntityParent(orgId, entityType, entityId, options, filter),
        ]
      : [
          findAllAuditsByEntityType(orgId, entityType, options, filter),
          findAllAuditsByEntityTypeParent(orgId, entityType, options, filter),
        ],
  );
  const page = [...own, ...children]
    .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime())
    .slice(0, limit);

  return {
    audits: page.map(toApiAudit),
    nextCursor: getNextCursor(page, limit, cursor),
  };
});

export const listEvents = createApiRequestHandler(listEventsValidator)(async (
  req,
) => {
  const { context } = req;
  assertCanViewAuditLogs(context);
  const limit = req.query.limit ?? DEFAULT_LIMIT;
  const cursor = parseBefore(context, req.query.before);

  const page = await getEventsForOrganization(
    context.org.id,
    {
      page: 1,
      perPage: limit,
      eventTypes: req.query.events
        ?.split(",")
        .map((e) => e.trim())
        .filter(Boolean),
      from: req.query.after,
      sortOrder: -1,
    },
    cursorFilter(cursor),
  );

  return {
    // Cursor from the unfiltered page, so hidden events don't end paging early
    events: page
      .filter((e) => context.permissions.canViewEvent(e.data))
      .map(toApiEvent),
    nextCursor: getNextCursor(page, limit, cursor),
  };
});

export const getEvent = createApiRequestHandler(getEventValidator)(async (
  req,
) => {
  const { context } = req;
  assertCanViewAuditLogs(context);
  const event = await getEventForOrganization(req.params.id, context.org.id);
  if (!event || !context.permissions.canViewEvent(event.data)) {
    return context.throwNotFoundError(`Event not found: ${req.params.id}`);
  }
  return { event: toApiEvent(event) };
});
