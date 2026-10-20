import {
  getEventValidator,
  listAuditsValidator,
  listEventsValidator,
} from "shared/validators";
import { AuditInterface } from "shared/types/audit";
import { EventInterface } from "shared/types/events/event";
import { getAuditHistory } from "back-end/src/models/AuditModel";
import {
  getEventForOrganization,
  getEventsForOrganization,
} from "back-end/src/models/EventModel";
import {
  dateCursorFilter,
  getNextDateCursor,
  parseDateCursor,
} from "back-end/src/util/dateCursor";
import {
  canReadApiKeyHistory,
  getApiKeyIdsHiddenFromKeyViewers,
} from "back-end/src/services/apiKeyHistory";
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

export const listAudits = createApiRequestHandler(listAuditsValidator)(async (
  req,
) => {
  const { context } = req;
  assertCanViewAuditLogs(context);
  const { entityType, entityId, before } = req.query;
  // Same API key and Project read rules as the app's History tab
  if (
    entityType === "apiKey" &&
    !(await canReadApiKeyHistory(context, entityId))
  ) {
    context.permissions.throwPermissionError();
  }
  if (
    entityType === "project" &&
    entityId &&
    !context.permissions.canReadSingleProjectResource(entityId)
  ) {
    context.permissions.throwPermissionError();
  }
  const excludeIds =
    entityType === "project"
      ? (await context.getAllProjectIds()).filter(
          (p) => !context.permissions.canReadSingleProjectResource(p),
        )
      : entityType === "apiKey" &&
          !entityId &&
          !context.permissions.canManagePersonalAccessTokens()
        ? await getApiKeyIdsHiddenFromKeyViewers(context)
        : [];

  const { events, nextCursor } = await getAuditHistory(
    context.org.id,
    entityType,
    entityId,
    req.query.limit ?? DEFAULT_LIMIT,
    { before: parseDateCursor(context, before), excludeIds },
  );

  return { audits: events.map(toApiAudit), nextCursor };
});

export const listEvents = createApiRequestHandler(listEventsValidator)(async (
  req,
) => {
  const { context } = req;
  assertCanViewAuditLogs(context);
  const limit = req.query.limit ?? DEFAULT_LIMIT;
  const cursor = parseDateCursor(context, req.query.before);

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
    dateCursorFilter(cursor),
  );

  return {
    // Cursor from the unfiltered page, so hidden events don't end paging early
    events: page
      .filter((e) => context.permissions.canViewEvent(e.data))
      .map(toApiEvent),
    nextCursor: getNextDateCursor(page, limit, cursor),
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
