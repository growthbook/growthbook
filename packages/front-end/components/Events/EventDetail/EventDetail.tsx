import React, { FC } from "react";
import { useRouter } from "next/router";
import { EventInterface } from "back-end/types/event";
import { datetime } from "shared/dates";
import { NotificationEvent } from "back-end/src/events/notification-events";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Code from "@/components/SyntaxHighlighting/Code";

type EventDetailProps = {
  event: EventInterface<NotificationEvent>;
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
    event: EventInterface<NotificationEvent>;
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
