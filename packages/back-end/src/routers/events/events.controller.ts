import type { Response } from "express";
import { NotificationEvent } from "../../events/notification-events";
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
  res: Response<GetEventsResponse | ApiErrorResponse>
) => {
  const context = getContextFromReq(req);

  const events = await Event.getLatestEventsForOrganization(context.org.id, 50);

  return res.json({
    events: events.filter((event) =>
      context.permissions.canViewEvent(event.data as NotificationEvent)
    ),
  });
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
