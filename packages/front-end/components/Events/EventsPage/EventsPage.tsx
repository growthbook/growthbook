import React, { FC } from "react";
import {
  EventInterface,
  NotificationEventName,
  NotificationEventPayload,
  NotificationEventResource,
} from "back-end/types/event";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "../../LoadingSpinner";
import { EventsTableRow } from "./EventsTableRow";

type EventsPageProps = {
  isLoading: boolean;
  hasError: boolean;
  events: EventInterface<
    NotificationEventPayload<
      NotificationEventName,
      NotificationEventResource,
      unknown
    >
  >[];
};

export const EventsPage: FC<EventsPageProps> = ({
  events = [],
  hasError,
  isLoading,
}) => {
  return (
    <div className="container p-4">
      <h1>Events</h1>
      {hasError && (
        <div className="alert alert-danger">
          There was an error loading the events.
        </div>
      )}
      {isLoading && <LoadingSpinner />}
      {events.length === 0 ? (
        // Empty state
        <div className="row">
          <div className="col-xs-12 col-md-6 offset-md-3">
            <div className="card text-center p-3">
              When events are created, they will show up here.
            </div>
          </div>
        </div>
      ) : (
        // With data
        <table className="mt-3 table gbtable appbox--align-top table-hover appbox">
          <thead>
            <tr>
              <th style={{ width: 200 }}>Date</th>
              <th>Event Data</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <EventsTableRow key={event.id} event={event} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export const EventsPageContainer = () => {
  const { data, error, isValidating } = useApi<{
    events: EventInterface<
      NotificationEventPayload<
        NotificationEventName,
        NotificationEventResource,
        unknown
      >
    >[];
  }>("/events");

  return (
    <EventsPage
      isLoading={isValidating}
      hasError={!!error}
      events={data?.events || []}
    />
  );
};
