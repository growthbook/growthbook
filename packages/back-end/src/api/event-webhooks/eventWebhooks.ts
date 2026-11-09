import {
  deleteEventWebhookValidator,
  getEventWebhookValidator,
  listEventWebhookLogsValidator,
  listEventWebhooksValidator,
  postEventWebhookTestValidator,
  postEventWebhookValidator,
  putEventWebhookValidator,
} from "shared/validators";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { EventWebHookLegacyLogInterface } from "shared/types/event-webhook-log";
import {
  createEventWebHook,
  deleteEventWebHookById,
  getAllEventWebHooks,
  getEventWebHookById,
  sendEventWebhookTestEvent,
  updateEventWebHook,
} from "back-end/src/models/EventWebhookModel";
import { getLatestRunsForWebHook } from "back-end/src/models/EventWebHookLogModel";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";

// Writes omit secrets: a held write's response is shown on its confirmation
function toApiEventWebhook(w: EventWebHookInterface, withSecrets = true) {
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    enabled: w.enabled,
    events: w.events,
    projects: w.projects,
    tags: w.tags,
    environments: w.environments,
    payloadType: w.payloadType,
    method: w.method,
    ...(withSecrets ? { headers: w.headers, signingKey: w.signingKey } : {}),
    timeoutSeconds: w.timeoutSeconds ?? null,
    lastRunAt: w.lastRunAt?.toISOString() ?? null,
    lastState: w.lastState,
    lastResponseBody: w.lastResponseBody ?? null,
    dateCreated: w.dateCreated.toISOString(),
    dateUpdated: w.dateUpdated.toISOString(),
  };
}

function toApiLog(log: EventWebHookLegacyLogInterface) {
  return {
    id: log.id,
    event: log.event,
    url: log.url,
    method: log.method,
    result: log.result,
    responseCode: log.responseCode,
    responseBody: log.responseBody,
    payload: log.payload,
    dateCreated: log.dateCreated.toISOString(),
  };
}

// The Slack app manages its channels' webhooks, so REST leaves them out
function isSlackAppManaged(w: EventWebHookInterface) {
  return !!w.slack?.teamId;
}

async function getWebhook(context: ApiReqContext, id: string) {
  const webhook = await getEventWebHookById(id, context.org.id);
  if (!webhook || isSlackAppManaged(webhook)) {
    context.throwNotFoundError(`Event webhook not found: ${id}`);
  }
  return webhook;
}

export const listEventWebhooks = createApiRequestHandler(
  listEventWebhooksValidator,
)(async (req) => {
  const { permissions } = req.context;
  if (!permissions.canManageSomeEventWebhooks()) {
    permissions.throwPermissionError();
  }
  const webhooks = await getAllEventWebHooks(req.context.org.id);
  return {
    eventWebhooks: webhooks
      .filter(
        (w) => !isSlackAppManaged(w) && permissions.canViewEventWebhook(w),
      )
      .map((w) => toApiEventWebhook(w)),
  };
});

export const getEventWebhook = createApiRequestHandler(
  getEventWebhookValidator,
)(async (req) => {
  const webhook = await getWebhook(req.context, req.params.id);
  if (!req.context.permissions.canViewEventWebhook(webhook)) {
    req.context.permissions.throwPermissionError();
  }
  return { eventWebhook: toApiEventWebhook(webhook) };
});

export const postEventWebhook = createApiRequestHandler(
  postEventWebhookValidator,
)(async (req) => {
  const {
    projects = [],
    tags = [],
    environments = [],
    method = "POST",
    headers = {},
    ...rest
  } = req.body;
  if (
    !req.context.permissions.canCreateEventWebhook({ projects, environments })
  ) {
    req.context.permissions.throwPermissionError();
  }
  const created = await createEventWebHook({
    ...rest,
    organizationId: req.context.org.id,
    projects,
    tags,
    environments,
    method,
    headers,
  });
  return { eventWebhook: toApiEventWebhook(created, false) };
});

export const putEventWebhook = createApiRequestHandler(
  putEventWebhookValidator,
)(async (req) => {
  const { id } = req.params;
  const existing = await getWebhook(req.context, id);
  const { timeoutSeconds, ...updates } = req.body;
  if (!req.context.permissions.canUpdateEventWebhook(existing, updates)) {
    req.context.permissions.throwPermissionError();
  }
  await updateEventWebHook(
    { eventWebHookId: id, organizationId: req.context.org.id },
    {
      ...updates,
      // Unchanged values skip the cap check, so a since-lowered cap still round-trips
      ...(timeoutSeconds !== undefined &&
      timeoutSeconds !== (existing.timeoutSeconds ?? null)
        ? { timeoutSeconds }
        : {}),
    },
  );
  const updated = await getWebhook(req.context, id);
  return { eventWebhook: toApiEventWebhook(updated, false) };
});

export const deleteEventWebhook = createApiRequestHandler(
  deleteEventWebhookValidator,
)(async (req) => {
  const webhook = await getWebhook(req.context, req.params.id);
  if (!req.context.permissions.canDeleteEventWebhook(webhook)) {
    req.context.permissions.throwPermissionError();
  }
  const deleted = await deleteEventWebHookById({
    eventWebHookId: req.params.id,
    organizationId: req.context.org.id,
  });
  if (!deleted) {
    req.context.throwNotFoundError(`Event webhook not found: ${req.params.id}`);
  }
  return { deletedId: req.params.id };
});

export const listEventWebhookLogs = createApiRequestHandler(
  listEventWebhookLogsValidator,
)(async (req) => {
  const { permissions } = req.context;
  const webhook = await getWebhook(req.context, req.params.id);
  if (!permissions.canViewEventWebhook(webhook)) {
    permissions.throwPermissionError();
  }
  // Filters may have narrowed since delivery, so each log is checked against its own
  const logs = await getLatestRunsForWebHook(
    req.context.org.id,
    webhook.id,
    50,
    (filters) => permissions.canViewEventWebhook(filters),
  );
  return { logs: logs.map(toApiLog) };
});

export const postEventWebhookTest = createApiRequestHandler(
  postEventWebhookTestValidator,
)(async (req) => {
  await getWebhook(req.context, req.params.id);
  await sendEventWebhookTestEvent(req.context, req.params.id);
  return { queued: true as const };
});
