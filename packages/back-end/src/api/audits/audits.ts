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

// A full page may have more behind it; a short one is the end.
function getNextCursor(page: { dateCreated: Date }[], limit: number) {
  return page.length < limit
    ? null
    : page[page.length - 1].dateCreated.toISOString();
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
  const filter = before ? { dateCreated: { $lt: new Date(before) } } : {};
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
    nextCursor: getNextCursor(page, limit),
  };
});

export const listEvents = createApiRequestHandler(listEventsValidator)(async (
  req,
) => {
  const { context } = req;
  assertCanViewAuditLogs(context);
  const limit = req.query.limit ?? DEFAULT_LIMIT;

  const page = await getEventsForOrganization(context.org.id, {
    page: 1,
    perPage: limit,
    eventTypes: req.query.events
      ?.split(",")
      .map((e) => e.trim())
      .filter(Boolean),
    from: req.query.after,
    to: req.query.before,
    sortOrder: -1,
  });

  return {
    // Cursor from the unfiltered page, so hidden events don't end paging early
    events: page
      .filter((e) => context.permissions.canViewEvent(e.data))
      .map(toApiEvent),
    nextCursor: getNextCursor(page, limit),
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
