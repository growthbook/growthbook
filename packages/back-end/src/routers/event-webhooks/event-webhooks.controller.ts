import type { Response } from "express";
import {
  CreateWebhookSecretProps,
  UpdateWebhookSecretProps,
} from "shared/validators";
import {
  EventWebHookInterface,
  EventWebHookPayloadType,
  EventWebHookMethod,
} from "shared/types/event-webhook";
import {
  EventWebHookLegacyLogInterface,
  EventWebHookLogInterface,
} from "shared/types/event-webhook-log";
import { NotificationEventName } from "shared/types/events/base-types";
import { PrivateApiErrorResponse } from "back-end/types/api";
import * as EventWebHook from "back-end/src/models/EventWebhookModel";
import {
  deleteEventWebHookById,
  getEventWebHookById,
  updateEventWebHook,
  sendEventWebhookTestEvent,
  UpdateEventWebHookAttributes,
} from "back-end/src/models/EventWebhookModel";
import * as EventWebHookLog from "back-end/src/models/EventWebHookLogModel";

import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

// region GET /event-webhooks

type GetEventWebHooksRequest = AuthRequest;

type GetEventWebHooks = {
  eventWebHooks: EventWebHookInterface[];
};

export const getEventWebHooks = async (
  req: GetEventWebHooksRequest,
  res: Response<GetEventWebHooks>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canViewEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const eventWebHooks = await EventWebHook.getAllEventWebHooks(context.org.id);

  return res.json({ eventWebHooks });
};

// endregion GET /event-webhooks

// region GET /event-webhooks/:id

type GetEventWebHookByIdRequest = AuthRequest<null, { eventWebHookId: string }>;

type GetEventWebHookByIdResponse = {
  eventWebHook: EventWebHookInterface;
};

export const getEventWebHook = async (
  req: GetEventWebHookByIdRequest,
  res: Response<GetEventWebHookByIdResponse | PrivateApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canViewEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const { eventWebHookId } = req.params;

  const eventWebHook = await getEventWebHookById(
    eventWebHookId,
    context.org.id,
  );

  if (!eventWebHook) {
    return res.status(404).json({ status: 404, message: "Not found" });
  }

  return res.json({
    eventWebHook,
  });
};

// endregion GET /event-webhooks/:id

// region POST /event-webhooks

type PostEventWebHooksRequest = AuthRequest & {
  body: {
    url: string;
    name: string;
    enabled: boolean;
    events: NotificationEventName[];
    tags: string[];
    environments: string[];
    projects: string[];
    payloadType: EventWebHookPayloadType;
    method: EventWebHookMethod;
    headers: Record<string, string>;
  };
};

type PostEventWebHooksResponse = {
  eventWebHook: EventWebHookInterface;
};

export const createEventWebHook = async (
  req: PostEventWebHooksRequest,
  res: Response<PostEventWebHooksResponse | PrivateApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateEventWebhook()) {
    context.permissions.throwPermissionError();
  }
  const {
    url,
    name,
    events,
    enabled,
    tags = [],
    projects = [],
    environments = [],
    payloadType,
    method = "POST",
    headers = {},
  } = req.body;

  const created = await EventWebHook.createEventWebHook({
    name,
    url,
    events,
    organizationId: context.org.id,
    enabled,
    projects,
    environments,
    tags,
    payloadType,
    method,
    headers,
  });

  return res.json({ eventWebHook: created });
};

// endregion POST /event-webhooks

// region GET /event-webhooks/logs/:eventWebHookId

type GetEventWebHookLogsRequest = AuthRequest<
  undefined,
  { eventWebHookId: string }
>;

type GetEventWebHookLogsResponse = {
  eventWebHookLogs: (
    | EventWebHookLegacyLogInterface
    | EventWebHookLogInterface
  )[];
};

export const getEventWebHookLogs = async (
  req: GetEventWebHookLogsRequest,
  res: Response<GetEventWebHookLogsResponse | PrivateApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canViewEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const eventWebHookLogs = await EventWebHookLog.getLatestRunsForWebHook(
    context.org.id,
    req.params.eventWebHookId,
    50,
  );

  return res.json({ eventWebHookLogs });
};

// endregion GET /event-webhooks/logs/:eventWebHookId

// region DELETE /event-webhooks/:eventWebHookId

type DeleteEventWebhookRequest = AuthRequest<null, { eventWebHookId: string }>;

