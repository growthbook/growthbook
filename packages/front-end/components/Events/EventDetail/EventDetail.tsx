import React, { FC } from "react";
import { useRouter } from "next/router";
import { EventInterface } from "shared/types/events/event";
import { datetime } from "shared/dates";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Code from "@/components/SyntaxHighlighting/Code";
import SettingsPage from "@/components/Layout/SettingsPage";
import Callout from "@/ui/Callout";

type EventDetailProps = {
  event: EventInterface;
};

export const EventDetail: FC<EventDetailProps> = ({ event }) => {
  return (
    <Code
      language="json"
      filename={event.data.event}
      code={JSON.stringify(event.data, null, 2)}
      expandable={false}
    />
  );
};

export const EventDetailContainer = () => {
  const router = useRouter();
  const { eventid: eventId } = router.query;

  const { data, error, isValidating } = useApi<{
    event: EventInterface;
  }>(`/events/${eventId}`);

  const event = data?.event;
  const title = event?.event ?? "Event";

  return (
    <SettingsPage
      title={title}
      description={event ? datetime(event.dateCreated) : undefined}
      parent={{ display: "Events Log", href: "/events" }}
    >
      {error || (!isValidating && !event) ? (
        <Callout status="error">Unable to fetch event {eventId}</Callout>
      ) : !event ? (
        <LoadingSpinner />
      ) : (
        <EventDetail event={event} />
      )}
    </SettingsPage>
  );
};
