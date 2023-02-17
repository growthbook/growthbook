import type { Response } from "express";
import { ApiErrorResponse } from "../../../types/api";
import { EventWebHookInterface } from "../../../types/event-webhook";
import * as EventWebHook from "../../models/EventWebhookModel";
import * as EventWebHookLog from "../../models/EventWebHookLogModel";

import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";
import { EventWebHookLogInterface } from "../../../types/event-webhook-log";
import { NotificationEventName } from "../../events/base-types";
import {
  deleteEventWebHookById,
  getEventWebHookById,
  updateEventWebHook,
} from "../../models/EventWebhookModel";

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

  const { org } = getOrgFromReq(req);

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
  res: Response<GetEventWebHookByIdResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageWebhooks");

  const { org } = getOrgFromReq(req);
  const { eventWebHookId } = req.params;

  const eventWebHook = await getEventWebHookById(eventWebHookId, org.id);
  if (!eventWebHook) {
    return res.status(404).json({ message: "Not found" });
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
    events: NotificationEventName[];
  };
};

type PostEventWebHooksResponse = {
  eventWebHook: EventWebHookInterface;
};

export const createEventWebHook = async (
  req: PostEventWebHooksRequest,
  res: Response<PostEventWebHooksResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageWebhooks");

  const { org } = getOrgFromReq(req);
  const { url, name, events } = req.body;

  const created = await EventWebHook.createEventWebHook({
    name,
    url,
    events,
    organizationId: org.id,
    enabled: true,
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
  res: Response<GetEventWebHookLogsResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageWebhooks");

  const { org } = getOrgFromReq(req);

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
  res: Response<DeleteEventWebhookResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageWebhooks");

  const { org } = getOrgFromReq(req);

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
    events: NotificationEventName[];
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

  const { org } = getOrgFromReq(req);

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
