import type { Response } from "express";
import * as Event from "../../models/EventModel";
import { AuthRequest } from "../../types/AuthRequest";
import { EventInterface } from "../../../types/event";
import { ApiErrorResponse } from "../../../types/api";
import { getContextFromReq } from "../../services/organizations";

type GetEventsRequest = AuthRequest;

type GetEventsResponse = {
  events: EventInterface<unknown>[];
};

export const getEvents = async (
  req: GetEventsRequest,
  res: Response<GetEventsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canViewEvents()) {
    context.permissions.throwPermissionError();
  }

  const events = await Event.getLatestEventsForOrganization(context.org.id, 50);

  return res.json({ events });
};

type GetEventRequest = AuthRequest<null, { id: string }>;

type GetEventResponse = {
  event: EventInterface<unknown>;
};

export const getEventById = async (
  req: GetEventRequest,
  res: Response<GetEventResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canViewEvents()) {
    context.permissions.throwPermissionError();
  }

  const event = await Event.getEventForOrganization(
    req.params.id,
    context.org.id,
  );
  if (!event) {
    return res.status(404).json({ message: "Not Found" });
  }

  return res.json({ event });
};
