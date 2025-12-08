import type { Response } from "express";
import * as Event from "back-end/src/models/EventModel";
import { EventInterface } from "back-end/types/events/event";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";

type GetEventsRequest = AuthRequest<
  null,
  null,
  {
    page: string;
    perPage: string;
    type?: string;
    from?: string;
    to?: string;
    sortOrder?: string;
  }
>;

type GetEventsResponse = {
  events: EventInterface[];
};

export const getEvents = async (
  req: GetEventsRequest,
  res: Response<GetEventsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { page, perPage, type, from, to, sortOrder } = req.query;

  const eventTypes = JSON.parse(type || "[]");

  const cappedPerPage = Math.min(parseInt(perPage), 100);
  const events = await Event.getEventsForOrganization(context.org.id, {
    page: parseInt(page),
    perPage: cappedPerPage,
    eventTypes,
    from,
    to,
    sortOrder: sortOrder === "asc" ? 1 : -1,
  });

  return res.json({
    events: events.filter((event) =>
      context.permissions.canViewEvent(event.data),
    ),
  });
};

type GetEventsCountRequest = AuthRequest<
  null,
  null,
  { type?: string; from?: string; to?: string }
>;

type GetEventsCountResponse = {
  count: number;
};

export const getEventsCount = async (
  req: GetEventsCountRequest,
  res: Response<GetEventsCountResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { type, from, to } = req.query;
  const eventTypes = JSON.parse(type || "[]");
  const count = await Event.getEventsCountForOrganization(context.org.id, {
    eventTypes,
    from,
    to,
  });

  return res.json({ count });
};

type GetEventRequest = AuthRequest<null, { id: string }>;

type GetEventResponse = {
  event: EventInterface;
};

export const getEventById = async (
  req: GetEventRequest,
  res: Response<GetEventResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  const event = await Event.getEventForOrganization(
    req.params.id,
    context.org.id,
  );
  if (!event) {
    return res.status(404).json({ message: "Not Found" });
  }

  if (!context.permissions.canViewEvent(event.data)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  return res.json({ event });
};
