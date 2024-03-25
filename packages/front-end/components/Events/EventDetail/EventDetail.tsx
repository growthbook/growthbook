import React, { FC } from "react";
import { useRouter } from "next/router";
import {
  EventInterface,
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "back-end/types/event";
import { datetime } from "shared/dates";
import useApi from "@front-end/hooks/useApi";
import LoadingSpinner from "@front-end/components/LoadingSpinner";
import Code from "@front-end/components/SyntaxHighlighting/Code";

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
      <h2 className="text-muted mb-3">{datetime(event.dateCreated)}</h2>
      <Code
        language="json"
        filename={event.data.event}
        code={JSON.stringify(event.data, null, 2)}
        expandable={false}
      />
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
