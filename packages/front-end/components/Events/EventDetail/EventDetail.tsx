import React, { FC } from "react";
import { useRouter } from "next/router";
import {
  EventInterface,
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "back-end/types/event";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";

type EventDetailProps = {
  event: EventInterface<
    NotificationEventPayload<
      NotificationEventName,
      NotificationEventResource,
      unknown
    >
  >;
};

export const EventDetail: FC<EventDetailProps> = ({ event }) => {
  return (
    <div>
      <h1>{event.event}</h1>
    </div>
  );
};

export const EventDetailContainer = () => {
  const router = useRouter();
  const { eventid: eventId } = router.query;

  const { data, error, isValidating } = useApi<{
    event: EventInterface<
      NotificationEventPayload<
        NotificationEventName,
        NotificationEventResource,
        unknown
      >
    >;
  }>(`/events/${eventId}`);

  const event = data?.event;

  if (error || (!isValidating && !event)) {
    return (
      <div className="alert alert-danger">Unable to fetch event {eventId}</div>
    );
  }

  if (!event) {
    return <LoadingSpinner />;
  }

  return <EventDetail event={event} />;
};
