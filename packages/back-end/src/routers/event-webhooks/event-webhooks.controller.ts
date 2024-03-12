import type { Response } from "express";
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
} from "../../models/EventWebhookModel";
import * as EventWebHookLog from "../../models/EventWebHookLogModel";

import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import { EventWebHookLogInterface } from "../../../types/event-webhook-log";
import { NotificationEventName } from "../../events/base-types";

// region GET /event-webhooks

type GetEventWebHooksRequest = AuthRequest;

type GetEventWebHooks = {
  eventWebHooks: EventWebHookInterface[];
};

export const getEventWebHooks = async (
  req: GetEventWebHooksRequest,
  res: Response<GetEventWebHooks>
) => {
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);

  const eventWebHooks = await EventWebHook.getAllEventWebHooks(org.id);

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
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);
  const { eventWebHookId } = req.params;

  const eventWebHook = await getEventWebHookById(eventWebHookId, org.id);
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
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);
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
    organizationId: org.id,
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
  eventWebHookLogs: EventWebHookLogInterface[];
};

export const getEventWebHookLogs = async (
  req: GetEventWebHookLogsRequest,
  res: Response<GetEventWebHookLogsResponse | PrivateApiErrorResponse>
) => {
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);

  const eventWebHookLogs = await EventWebHookLog.getLatestRunsForWebHook(
    org.id,
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
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);

  const successful = await deleteEventWebHookById({
    eventWebHookId: req.params.eventWebHookId,
    organizationId: org.id,
  });

  const status = successful ? 200 : 404;

  res.status(status).json({
    status,
  });
};

// endregion DELETE /event-webhooks/:eventWebHookId

// region PUT /event-webhooks/:eventWebHookId

type UpdateEventWebHookRequest = AuthRequest<
  {
    name: string;
    url: string;
    enabled: boolean;
    events: NotificationEventName[];
    tags: string[];
    environments: string[];
    projects: string[];
    payloadType: EventWebHookPayloadType;
    method: EventWebHookMethod;
    headers: Record<string, string>;
  },
  { eventWebHookId: string }
>;

type UpdateEventWebHookResponse = {
  status: number;
};

export const putEventWebHook = async (
  req: UpdateEventWebHookRequest,
  res: Response<UpdateEventWebHookResponse>
) => {
  req.checkPermissions("manageWebhooks");

  const { org } = getContextFromReq(req);

  const successful = await updateEventWebHook(
    {
      eventWebHookId: req.params.eventWebHookId,
      organizationId: org.id,
    },
    req.body
  );

  const status = successful ? 200 : 404;

  res.status(status).json({
    status,
  });
};

// endregion PUT /event-webhooks/:eventWebHookId
