import type { Response } from "express";
import { ApiErrorResponse } from "../../../types/api";
import { EventWebHookInterface } from "../../../types/event-webhook";
import * as EventWebHook from "../../models/EventWebhookModel";
import * as EventWebHookLog from "../../models/EventWebHookLogModel";

import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";
import { EventWebHookLogInterface } from "../../../types/event-webhook-log";

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
