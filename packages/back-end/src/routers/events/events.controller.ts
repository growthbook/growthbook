import type { Response } from "express";
import * as Event from "../../models/EventModel";
import { AuthRequest } from "../../types/AuthRequest";
import { EventInterface } from "../../../types/event";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";

type GetEventsRequest = AuthRequest;

type GetEventsResponse = {
  events: EventInterface<unknown>[];
};

export const getEvents = async (
  req: GetEventsRequest,
  res: Response<GetEventsResponse | ApiErrorResponse>
) => {
  req.checkPermissions("viewEvents");

  const { org } = getOrgFromReq(req);

  const events = await Event.getLatestEventsForOrganization(org.id, 50);

  return res.json({ events });
};

type GetEventRequest = AuthRequest<null, { id: string }>;

type GetEventResponse = {
  event: EventInterface<unknown>;
};

export const getEventById = async (
  req: GetEventRequest,
  res: Response<GetEventResponse | ApiErrorResponse>
) => {
  req.checkPermissions("viewEvents");

  const { org } = getOrgFromReq(req);

  const event = await Event.getEventForOrganization(req.params.id, org.id);
  if (!event) {
    return res.status(404).json({ message: "Not Found" });
  }

  return res.json({ event });
};
