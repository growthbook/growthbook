import type { Response } from "express";
import { NotificationEvent } from "../../events/notification-events";
import * as Event from "../../models/EventModel";
import { AuthRequest } from "../../types/AuthRequest";
import { EventInterface } from "../../../types/event";
import { ApiErrorResponse } from "../../../types/api";
import { getContextFromReq } from "../../services/organizations";

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
  events: EventInterface<unknown>[];
};

export const getEvents = async (
  req: GetEventsRequest,
  res: Response<GetEventsResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { page, perPage, type, from, to, sortOrder } = req.query;

  const eventTypes = JSON.parse(type || "[]");

  const cappedPerPage = Math.min(parseInt(perPage), 100);
  const events = await Event.getEventsForOrganization(
    context.org.id,
    parseInt(page),
    cappedPerPage,
    eventTypes,
    from,
    to,
    sortOrder === "asc" ? 1 : -1
  );

  return res.json({
    events: events.filter((event) =>
      context.permissions.canViewEvent(event.data as NotificationEvent)
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
  res: Response<GetEventsCountResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);
  const { type, from, to } = req.query;
  const eventTypes = JSON.parse(type || "[]");
  const count = await Event.getEventsCountForOrganization(
    context.org.id,
    eventTypes,
    from,
    to
  );

  return res.json({ count });
};

type GetEventRequest = AuthRequest<null, { id: string }>;

type GetEventResponse = {
  event: EventInterface<unknown>;
};

export const getEventById = async (
  req: GetEventRequest,
  res: Response<GetEventResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);

  const event = await Event.getEventForOrganization(
    req.params.id,
    context.org.id
  );
  if (!event) {
    return res.status(404).json({ message: "Not Found" });
  }

  if (!context.permissions.canViewEvent(event.data as NotificationEvent)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  return res.json({ event });
};
