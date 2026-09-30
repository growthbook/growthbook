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

function toApiEventWebhook(w: EventWebHookInterface) {
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
    headers: w.headers,
    signingKey: w.signingKey,
    lastRunAt: w.lastRunAt?.toISOString() ?? null,
    lastState: w.lastState,
    lastResponseBody: w.lastResponseBody,
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

async function getWebhook(context: ApiReqContext, id: string) {
  const webhook = await getEventWebHookById(id, context.org.id);
  if (!webhook) context.throwNotFoundError(`Event webhook not found: ${id}`);
  return webhook;
}

export const listEventWebhooks = createApiRequestHandler(
  listEventWebhooksValidator,
)(async (req) => {
  if (!req.context.permissions.canViewEventWebhook()) {
    req.context.permissions.throwPermissionError();
  }
  const webhooks = await getAllEventWebHooks(req.context.org.id);
  return { eventWebhooks: webhooks.map(toApiEventWebhook) };
});

export const getEventWebhook = createApiRequestHandler(
  getEventWebhookValidator,
)(async (req) => {
  if (!req.context.permissions.canViewEventWebhook()) {
    req.context.permissions.throwPermissionError();
  }
  const webhook = await getWebhook(req.context, req.params.id);
  return { eventWebhook: toApiEventWebhook(webhook) };
});

export const postEventWebhook = createApiRequestHandler(
  postEventWebhookValidator,
)(async (req) => {
  if (!req.context.permissions.canCreateEventWebhook()) {
    req.context.permissions.throwPermissionError();
  }
  const {
    projects = [],
    tags = [],
    environments = [],
    method = "POST",
    headers = {},
    ...rest
  } = req.body;
  const created = await createEventWebHook({
    ...rest,
    organizationId: req.context.org.id,
    projects,
    tags,
    environments,
    method,
    headers,
  });
  return { eventWebhook: toApiEventWebhook(created) };
});

export const putEventWebhook = createApiRequestHandler(
  putEventWebhookValidator,
)(async (req) => {
  if (!req.context.permissions.canUpdateEventWebhook()) {
    req.context.permissions.throwPermissionError();
  }
  const { id } = req.params;
  await getWebhook(req.context, id);
  await updateEventWebHook(
    { eventWebHookId: id, organizationId: req.context.org.id },
    req.body,
  );
  const updated = await getWebhook(req.context, id);
  return { eventWebhook: toApiEventWebhook(updated) };
});

export const deleteEventWebhook = createApiRequestHandler(
  deleteEventWebhookValidator,
)(async (req) => {
  if (!req.context.permissions.canDeleteEventWebhook()) {
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
  if (!req.context.permissions.canViewEventWebhook()) {
    req.context.permissions.throwPermissionError();
  }
  await getWebhook(req.context, req.params.id);
  const logs = await getLatestRunsForWebHook(
    req.context.org.id,
    req.params.id,
    50,
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
