import type { Response } from "express";
import { ApiErrorResponse } from "../../../types/api";
import { EventWebHookInterface } from "../../../types/event-webhook";
import * as EventWebHook from "../../models/EventWebhookModel";

import { AuthRequest } from "../../types/AuthRequest";
import { getOrgFromReq } from "../../services/organizations";

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
