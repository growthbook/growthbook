import type { Response } from "express";
import { ApiErrorResponse } from "../../../types/api";
import { EventWebHookInterface } from "../../../types/event-webhook";
import * as EventWebHook from "../../models/EventWebhookModel";
import * as EventWebHookLog from "../../models/EventWebHookLogModel";

import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";
import { EventWebHookLogInterface } from "../../../types/event-webhook-log";
import { NotificationEventName } from "../../events/base-types";

// region GET /event-webhooks

type GetEventWebHooksRequest = AuthRequest;

type GetEventWebHooks = {
  eventWebHooks: EventWebHookInterface[];
};

export const getEventWebHooks = async (
  req: GetEventWebHooksRequest,
  res: Response<GetEventWebHooks | ApiErrorResponse>
) => {
  req.checkPermissions("manageWebhooks");

  const { org } = getOrgFromReq(req);

  const eventWebHooks = await EventWebHook.getAllEventWebHooks(org.id);

  return res.json({ eventWebHooks });
};

// endregion GET /event-webhooks

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
    req.params.eventWebHookId
  );

  return res.json({ eventWebHookLogs });
};

// endregion GET /event-webhooks/logs/:eventWebHookId
