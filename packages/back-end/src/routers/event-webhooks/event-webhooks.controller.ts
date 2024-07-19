import type { Response } from "express";
import fetch from "node-fetch";
import { PrivateApiErrorResponse } from "../../../types/api";
import {
  EventWebHookInterface,
  EventWebHookPayloadType,
  EventWebHookMethod,
} from "../../../types/event-webhook";
import * as EventWebHook from "../../models/EventWebhookModel";
import {
  deleteEventWebHookById,
  getEventWebHookById,
  updateEventWebHook,
  UpdateEventWebHookAttributes,
} from "../../models/EventWebhookModel";
import { createEvent } from "../../models/EventModel";
import * as EventWebHookLog from "../../models/EventWebHookLogModel";

import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import {
  EventWebHookLegacyLogInterface,
  EventWebHookLogInterface,
} from "../../../types/event-webhook-log";
import { WebhookTestEvent } from "../../events/notification-events";
import { NotificationEventName } from "../../events/base-types";
import { EventNotifier } from "../../events/notifiers/EventNotifier";

// region GET /event-webhooks

type GetEventWebHooksRequest = AuthRequest;

type GetEventWebHooks = {
  eventWebHooks: EventWebHookInterface[];
};

export const getEventWebHooks = async (
  req: GetEventWebHooksRequest,
  res: Response<GetEventWebHooks>
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
  res: Response<GetEventWebHookByIdResponse | PrivateApiErrorResponse>
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canViewEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const { eventWebHookId } = req.params;

  const eventWebHook = await getEventWebHookById(
    eventWebHookId,
    context.org.id
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
  res: Response<PostEventWebHooksResponse | PrivateApiErrorResponse>
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
    payloadType = "raw",
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
  res: Response<GetEventWebHookLogsResponse | PrivateApiErrorResponse>
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canViewEventWebhook()) {
    context.permissions.throwPermissionError();
  }

  const eventWebHookLogs = await EventWebHookLog.getLatestRunsForWebHook(
    context.org.id,
    req.params.eventWebHookId,
    50
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
  res: Response<DeleteEventWebhookResponse | PrivateApiErrorResponse>
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
  res: Response<UpdateEventWebHookResponse>
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
    req.body
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
  res: Response<PostToggleEventWebHooksResponse | PrivateApiErrorResponse>
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
    organizationId
  );

  const enabled = !webhook?.enabled;

  const successful = await updateEventWebHook(
    {
      eventWebHookId: webhookId,
      organizationId,
    },
    { enabled }
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
  res: Response<{ success: boolean } | PrivateApiErrorResponse>
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

type PostTestEventWebHooksResponse = {
  eventId: string;
};

export const createTestEventWebHook = async (
  req: PostTestEventWebHooksRequest,
  res: Response<PostTestEventWebHooksResponse | PrivateApiErrorResponse>
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateEventWebhook()) {
    context.permissions.throwPermissionError();
  }
  const {
    org: { id: organizationId },
  } = context;
  const { webhookId } = req.body;

  const webhook = await EventWebHook.getEventWebHookById(
    webhookId,
    organizationId
  );

  if (!webhook) throw new Error(`Cannot find webhook with id ${webhookId}`);

  const payload: WebhookTestEvent = {
    event: "webhook.test",
    object: "webhook",
    data: { webhookId },
    user: req.userId
      ? {
          type: "dashboard",
          id: req.userId,
          email: req.email,
          name: req.name || "",
        }
      : null,
    projects: [],
    tags: [],
    environments: [],
    containsSecrets: false,
  };

  const emittedEvent = await createEvent(organizationId, payload);

  if (!emittedEvent) throw new Error("Error while creating event!");

  new EventNotifier(emittedEvent.id).perform();

  return res.json({ eventId: emittedEvent.id });
};

// endregion POST /event-webhooks/test