type DeleteEventWebhookResponse = {
  status: number;
};

export const deleteEventWebHook = async (
  req: DeleteEventWebhookRequest,
  res: Response<DeleteEventWebhookResponse | PrivateApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canDeleteEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const successful = await deleteEventWebHookById({
    eventWebHookId: req.params.eventWebHookId,
    organizationId: context.org.id,
  });

  const status = successful ? 200 : 404;

  res.status(status).json({
    status,
  });
};

// endregion DELETE /event-webhooks/:eventWebHookId

// region PUT /event-webhooks/:eventWebHookId

type UpdateEventWebHookRequest = AuthRequest<
  Required<UpdateEventWebHookAttributes>,
  { eventWebHookId: string }
>;

type UpdateEventWebHookResponse = {
  status: number;
};

export const putEventWebHook = async (
  req: UpdateEventWebHookRequest,
  res: Response<UpdateEventWebHookResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canUpdateEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const successful = await updateEventWebHook(
    {
      eventWebHookId: req.params.eventWebHookId,
      organizationId: context.org.id,
    },
    req.body,
  );

  const status = successful ? 200 : 404;

  res.status(status).json({
    status,
  });
};

// endregion PUT /event-webhooks/:eventWebHookId

// region POST /event-webhooks/toggle

type PostToggleEventWebHooksRequest = AuthRequest & {
  body: {
    webhookId: string;
  };
};

type PostToggleEventWebHooksResponse = {
  enabled: boolean;
};

export const toggleEventWebHook = async (
  req: PostToggleEventWebHooksRequest,
  res: Response<PostToggleEventWebHooksResponse | PrivateApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canUpdateEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const {
    org: { id: organizationId },
  } = context;
  const { webhookId } = req.body;

  const webhook = await EventWebHook.getEventWebHookById(
    webhookId,
    organizationId,
  );

  const enabled = !webhook?.enabled;

  const successful = await updateEventWebHook(
    {
      eventWebHookId: webhookId,
      organizationId,
    },
    { enabled },
  );

  const status = successful ? 200 : 404;

  res.status(status).json({
    enabled,
  });
};

// endregion /event-webhooks/toggle

// region POST /event-webhooks/test-params

const testParamsPayload = (name: string) => ({
  text: `Hi there! This is a test event from GrowthBook to see if the params for webhook ${name} are correct.`,
  blocks: [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Hi there! 👋*\nThis is a *test event* from GrowthBook to see if the params for webhook ${name} are correct.`,
      },
    },
  ],
});

type PostTestWebHooksParamsRequest = AuthRequest & {
  body: {
    name: string;
    method: EventWebHookMethod;
    url: string;
  };
};

export const testWebHookParams = async (
  req: PostTestWebHooksParamsRequest,
  res: Response<{ success: boolean } | PrivateApiErrorResponse>,
) => {
  try {
    const response = await fetch(req.body.url, {
      method: req.body.method,
      body: JSON.stringify(testParamsPayload(req.body.name)),
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) return res.json({ success: true });

    return res.status(403).json({
      status: 403,
      message: `Request failed: ${response.status} - ${response.statusText}`,
    });
  } catch (e) {
    return res
      .status(403)
      .json({ status: 403, message: `Request failed: ${e}` });
  }
};

// endregion /event-webhooks/test-params

// region POST /event-webhooks/test

type PostTestEventWebHooksRequest = AuthRequest & {
  body: {
    webhookId: string;
  };
};

export const createTestEventWebHook = async (
  req: PostTestEventWebHooksRequest,
  res: Response<unknown | PrivateApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  const { webhookId } = req.body;

  await sendEventWebhookTestEvent(context, webhookId);

  return res.status(200);
};

// endregion POST /event-webhooks/test

export const createWebhookSecret = async (
  req: AuthRequest<CreateWebhookSecretProps>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  await context.models.webhookSecrets.create(req.body);

  return res.status(200).json({
    status: 200,
  });
};

export const deleteWebhookSecret = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  await context.models.webhookSecrets.deleteById(req.params.id);

  return res.status(200).json({
    status: 200,
  });
};

export const updateWebhookSecret = async (
  req: AuthRequest<UpdateWebhookSecretProps, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  await context.models.webhookSecrets.updateById(req.params.id, req.body);

  return res.status(200).json({
    status: 200,
  });
};
